import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';

import {
  CHILD_TIMEOUT_MS,
  GLOBAL_CONCURRENCY,
  MESSAGE_MAX,
  QUEUE_TIMEOUT_MS,
  STDERR_CAP_BYTES,
  STDOUT_CAP_BYTES,
} from './constants.ts';
import { ClientClosedError, QueueTimeoutError } from './errors.ts';
import type { ExecErrorCode, ExecResult, RunResult } from './types.ts';

const ENV_KEYS = [
  'PATH',
  'HOME',
  'DWS_CONFIG_DIR',
  'DWS_KEYCHAIN_DIR',
  'TZ',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
] as const;

export function buildChildEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NO_COLOR: '1' };
  for (const key of ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  if (source.DINGTALK_DWS_AGENTCODE) env.DINGTALK_DWS_AGENTCODE = source.DINGTALK_DWS_AGENTCODE;
  return env;
}

export interface SpawnOptions {
  argv: string[];
  cwd?: string;
  onStderr?: (chunk: string) => void;
  stderrCap?: number;
  stdin?: string;
  stdoutCap?: number;
  timeoutMs: number;
}

export interface SpawnHandle {
  done: Promise<RunResult>;
  kill: () => void;
}

export interface RunRequest {
  argv: string[];
  cwd?: string;
  lockProfile?: boolean;
  profile?: string;
  /** Overrides the runner queue budget for this call (profile lock + slot). */
  queueTimeoutMs?: number;
  signal?: AbortSignal;
  stdin?: string;
  timeoutMs?: number;
  useSlot?: boolean;
}

function killChild(child: ChildProcess): void {
  const pid = child.pid;
  if (pid && pid > 0) {
    try {
      process.kill(-pid, 'SIGKILL');
      return;
    } catch {
      // not a process-group leader
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // already exited
  }
}

function clipMessage(message: string, fallback: string): string {
  const cleaned = message
    // eslint-disable-next-line no-control-regex -- strip control characters from CLI output
    .replaceAll(/[\u0000-\u001F]/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
  if (!cleaned || /bearer\s|access_token|refresh_token|secret|authorization:/i.test(cleaned)) {
    return fallback;
  }
  return cleaned.slice(0, MESSAGE_MAX);
}

function messageFromRecord(record: Record<string, unknown>): string | undefined {
  const error = record.error;
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const inner = error as Record<string, unknown>;
    if (typeof inner.message === 'string' && inner.message.trim()) return inner.message;
    if (typeof inner.errorMsg === 'string' && inner.errorMsg.trim()) return inner.errorMsg;
  }
  for (const key of ['message', 'errorMsg', 'errorMessage', 'error']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function parseRecord(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function isJsonNoise(line: string): boolean {
  return /^[[\]{}],?$/.test(line) || /^"[^"]*"\s*:/.test(line);
}

/** JSON `{error:{message}}` / `{message}` / `{errorMsg}`, else the first plain line. */
function textMessage(text: string): string | undefined {
  const fromJson = messageFromRecord(parseRecord(text) ?? {});
  if (fromJson && fromJson.trim() !== '{' && fromJson.trim() !== '}') return fromJson;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || isJsonNoise(line)) continue;
    return line;
  }
  return undefined;
}

function extractCliMessage(stderr: string, stdout: string): string {
  return textMessage(stderr) || textMessage(stdout) || '';
}

function jsonMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  return messageFromRecord(data as Record<string, unknown>);
}

function logicalFailure(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const record = data as Record<string, unknown>;
  return record.ok === false || record.success === false;
}

function parsePat(stderr: string): { code?: string; uri?: string } | undefined {
  const start = stderr.indexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(stderr.slice(start, end + 1)) as {
      code?: unknown;
      data?: { uri?: unknown };
    };
    return {
      code: typeof parsed.code === 'string' ? parsed.code : undefined,
      uri: typeof parsed.data?.uri === 'string' ? parsed.data.uri : undefined,
    };
  } catch {
    return undefined;
  }
}

function fail(
  code: ExecErrorCode,
  message: string,
  exitCode?: number | null,
  patUri?: string,
): ExecResult {
  const error: ExecResult = {
    error: { code, message: message.slice(0, MESSAGE_MAX) },
    ok: false,
  };
  if (typeof exitCode === 'number') error.error.exitCode = exitCode;
  if (patUri) error.error.patUri = patUri;
  return error;
}

export function toExecResult(run: RunResult): ExecResult {
  if (run.outputTooLarge) return fail('OUTPUT_TOO_LARGE', '输出超出大小限制', run.exitCode);
  if (run.timedOut) return fail('TIMEOUT', '执行超时', run.exitCode);
  if (run.spawnError) return fail('INTERNAL', '无法执行 dws');
  const code = run.exitCode;
  if (code === 0) {
    let data: unknown;
    try {
      data = JSON.parse(run.stdout);
    } catch {
      return fail('API_ERROR', '上游返回了无法解析的结果', 0);
    }
    if (logicalFailure(data)) {
      const message = jsonMessage(data) ?? '钉钉接口返回错误';
      if (message.includes('频率超限')) return fail('RATE_LIMITED', '请求频率超限', 0);
      return fail('API_ERROR', clipMessage(message, '钉钉接口返回错误'), 0);
    }
    return { data, durationMs: run.durationMs, ok: true, stdoutBytes: run.stdoutBytes };
  }
  const cliMessage = extractCliMessage(run.stderr, run.stdout);
  if (code === 1) {
    if (`${run.stderr}\n${run.stdout}`.includes('频率超限') || cliMessage.includes('频率超限')) {
      return fail('RATE_LIMITED', '请求频率超限', 1);
    }
    return fail('API_ERROR', clipMessage(cliMessage, '钉钉接口返回错误'), 1);
  }
  if (code === 2) return fail('NOT_AUTHORIZED', '未登录或授权已失效', 2);
  if (code === 3) return fail('VALIDATION', clipMessage(cliMessage, '参数校验失败'), 3);
  if (code === 4) {
    const pat = parsePat(run.stderr);
    if (pat?.code === 'PAT_ORG_POLICY_DENIED')
      return fail('ORG_POLICY_DENIED', '组织策略拒绝了该操作', 4);
    return fail('PAT_REQUIRED', '需要在钉钉权限页确认授权', 4, pat?.uri);
  }
  return fail('INTERNAL', '内部错误', code);
}

export interface Runner {
  acquireProfileLock: (profile: string, waitMs: number) => Promise<() => void>;
  close: () => void;
  run: (request: RunRequest) => Promise<RunResult>;
  spawnChild: (options: SpawnOptions) => SpawnHandle;
}

export function createRunner(options: {
  bin: string;
  concurrency?: number;
  queueTimeoutMs?: number;
  stderrCap?: number;
  stdoutCap?: number;
}): Runner {
  const bin = options.bin;
  const queueTimeoutMs = options.queueTimeoutMs ?? QUEUE_TIMEOUT_MS;
  const stdoutCap = options.stdoutCap ?? STDOUT_CAP_BYTES;
  const stderrCap = options.stderrCap ?? STDERR_CAP_BYTES;
  const concurrency = options.concurrency ?? GLOBAL_CONCURRENCY;
  const active = new Set<ChildProcess>();
  const tails = new Map<string, Promise<void>>();
  let slots = 0;
  const waiters: Array<() => void> = [];

  function releaseSlot(release: { done: boolean }): void {
    if (release.done) return;
    release.done = true;
    slots -= 1;
    const next = waiters.shift();
    if (next) next();
  }

  function onAbort(signal: AbortSignal | undefined, handle: () => void): () => void {
    if (!signal) return () => undefined;
    if (signal.aborted) {
      handle();
      return () => undefined;
    }
    signal.addEventListener('abort', handle, { once: true });
    return () => signal.removeEventListener('abort', handle);
  }

  function acquireSlot(waitMs: number, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new ClientClosedError());
    if (slots < concurrency) {
      slots += 1;
      const state = { done: false };
      return Promise.resolve(() => releaseSlot(state));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const drop = (): void => {
        const index = waiters.indexOf(grant);
        if (index >= 0) waiters.splice(index, 1);
      };
      const finish = (error?: Error, release?: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stop();
        drop();
        if (error) reject(error);
        else if (release) resolve(release);
      };
      const timer = setTimeout(() => finish(new QueueTimeoutError()), waitMs);
      const stop = onAbort(signal, () => finish(new ClientClosedError()));
      function grant(): void {
        if (settled) {
          const wake = waiters.shift();
          if (wake) wake();
          return;
        }
        slots += 1;
        const state = { done: false };
        finish(undefined, () => releaseSlot(state));
      }
      waiters.push(grant);
    });
  }

  function acquireProfileLock(
    profile: string,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new ClientClosedError());
    const prev = tails.get(profile) ?? Promise.resolve();
    let unlock = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const tail = prev.then(() => gate);
    tails.set(profile, tail);
    void tail.finally(() => {
      if (tails.get(profile) === tail) tails.delete(profile);
    });
    return new Promise((resolve, reject) => {
      let gaveUp = false;
      let released = false;
      const safeUnlock = (): void => {
        if (released) return;
        released = true;
        unlock();
      };
      const giveUp = (error: Error): void => {
        if (gaveUp || released) return;
        gaveUp = true;
        clearTimeout(timer);
        stop();
        reject(error);
      };
      const timer = setTimeout(() => giveUp(new QueueTimeoutError()), waitMs);
      const stop = onAbort(signal, () => giveUp(new ClientClosedError()));
      prev.then(
        () => {
          clearTimeout(timer);
          stop();
          if (gaveUp) {
            safeUnlock();
            return;
          }
          resolve(safeUnlock);
        },
        () => {
          clearTimeout(timer);
          stop();
          safeUnlock();
          if (!gaveUp) {
            gaveUp = true;
            reject(new QueueTimeoutError());
          }
        },
      );
    });
  }

  function spawnChild(spawnOptions: SpawnOptions): SpawnHandle {
    const started = Date.now();
    const capOut = spawnOptions.stdoutCap ?? stdoutCap;
    const capErr = spawnOptions.stderrCap ?? stderrCap;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let outputTooLarge = false;
    let timedOut = false;
    let spawnError: string | undefined;
    let exitCode: number | null = null;
    let signal: NodeJS.Signals | null = null;
    let settled = false;

    const child = spawn(bin, spawnOptions.argv, {
      cwd: spawnOptions.cwd,
      detached: true,
      env: buildChildEnv(),
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    active.add(child);

    const kill = (): void => {
      killChild(child);
    };

    child.stdin?.on('error', () => undefined);
    child.stdout?.on('error', () => undefined);
    child.stderr?.on('error', () => undefined);
    if (spawnOptions.stdin !== undefined) child.stdin?.write(spawnOptions.stdin);
    child.stdin?.end();

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, spawnOptions.timeoutMs);

    let stderrBytes = 0;
    const take = (chunk: Buffer, chunks: Buffer[], cap: number, isStdout: boolean): void => {
      if (outputTooLarge) return;
      if (isStdout) stdoutBytes += chunk.length;
      else stderrBytes += chunk.length;
      if ((isStdout ? stdoutBytes : stderrBytes) > cap) {
        outputTooLarge = true;
        chunks.length = 0;
        kill();
        return;
      }
      chunks.push(chunk);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      take(chunk, stdoutChunks, capOut, true);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      spawnOptions.onStderr?.(text);
      take(chunk, stderrChunks, capErr, false);
    });

    const done = new Promise<RunResult>((resolve) => {
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        active.delete(child);
        resolve({
          durationMs: Date.now() - started,
          exitCode,
          outputTooLarge,
          signal,
          spawnError,
          stderr: outputTooLarge ? '' : Buffer.concat(stderrChunks).toString('utf8'),
          stdout: outputTooLarge ? '' : Buffer.concat(stdoutChunks).toString('utf8'),
          stdoutBytes,
          timedOut,
        });
      };
      child.on('error', (error) => {
        spawnError = error.message;
        finish();
      });
      child.on('close', (code, closeSignal) => {
        exitCode = code;
        signal = closeSignal;
        finish();
      });
    });

    return { done, kill };
  }

  async function run(request: RunRequest): Promise<RunResult> {
    if (request.signal?.aborted) throw new ClientClosedError();
    const budget = request.queueTimeoutMs ?? queueTimeoutMs;
    const started = Date.now();
    const left = (): number => Math.max(0, budget - (Date.now() - started));
    let unlock: (() => void) | undefined;
    if (request.lockProfile !== false && request.profile) {
      unlock = await acquireProfileLock(request.profile, left(), request.signal);
    }
    try {
      if (request.signal?.aborted) throw new ClientClosedError();
      let release: (() => void) | undefined;
      if (request.useSlot !== false) release = await acquireSlot(left(), request.signal);
      try {
        if (request.signal?.aborted) throw new ClientClosedError();
        const handle = spawnChild({
          argv: request.argv,
          cwd: request.cwd,
          stdin: request.stdin,
          timeoutMs: request.timeoutMs ?? CHILD_TIMEOUT_MS,
        });
        const signal = request.signal;
        if (signal) {
          const kill = (): void => handle.kill();
          if (signal.aborted) kill();
          else {
            signal.addEventListener('abort', kill, { once: true });
            void handle.done.finally(() => signal.removeEventListener('abort', kill));
          }
        }
        return await handle.done;
      } finally {
        release?.();
      }
    } finally {
      unlock?.();
    }
  }

  function close(): void {
    for (const child of active) killChild(child);
    active.clear();
  }

  return { acquireProfileLock, close, run, spawnChild };
}
