import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn } from 'node:child_process';

import { CURSOR_ACCOUNT_HEADER } from '@lobechat/model-runtime';

import { resolveCursorAgentConfigSeedDir } from './configSeed';
import type { CursorAgentStatePaths } from './env';
import { buildCursorAgentChildEnv, ensureCursorAgentStateDir } from './env';
import { CursorAgentPolicyError, CursorAgentUnavailableError } from './errors';
import {
  CursorModelListSkippedError,
  getCachedCursorModels,
  loadCursorModelsOnce,
  resetCursorModelsCache,
  resolveCachedCursorModelId,
  runListModels,
} from './models';
import { resolveCursorCliCached } from './resolveCli';
import { createAbortError, jsonError, mapGateError, TurnGate } from './transport.gate';
import type { TurnRequest } from './transport.parseTurn';
import { isCursorModelId, parseTurnBody } from './transport.parseTurn';
import { relayCliStream, trimErrorMessage } from './transport.relay';
import type { CursorConfigSeedGeneration, CursorScratch, TurnScratch } from './transport.scratch';
import {
  copyTurnConfigSeedBack,
  createScratchRoot,
  removeScratch,
  seedTurnConfig,
  writeTurnScratch,
} from './transport.scratch';

export { resetCursorModelsCache };
export type { CursorConfigSeedGeneration } from './transport.scratch';

const ORIGIN_HOST = 'cursor.local';
const SKIP_LIST_FAILURE_CODES = new Set(['overloaded', 'queue_timeout']);

const listFailureCode = (body: ArrayBuffer): string | undefined => {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as { error?: { code?: unknown } };
    return typeof parsed.error?.code === 'string' ? parsed.error.code : undefined;
  } catch {
    return undefined;
  }
};
const DEFAULT_MAX_CONCURRENCY = 4;
const DEFAULT_MAX_QUEUE = 16;
const DEFAULT_TURN_TIMEOUT_MS = 600_000;
const DEFAULT_QUEUE_TIMEOUT_MS = 60_000;
const MODELS_TIMEOUT_MS = 60_000;
/** A turn waits this long for a cold list, then continues on the saved list. */
const TURN_LIST_LOAD_WAIT_MS = 15_000;

export const CURSOR_AGENT_MAX_CONCURRENCY_ENV = 'CURSOR_AGENT_MAX_CONCURRENCY';
export const CURSOR_AGENT_MAX_QUEUE_ENV = 'CURSOR_AGENT_MAX_QUEUE';
export const CURSOR_AGENT_TURN_TIMEOUT_MS_ENV = 'CURSOR_AGENT_TURN_TIMEOUT_MS';

const FETCH_CACHE_MAX = 4;
const keyed = new Map<string, { fetch: typeof fetch; lastUsed: number }>();

export interface CursorAgentFetchOptions {
  /**
   * How long a turn waits for a cold `--list-models` before resolving from the
   * saved list. The load keeps running and fills the cache. Default 15 seconds.
   */
  listLoadWaitMs?: number;
  maxConcurrency?: number;
  maxQueue?: number;
  proxyUrl?: string | null;
  queueTimeoutMs?: number;
  turnTimeoutMs?: number;
}

/**
 * Wait until the shared list load settles, the caller aborts, or `waitMs`
 * elapses. Timing out does not cancel `pending`: the load keeps running and
 * fills the cache for a later turn.
 */
const waitForTurnListLoad = (
  pending: Promise<unknown>,
  signal: AbortSignal | undefined,
  waitMs: number,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    let settled = false;
    // `finish` reads the timeout id, which is assigned once below.
    const timer: { id?: ReturnType<typeof setTimeout> } = {};
    let onAbort = () => undefined as void;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (timer.id) clearTimeout(timer.id);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    onAbort = () => finish(createAbortError());
    timer.id = setTimeout(() => finish(), waitMs);
    timer.id.unref?.();
    signal?.addEventListener('abort', onAbort);
    pending.then(
      () => finish(),
      () => finish(),
    );
  });

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const MAX_ACCOUNT_ID_CHARS = 512;

const hasControlChars = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index)!;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

const extractBearerToken = (headers: Headers): string | undefined => {
  const header = headers.get('authorization');
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  const token = match?.[1];
  if (!token || hasControlChars(token)) return undefined;
  return token;
};

/**
 * Private hop-by-hop account id. Ill-formed values are dropped (the seed then keys
 * off the bearer digest) rather than failing the request. The header is never copied
 * into env, argv, the history file, or logs.
 */
const extractAccountId = (headers: Headers): string | undefined => {
  const raw = headers.get(CURSOR_ACCOUNT_HEADER)?.trim();
  if (!raw || raw.length > MAX_ACCOUNT_ID_CHARS || hasControlChars(raw)) return undefined;
  return raw;
};

const parseRequest = (input: RequestInfo | URL, init?: RequestInit): Request => {
  if (input instanceof Request) {
    return init ? new Request(input, init) : input;
  }
  return new Request(String(input), init);
};

const assertCursorLocal = (url: URL): void => {
  if (url.protocol !== 'https:' || url.hostname !== ORIGIN_HOST) {
    throw new CursorAgentPolicyError(`refuses ${url.protocol}//${url.hostname}`);
  }
};

/**
 * Print-mode argv. Hidden flags (`--allowed-tools`, `--single-turn`, `--disable-*`)
 * are present in this CLI build (2026.08.11-e8db854) even though `cursor-agent --help`
 * hides them — confirmed by commander accepting them without "unknown option".
 *
 * `--exclude-workspace-context` is accepted by commander but the Agent server
 * returns `[invalid_argument] Workspace context exclusion is not allowed for this
 * user, team, or selected model` (live, 2026-08-17), so it is omitted.
 *
 * `--new-session-id <uuid>` is a hidden root option that DOES apply to `-p`
 * (verified live, 2026-08-18: the emitted `session_id` on every stream-json line
 * equals the value passed). The CLI claims the id by creating its session directory,
 * so it must be unique per config dir — which it is: every turn gets a fresh
 * `CURSOR_CONFIG_DIR`. It cannot be combined with `--resume` / `--continue`, and we
 * use neither: history is replayed through `--conversation-history-file`.
 *
 * `--allowed-tools` takes proto `ToolCall` oneof field names
 * (`update_todos_tool_call`, `web_search_tool_call`, …), not the user-facing
 * permission string `WebSearch`. Confirmed against cursor-agent 2026.08.11-e8db854.
 *
 * Print mode (`-p`) has no TTY approval prompt. The allowlist alone still
 * REJECTS WebSearch with "User Rejected" (live, 2026.08.11); `-f` / `--force`
 * ("allow unless explicitly denied") is required to auto-accept it. `-f` does
 * not expand the tool set: `--mode ask` is always on (CLI maps it to internal
 * metadata mode `search` — Q&A, read-only, no edits or command execution;
 * sandbox policy becomes `workspace_readonly`), and `--allowed-tools` still
 * lists only todos plus, when search is on, `web_search_tool_call`. Shell /
 * edit / delete oneofs are never on that list.
 */
export const CURSOR_WEB_SEARCH_TOOL = 'web_search_tool_call';
const CURSOR_TODOS_TOOL = 'update_todos_tool_call';

export const buildTurnArgv = (turn: TurnRequest, scratch: TurnScratch): string[] => {
  const allowedTools = turn.enabledSearch
    ? `${CURSOR_TODOS_TOOL},${CURSOR_WEB_SEARCH_TOOL}`
    : CURSOR_TODOS_TOOL;
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--stream-partial-output',
    '--mode',
    'ask',
    '--single-turn',
    '--trust',
    ...(turn.enabledSearch ? ['-f'] : []),
    '--disable-indexing',
    '--disable-codebase-ref',
    '--disable-auto-update',
    '--disable-project-configs',
    '--allowed-tools',
    allowedTools,
    '--model',
    turn.model,
    '--conversation-history-file',
    scratch.historyPath,
  ];
  if (turn.sessionId) {
    args.push('--new-session-id', turn.sessionId);
  }
  for (const path of scratch.imagePaths) {
    args.push('--image', path);
  }
  args.push('--', turn.prompt);
  return args;
};

const spawnCursor = (
  cliArgs: string[],
  options: { cwd: string; env: Record<string, string> },
): ChildProcessWithoutNullStreams => {
  const resolved = resolveCursorCliCached();
  return spawn(resolved.command, [...resolved.args, ...cliArgs], {
    cwd: options.cwd,
    // The child env is intentionally a clean allowlist, not the process env; the
    // ProcessEnv augmentation only describes what THIS process expects.
    env: options.env as NodeJS.ProcessEnv,
    stdio: 'pipe',
  });
};

/**
 * fetch-compatible transport that intercepts `https://cursor.local/*` and spawns
 * the Cursor CLI. Anything else is refused (the child is invisible to the SSRF stack).
 */
export const createCursorAgentFetch = (options: CursorAgentFetchOptions = {}): typeof fetch => {
  const maxConcurrency =
    options.maxConcurrency ??
    parsePositiveInt(process.env[CURSOR_AGENT_MAX_CONCURRENCY_ENV], DEFAULT_MAX_CONCURRENCY);
  const maxQueue =
    options.maxQueue ??
    parsePositiveInt(process.env[CURSOR_AGENT_MAX_QUEUE_ENV], DEFAULT_MAX_QUEUE);
  const turnTimeoutMs =
    options.turnTimeoutMs ??
    parsePositiveInt(process.env[CURSOR_AGENT_TURN_TIMEOUT_MS_ENV], DEFAULT_TURN_TIMEOUT_MS);
  const queueTimeoutMs = options.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS;
  const listLoadWaitMs = options.listLoadWaitMs ?? TURN_LIST_LOAD_WAIT_MS;
  const gate = new TurnGate(maxConcurrency, maxQueue);
  const proxyUrl = options.proxyUrl;

  /**
   * GET /v1/models body: admission, then scratch + config seed, then
   * `runListModels`, then copy the seed back and release. A turn that misses
   * the cache uses this same path and afterwards acquires the gate again.
   */
  const listCursorModels = async (params: {
    accountSeedDir: () => string;
    signal?: AbortSignal;
    state: CursorAgentStatePaths;
    token: string;
  }): Promise<Response> => {
    const cached = getCachedCursorModels(params.token);
    if (cached) {
      return new Response(JSON.stringify({ models: cached }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    }

    // Admission first: a rejected request must not touch the shared config seed.
    try {
      await gate.acquire(queueTimeoutMs, params.signal);
    } catch (error) {
      const mapped = mapGateError(error);
      if (mapped) return mapped;
      throw error;
    }

    let scratch: CursorScratch | undefined;
    // Assigned by the staging step below; the handler returns early when that throws.
    let seedGeneration: CursorConfigSeedGeneration;
    let configSeedDir: string;
    try {
      configSeedDir = params.accountSeedDir();
      scratch = createScratchRoot(params.state.turns);
      seedGeneration = seedTurnConfig(configSeedDir, scratch.configDir);
    } catch (error) {
      gate.release();
      removeScratch(scratch?.root);
      const detail = error instanceof Error ? error.message : 'failed to stage model files';
      return jsonError(503, 'cli_error', trimErrorMessage(detail, params.token));
    }

    const env = buildCursorAgentChildEnv({
      proxyUrl,
      stateDir: params.state.root,
      token: params.token,
      turnRoot: scratch.root,
    });
    try {
      return await runListModels({
        cwd: scratch.root,
        env,
        signal: params.signal,
        timeoutMs: Math.min(turnTimeoutMs, MODELS_TIMEOUT_MS),
        token: params.token,
      });
    } catch (error) {
      if (error instanceof CursorAgentUnavailableError) {
        return jsonError(503, 'cli_unavailable', error.message);
      }
      throw error;
    } finally {
      copyTurnConfigSeedBack(scratch.configDir, configSeedDir, seedGeneration);
      removeScratch(scratch.root);
      gate.release();
    }
  };

  const cursorFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = parseRequest(input, init);
    const url = new URL(request.url);
    assertCursorLocal(url);

    if (request.signal?.aborted) throw createAbortError();

    let cliReady: ReturnType<typeof resolveCursorCliCached>;
    try {
      cliReady = resolveCursorCliCached();
    } catch (error) {
      if (error instanceof CursorAgentUnavailableError) {
        return jsonError(503, 'cli_unavailable', error.message);
      }
      throw error;
    }
    void cliReady;

    const token = extractBearerToken(request.headers);
    if (!token) return jsonError(401, 'unauthorized', 'missing bearer token');

    const accountId = extractAccountId(request.headers);
    // Hop-by-hop only: drop before any CLI-facing work. Request headers are not
    // forwarded to spawn; this is belt-and-suspenders against a future copy.
    try {
      request.headers.delete(CURSOR_ACCOUNT_HEADER);
    } catch {
      // `Request.headers` is immutable in some runtimes; the CLI never sees them.
    }

    const state = ensureCursorAgentStateDir();
    const accountSeedDir = () =>
      resolveCursorAgentConfigSeedDir({
        seedRoot: state.configSeed,
        token,
        ...(accountId ? { accountId } : {}),
      });

    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'GET' && pathname === '/v1/models') {
      return listCursorModels({
        accountSeedDir,
        signal: request.signal,
        state,
        token,
      });
    }

    if (request.method === 'POST' && pathname === '/v1/turn') {
      const parsed = await parseTurnBody(request);
      if (parsed instanceof Response) return parsed;

      // A cold cache loads the live list on its own gate slot (one load per
      // token; concurrent turns share it). The turn waits at most 15 seconds,
      // then resolves from the last-known-good snapshot or synthesis. The load
      // is not tied to this request: it keeps running and fills the cache. A
      // real CLI failure is remembered for 60 seconds. Gate busy, queue
      // timeout, and abort are not. Resolution stays before the turn's
      // admission so a rejected id never takes a turn slot. The resolved id is
      // checked with the same rule as the request body — a mapper result must
      // not reach `--model` unchecked.
      if (!getCachedCursorModels(token)) {
        const pending = loadCursorModelsOnce(token, async () => {
          const response = await listCursorModels({
            accountSeedDir,
            state,
            token,
          });
          const body = await response.arrayBuffer();
          if (!response.ok) {
            const code = listFailureCode(body);
            if (code && SKIP_LIST_FAILURE_CODES.has(code)) throw new CursorModelListSkippedError();
            return undefined;
          }
          return getCachedCursorModels(token);
        });
        await waitForTurnListLoad(pending, request.signal, listLoadWaitMs);
        if (request.signal?.aborted) throw createAbortError();
      }
      const resolvedModel = resolveCachedCursorModelId(token, parsed.model, parsed.effort);
      if (!isCursorModelId(resolvedModel)) {
        return jsonError(400, 'invalid_request', 'invalid model id');
      }
      const turn = resolvedModel === parsed.model ? parsed : { ...parsed, model: resolvedModel };

      try {
        await gate.acquire(queueTimeoutMs, request.signal);
      } catch (error) {
        const mapped = mapGateError(error);
        if (mapped) return mapped;
        throw error;
      }

      let scratch: TurnScratch | undefined;
      // Assigned by the staging step below; the handler returns early when that throws.
      let seedGeneration: CursorConfigSeedGeneration;
      let configSeedDir: string;
      try {
        configSeedDir = accountSeedDir();
        scratch = writeTurnScratch(state.turns, turn);
        seedGeneration = seedTurnConfig(configSeedDir, scratch.configDir);
      } catch (error) {
        gate.release();
        removeScratch(scratch?.root);
        const detail = error instanceof Error ? error.message : 'failed to stage turn files';
        return jsonError(503, 'cli_error', trimErrorMessage(detail, token));
      }

      const env = buildCursorAgentChildEnv({
        proxyUrl,
        stateDir: state.root,
        token,
        turnRoot: scratch.root,
      });

      let child: ChildProcessWithoutNullStreams;
      const spawnedAt = Date.now();
      try {
        child = spawnCursor(buildTurnArgv(turn, scratch), { cwd: scratch.root, env });
      } catch (error) {
        gate.release();
        removeScratch(scratch.root);
        const detail = error instanceof Error ? error.message : 'failed to start';
        return jsonError(
          503,
          'cli_unavailable',
          `Cursor Agent CLI was not found: failed to start (${trimErrorMessage(detail, token)}).`,
        );
      }

      let released = false;
      const onFinally = () => {
        if (!released) {
          released = true;
          gate.release();
        }
        copyTurnConfigSeedBack(scratch.configDir, configSeedDir, seedGeneration);
        removeScratch(scratch.root);
      };

      const stream = relayCliStream({
        child,
        onFinally,
        signal: request.signal,
        spawnedAt,
        timeoutMs: turnTimeoutMs,
        token,
      });
      return new Response(stream, {
        headers: { 'content-type': 'text/event-stream' },
        status: 200,
      });
    }

    return jsonError(404, 'not_found', 'unknown Cursor Agent endpoint');
  };

  return cursorFetch as typeof fetch;
};

/**
 * Cursor Agent fetch keyed by outlet `proxyUrl` (LRU 4). CLI resolution happens
 * on the FIRST REQUEST, not at import time, so a deployment without the CLI
 * still boots and only this provider reports itself unavailable.
 */
export const getCursorAgentFetch = (proxyUrl?: string | null): typeof fetch => {
  const key = proxyUrl ?? '';
  const existing = keyed.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.fetch;
  }
  while (keyed.size >= FETCH_CACHE_MAX) {
    let oldestKey: string | undefined;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [entryKey, value] of keyed) {
      if (value.lastUsed < oldestAt) {
        oldestAt = value.lastUsed;
        oldestKey = entryKey;
      }
    }
    if (oldestKey !== undefined) keyed.delete(oldestKey);
    else break;
  }
  const impl = createCursorAgentFetch(proxyUrl ? { proxyUrl } : {});
  keyed.set(key, { fetch: impl, lastUsed: Date.now() });
  return impl;
};

/** Drop cached transports whose key is not in `keep` (empty string = no-proxy transport). */
export const evictCursorAgentFetchExcept = (keep: ReadonlySet<string>): void => {
  for (const key of keyed.keys()) {
    if (key && !keep.has(key)) keyed.delete(key);
  }
};

/** Test seam only. */
export const resetCursorAgentFetch = (): void => {
  keyed.clear();
};
