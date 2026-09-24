import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import nodePath from 'node:path';

import { parseCursorModelId, resolveCursorModelId } from '@lobechat/model-runtime';
import cursorChatModels from 'model-bank/cursor';

import { resolveCursorAgentStateDir } from './env';
import { CursorAgentUnavailableError } from './errors';
import { resolveCursorCliCached } from './resolveCli';
import { createAbortError, jsonError } from './transport.gate';
import {
  appendBounded,
  appendDiagnostic,
  killChild,
  looksLikeAuthFailure,
  trimErrorMessage,
} from './transport.relay';

export interface CursorAgentModel {
  id: string;
  name: string;
}

const MODELS_TTL_MS = 10 * 60 * 1000;
/** Real CLI failures only. Gate busy, queue timeout, and abort are not remembered. */
const CLI_LIST_FAILURE_TTL_MS = 60 * 1000;
const MODEL_LIST_DIR = 'model-lists';
/** `<sha256>.json` written by {@link persistLastKnownGoodCursorModels}. */
const MODEL_LIST_FILE_RE = /^[0-9a-f]{64}\.json$/;
const MODEL_LIST_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SUFFIX_RE = / \((?:current|default)\)$/i;

/**
 * Static cursor bank. Collapsed bases are the cards whose selector is
 * `cursorReasoningEffort`; their value is `defaultEffortLevel`, or `high`.
 */
const cursorBankIds = new Set<string>();
const cursorEffortDefaults = new Map<string, string>();
for (const card of cursorChatModels) {
  cursorBankIds.add(card.id);
  const extendParams = card.settings?.extendParams;
  if (!extendParams?.includes('cursorReasoningEffort')) continue;
  cursorEffortDefaults.set(card.id, card.settings?.defaultEffortLevel || 'high');
}

/** CLI names include zero-width characters and doubled spaces (`Grok 4.7  High Fast`). */
const sanitizeCursorText = (value: string): string =>
  value
    .replaceAll(/[\u200B-\u200D\uFEFF]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();

const cache = new Map<string, { expiresAt: number; models: CursorAgentModel[] }>();
/** One shared list load per token. Cleared when that load settles. */
const inflightLoads = new Map<string, Promise<CursorAgentModel[] | undefined>>();
/** Real CLI failures. Not used for gate busy, queue timeout, or abort. */
const listLoadFailures = new Map<string, number>();
/** Last successful list, including after the in-memory TTL expires. No secrets. */
const lastKnownGood = new Map<string, CursorAgentModel[]>();

/**
 * A list load that did not reach the CLI: the gate was busy or the queue timed
 * out. Callers must not remember it. Abort is a separate error and is also not
 * remembered.
 */
export class CursorModelListSkippedError extends Error {
  constructor() {
    super('cursor model list skipped');
    this.name = 'CursorModelListSkippedError';
  }
}

export const tokenCacheKey = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/**
 * Parse `cursor-agent --list-models` stdout. Lines look like
 * `composer-2.5 - Composer 2.5` or `auto - Auto (default)`.
 */
export const parseCursorModelList = (text: string): CursorAgentModel[] => {
  const models: CursorAgentModel[] = [];
  for (const raw of text.split('\n')) {
    const line = sanitizeCursorText(raw);
    const separator = line.indexOf(' - ');
    if (separator <= 0) continue;
    const id = sanitizeCursorText(line.slice(0, separator));
    if (!id || id.includes(' ') || id.includes('\t')) continue;
    const name = sanitizeCursorText(line.slice(separator + 3).replace(SUFFIX_RE, ''));
    if (!name) continue;
    models.push({ id, name });
  }
  return models;
};

export const getCachedCursorModels = (
  token: string,
  now = Date.now(),
): CursorAgentModel[] | undefined => {
  const key = tokenCacheKey(token);
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= now || entry.models.length === 0) {
    if (entry) cache.delete(key);
    return undefined;
  }
  return entry.models;
};

export const setCachedCursorModels = (
  token: string,
  models: CursorAgentModel[],
  now = Date.now(),
): void => {
  // An empty parse must not occupy the 10 minute slot or hide a saved list.
  if (models.length === 0) return;
  cache.set(tokenCacheKey(token), { expiresAt: now + MODELS_TTL_MS, models });
};

/** `<stateDir>/model-lists/<sha256(token)>.json`. The file holds ids and names only. */
export const cursorLastKnownGoodModelListPath = (stateRoot: string, token: string): string =>
  nodePath.join(stateRoot, MODEL_LIST_DIR, `${tokenCacheKey(token)}.json`);

/** Test seam only. Does not delete the on-disk snapshot. */
export const resetCursorModelsCache = (): void => {
  cache.clear();
  inflightLoads.clear();
  listLoadFailures.clear();
  lastKnownGood.clear();
};

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

const isSkippedListLoad = (error: unknown): boolean =>
  isAbortError(error) || error instanceof CursorModelListSkippedError;

const rememberCliListFailure = (key: string): void => {
  listLoadFailures.set(key, Date.now() + CLI_LIST_FAILURE_TTL_MS);
};

const parseStoredModelList = (text: string): CursorAgentModel[] | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const modelsField = (parsed as { models?: unknown }).models;
  if (!Array.isArray(modelsField)) return undefined;
  const models: CursorAgentModel[] = [];
  for (const row of modelsField) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: unknown }).id;
    const name = (row as { name?: unknown }).name;
    if (typeof id !== 'string' || !id || id.length > 256 || /\s/.test(id)) continue;
    if (typeof name !== 'string' || !name || name.length > 500) continue;
    models.push({ id, name });
  }
  return models.length > 0 ? models : undefined;
};

const listModelListFileNames = (dir: string): string[] => {
  try {
    return readdirSync(dir).filter((name) => MODEL_LIST_FILE_RE.test(name));
  } catch {
    return [];
  }
};

const readModelListFile = (file: string): CursorAgentModel[] | undefined => {
  try {
    return parseStoredModelList(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};

/**
 * Newest readable snapshot in `dir`. Used when this token has no file of its
 * own (a rotated access token on the same host). Invalid files are skipped.
 */
const readNewestCursorModelListFile = (
  dir: string,
  exceptName?: string,
): CursorAgentModel[] | undefined => {
  const ranked: { file: string; mtimeMs: number }[] = [];
  for (const name of listModelListFileNames(dir)) {
    if (name === exceptName) continue;
    const file = nodePath.join(dir, name);
    try {
      const stat = statSync(file);
      if (!stat.isFile()) continue;
      ranked.push({ file, mtimeMs: stat.mtimeMs });
    } catch {
      // A name we cannot stat is not a candidate.
    }
  }
  ranked.sort((left, right) => right.mtimeMs - left.mtimeMs || left.file.localeCompare(right.file));
  for (const candidate of ranked) {
    const models = readModelListFile(candidate.file);
    if (models) return models;
  }
  return undefined;
};

const pruneOldCursorModelListFiles = (dir: string, now = Date.now()): void => {
  for (const name of listModelListFileNames(dir)) {
    const file = nodePath.join(dir, name);
    try {
      const stat = statSync(file);
      if (!stat.isFile()) continue;
      if (now - stat.mtimeMs > MODEL_LIST_MAX_AGE_MS) unlinkSync(file);
    } catch {
      // Best effort. A file we cannot stat stays until the next write.
    }
  }
};

/**
 * Last successful `--list-models` for this token. Memory first, then this
 * token's snapshot. When that file does not exist, the newest list file in
 * the same directory (same host). Empty or unreadable files are ignored.
 * Never creates the dir.
 */
export const readLastKnownGoodCursorModels = (token: string): CursorAgentModel[] | undefined => {
  const key = tokenCacheKey(token);
  const memory = lastKnownGood.get(key);
  if (memory && memory.length > 0) return memory;

  let file: string;
  try {
    file = cursorLastKnownGoodModelListPath(resolveCursorAgentStateDir(), token);
  } catch {
    return undefined;
  }
  if (existsSync(file)) {
    const models = readModelListFile(file);
    if (!models) return undefined;
    lastKnownGood.set(key, models);
    return models;
  }

  const fallback = readNewestCursorModelListFile(nodePath.dirname(file), nodePath.basename(file));
  if (!fallback) return undefined;
  lastKnownGood.set(key, fallback);
  return fallback;
};

/** Small JSON, mode 0600. Ids and display names only — the token never lands on disk. */
const persistLastKnownGoodCursorModels = (token: string, models: CursorAgentModel[]): void => {
  if (models.length === 0) return;
  const key = tokenCacheKey(token);
  lastKnownGood.set(key, models);
  let dest: string;
  try {
    dest = cursorLastKnownGoodModelListPath(resolveCursorAgentStateDir(), token);
  } catch {
    return;
  }
  const dir = nodePath.dirname(dest);
  const tmp = nodePath.join(dir, `.${nodePath.basename(dest)}.${process.pid}.tmp`);
  try {
    mkdirSync(dir, { mode: 0o700, recursive: true });
    writeFileSync(tmp, JSON.stringify({ models: models.map(({ id, name }) => ({ id, name })) }), {
      encoding: 'utf8',
      mode: 0o600,
    });
    try {
      chmodSync(tmp, 0o600);
    } catch {
      // Best effort against umask.
    }
    renameSync(tmp, dest);
    try {
      chmodSync(dest, 0o600);
    } catch {
      // Best effort against umask.
    }
    pruneOldCursorModelListFiles(dir);
  } catch {
    // The in-memory copy still serves this process.
  } finally {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // rename already consumed the temp file.
    }
  }
};

/**
 * One list load per token. Concurrent callers share the in-flight promise.
 * A warm cache skips `load`. A real CLI failure, including an empty parse, is
 * remembered for 60 seconds so the next turn uses the last-known-good list
 * instead of spawning again. That memo is not longer than 60 seconds.
 * Gate busy, queue timeout, and abort are not remembered. `load` returns
 * undefined when the list could not be read; throw {@link CursorModelListSkippedError}
 * when the gate rejected the load.
 */
export const loadCursorModelsOnce = (
  token: string,
  load: () => Promise<CursorAgentModel[] | undefined>,
): Promise<CursorAgentModel[] | undefined> => {
  const cached = getCachedCursorModels(token);
  if (cached) return Promise.resolve(cached);

  const key = tokenCacheKey(token);
  const now = Date.now();
  const failedUntil = listLoadFailures.get(key);
  if (failedUntil !== undefined && failedUntil > now) {
    return Promise.resolve(readLastKnownGoodCursorModels(token));
  }
  if (failedUntil !== undefined) listLoadFailures.delete(key);

  const existing = inflightLoads.get(key);
  if (existing) return existing;

  const slot: { current?: Promise<CursorAgentModel[] | undefined> } = {};
  const pending = (async () => {
    try {
      const models = await load();
      if (!models || models.length === 0) {
        rememberCliListFailure(key);
        return readLastKnownGoodCursorModels(token);
      }
      return models;
    } catch (error) {
      if (!isSkippedListLoad(error)) rememberCliListFailure(key);
      return readLastKnownGoodCursorModels(token);
    } finally {
      if (inflightLoads.get(key) === slot.current) inflightLoads.delete(key);
    }
  })();
  slot.current = pending;
  inflightLoads.set(key, pending);
  return pending;
};

/**
 * Concrete id when no live list is available.
 *
 * An id that already carries an effort token is unchanged. A collapsed base in
 * the static cursor bank (`extendParams` includes `cursorReasoningEffort`) gets
 * the requested effort, else the card's `defaultEffortLevel`, else `high`, with
 * `-fast` kept last. An id with no version-like digit (`auto`, `composer`)
 * never gains an effort suffix: `auto` + `high` stays `auto`. Any other id
 * stays unchanged unless an effort was explicitly requested and the id is not
 * in the bank — then that effort is appended the same way. `composer-2.5`
 * stays itself. Ids that are no longer in the static bank (`gpt-5.6-sol`,
 * `kimi-k3`) stay themselves when no effort is sent; an explicit effort is
 * appended only when the id has a version-like digit (`gpt-5.6-sol` + `high`
 * becomes `gpt-5.6-sol-high`). A collapsed bank base uses its
 * `defaultEffortLevel` (`cursor-grok-4.6` becomes `cursor-grok-4.6-high`).
 * `grok-4.7` + `high` becomes `grok-4.7-high`, and `grok-4.7` with no effort
 * stays `grok-4.7`.
 */
const hasVersionLikeDigit = (id: string): boolean => /\d/.test(id);

export const synthesizeCursorModelId = (model: string, effort?: string | null): string => {
  const parsed = parseCursorModelId(model);
  if (parsed.effort) return model;

  const bare = parsed.fast ? parsed.baseId.slice(0, -'-fast'.length) : parsed.baseId;
  const withLevel = (level: string): string =>
    parsed.fast ? `${bare}-${level}-fast` : `${bare}-${level}`;
  const requested = typeof effort === 'string' && effort.length > 0 ? effort : undefined;
  const collapsedDefault = cursorEffortDefaults.get(model) ?? cursorEffortDefaults.get(bare);
  if (collapsedDefault !== undefined) return withLevel(requested ?? collapsedDefault);
  if (
    requested &&
    !cursorBankIds.has(model) &&
    !cursorBankIds.has(bare) &&
    hasVersionLikeDigit(bare)
  ) {
    return withLevel(requested);
  }
  return model;
};

/**
 * When the live list has members of this base but they do not form a
 * multi-level group, use one of those concrete ids. That keeps bare medium
 * ids, `extra-high`, and `-<effort>-thinking` instead of inventing
 * `<base>-<level>`.
 */
const resolveFromListedMembers = (
  list: readonly CursorAgentModel[],
  model: string,
  effort?: string | null,
): string | undefined => {
  const members = list.filter((row) => parseCursorModelId(row.id).baseId === model);
  if (members.length === 0) return undefined;
  const requested = typeof effort === 'string' && effort.length > 0 ? effort : undefined;
  if (requested) {
    const exact = members.find((row) => parseCursorModelId(row.id).effort === requested);
    if (exact) return exact.id;
  }
  return members[0]?.id;
};

/**
 * Concrete CLI id for a turn.
 *
 * A warm cache, or the last-known-good list when that cache is cold, is
 * resolved with CLI names: exact level, else nearest, ties toward the stronger
 * level; no effort uses the group's default member. A listed group that did
 * not collapse still resolves to a real member id. Synthesis
 * (`synthesizeCursorModelId`) runs only when neither list exists.
 */
export const resolveCachedCursorModelId = (
  token: string,
  model: string,
  effort?: string | null,
): string => {
  const listed = getCachedCursorModels(token) ?? readLastKnownGoodCursorModels(token);
  if (!listed) return synthesizeCursorModelId(model, effort);

  const resolved = resolveCursorModelId(listed, model, effort);
  if (resolved !== model) return resolved;
  if (listed.some((row) => row.id === model)) return model;
  if (parseCursorModelId(model).effort) return model;
  return resolveFromListedMembers(listed, model, effort) ?? model;
};

const MAX_MODELS_STDOUT_CHARS = 1_000_000;

/**
 * The caller owns the gate: it must be acquired BEFORE the scratch dir and the config
 * seed are staged, so a request that is going to be rejected as overloaded never writes
 * to the shared seed (and never copies a stale snapshot back over a fresher one).
 *
 * The models cache is re-read here because the caller checked it before waiting in the
 * queue: a concurrent turn may have filled it while this one was queued, and answering
 * from the cache is cheaper than spawning the CLI again.
 */
export const runListModels = async (params: {
  cwd: string;
  env: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs: number;
  token: string;
}): Promise<Response> => {
  const cached = getCachedCursorModels(params.token);
  if (cached) {
    return new Response(JSON.stringify({ models: cached }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    });
  }

  let child: ChildProcessWithoutNullStreams;
  try {
    const resolved = resolveCursorCliCached();
    child = spawn(resolved.command, [...resolved.args, '--list-models'], {
      cwd: params.cwd,
      // The child env is intentionally a clean allowlist, not the process env; the
      // ProcessEnv augmentation only describes what THIS process expects.
      env: params.env as NodeJS.ProcessEnv,
      stdio: 'pipe',
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'failed to start';
    throw new CursorAgentUnavailableError(
      `Cursor Agent CLI was not found: failed to start (${trimErrorMessage(detail, params.token)}).`,
    );
  }

  const stdout = { text: '' };
  const stderr = { text: '' };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => appendBounded(stdout, chunk, MAX_MODELS_STDOUT_CHARS));
  child.stderr.on('data', (chunk: string) => appendDiagnostic(stderr, chunk));
  child.stdin.on('error', () => undefined);
  child.stdin.end();

  const abort = () => killChild(child);
  params.signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abort();
  }, params.timeoutMs);
  timeout.unref?.();

  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', (error) => reject(error));
      child.on('close', (exitCode) => resolve(exitCode));
    });
    if (params.signal?.aborted) throw createAbortError();
    // Only a clean exit with at least one model is cached or persisted. A
    // timeout, a signal kill (`code === null`), a non-zero exit, or an empty
    // parse must not hide a saved list. An empty parse is a failure for
    // resolution and is not stored in the 10 minute cache.
    if (timedOut) return jsonError(503, 'cli_error', 'model list timed out');
    const combined = `${stdout.text}\n${stderr.text}`;
    if (code !== 0) {
      const message =
        trimErrorMessage(combined, params.token) ||
        (code === null ? 'model list ended unexpectedly' : `CLI exited ${code}`);
      if (typeof code === 'number' && looksLikeAuthFailure(combined)) {
        return jsonError(401, 'unauthorized', message);
      }
      return jsonError(503, 'cli_error', message);
    }
    const models = parseCursorModelList(stdout.text);
    if (models.length === 0) return jsonError(503, 'cli_error', 'model list was empty');
    setCachedCursorModels(params.token, models);
    persistLastKnownGoodCursorModels(params.token, models);
    return new Response(JSON.stringify({ models }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    const detail = error instanceof Error ? error.message : 'CLI failed';
    return jsonError(503, 'cli_error', trimErrorMessage(detail, params.token));
  } finally {
    clearTimeout(timeout);
    params.signal?.removeEventListener('abort', abort);
  }
};
