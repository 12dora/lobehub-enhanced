import { chmod, mkdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeAudit } from './audit.ts';
import { assertBrokerToken, bearerAuthorized } from './auth.ts';
import {
  DEFAULT_CONFIG_DIR,
  DEFAULT_DWS_BIN,
  DEFAULT_HOME,
  DEFAULT_KEYCHAIN_DIR,
  DEFAULT_PORT,
  MAX_BODY_BYTES,
  PROFILE_CACHE_MS,
  VERSION_RETRY_MS,
} from './constants.ts';
import { runDownload } from './download.ts';
import { BrokerError, ClientClosedError, QueueTimeoutError } from './errors.ts';
import type { LoginService } from './login.ts';
import { createLoginService } from './login.ts';
import { isValidProfile, prepareExec } from './ops.ts';
import type { ProfileStore } from './profiles.ts';
import { createProfiles } from './profiles.ts';
import { startRetention } from './retention.ts';
import type { Runner } from './runner.ts';
import { createRunner, toExecResult } from './runner.ts';
import type { ExecResult } from './types.ts';

// eslint-disable-next-line no-control-regex -- reject/strip control characters in untrusted input
const CONTROL = /[\u0000-\u001F\u007F]/;

export function parseDwsVersion(text: string): string {
  const match = text.match(/v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  if (!match?.[0]) return '';
  return match[0].startsWith('v') ? match[0] : `v${match[0]}`;
}

export async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}

export interface StartOptions {
  bin: string;
  cacheMs?: number;
  childTimeoutMs?: number;
  concurrency?: number;
  configDir: string;
  home: string;
  host?: string;
  keepMs?: number;
  keychainDir: string;
  loginChildTimeoutMs?: number;
  loginStartDeadlineMs?: number;
  maxFileBytes?: number;
  maxPending?: number;
  port?: number;
  queueTimeoutMs?: number;
  readyTimeoutMs?: number;
  stdoutCap?: number;
  token: string;
  versionRetryMs?: number;
  versionTimeoutMs?: number;
}

export interface RunningServer {
  close: () => Promise<void>;
  port: number;
  url: string;
}

function isDict(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(payload);
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } });
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    req.resume();
    return Promise.reject(new BrokerError(400, 'INVALID_ARGS', '请求体不能超过 64KB'));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (error?: BrokerError): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(Buffer.concat(chunks));
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        finish(new BrokerError(400, 'INVALID_ARGS', '请求体不能超过 64KB'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish());
    req.on('error', () => finish());
  });
}

function parseObject(buf: Buffer): Record<string, unknown> {
  if (buf.length === 0) return {};
  let value: unknown;
  try {
    value = JSON.parse(buf.toString('utf8'));
  } catch {
    throw new BrokerError(400, 'INVALID_ARGS', '请求体不是合法 JSON');
  }
  if (!isDict(value)) throw new BrokerError(400, 'INVALID_ARGS', '参数不合法');
  return value;
}

function rejectUnknown(body: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!keys.includes(key)) throw new BrokerError(400, 'INVALID_ARGS', '包含未知参数');
  }
}

function optionalText(
  body: Record<string, unknown>,
  key: string,
  label: string,
): string | undefined {
  if (
    !Object.prototype.hasOwnProperty.call(body, key) ||
    body[key] === undefined ||
    body[key] === ''
  )
    return undefined;
  const value = body[key];
  if (typeof value !== 'string' || value.length > 128 || CONTROL.test(value)) {
    throw new BrokerError(400, 'INVALID_ARGS', `${label}不合法`);
  }
  return value;
}

function decodeProfile(raw: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new BrokerError(400, 'INVALID_PROFILE', '身份标识不合法');
  }
  if (!isValidProfile(decoded)) throw new BrokerError(400, 'INVALID_PROFILE', '身份标识不合法');
  return decoded;
}

export async function startServer(options: StartOptions): Promise<RunningServer> {
  const token = assertBrokerToken(options.token);
  await ensurePrivateDir(options.configDir);
  await ensurePrivateDir(options.keychainDir);
  await ensurePrivateDir(options.home);

  const runner: Runner = createRunner({
    bin: options.bin,
    concurrency: options.concurrency,
    queueTimeoutMs: options.queueTimeoutMs,
    stdoutCap: options.stdoutCap,
  });
  const profiles: ProfileStore = createProfiles(runner, {
    cacheMs: options.cacheMs ?? PROFILE_CACHE_MS,
  });
  const logins: LoginService = createLoginService(runner, profiles, {
    childTimeoutMs: options.loginChildTimeoutMs ?? options.childTimeoutMs,
    keepMs: options.keepMs,
    maxPending: options.maxPending,
    readyTimeoutMs: options.readyTimeoutMs,
    startDeadlineMs: options.loginStartDeadlineMs,
  });
  const stopRetention = startRetention(options.configDir);

  const versionRetryMs = options.versionRetryMs ?? VERSION_RETRY_MS;
  let dwsVersion = '';
  let versionCheckedAt = 0;
  let versionProbe: Promise<void> | undefined;

  async function probeVersion(): Promise<void> {
    versionCheckedAt = Date.now();
    let parsed = '';
    let logged = false;
    try {
      const versionRun = await runner.run({
        argv: ['version'],
        lockProfile: false,
        timeoutMs: options.versionTimeoutMs ?? 10_000,
        useSlot: false,
      });
      if (
        versionRun.exitCode === 0 &&
        !versionRun.timedOut &&
        !versionRun.spawnError &&
        !versionRun.outputTooLarge
      ) {
        parsed = parseDwsVersion(`${versionRun.stdout}\n${versionRun.stderr}`);
      }
    } catch (error) {
      logged = true;
      console.error(error instanceof Error ? error.message : '未能读取 dws 版本');
    }
    if (parsed) {
      dwsVersion = parsed;
      return;
    }
    // A failed re-probe drops a previously healthy version until a later one succeeds.
    dwsVersion = '';
    if (!logged) console.error('未能读取 dws 版本');
  }

  await probeVersion();

  async function healthz(): Promise<{ body: { dwsVersion: string; ok: boolean }; status: number }> {
    if (Date.now() - versionCheckedAt >= versionRetryMs) {
      // Background only, including after a healthy startup. Do not await:
      // the container HEALTHCHECK times out after 5 s, and this call returns the previous result.
      versionProbe ??= probeVersion().finally(() => {
        versionProbe = undefined;
      });
    }
    if (!dwsVersion) return { body: { dwsVersion: '', ok: false }, status: 503 };
    return { body: { dwsVersion, ok: true }, status: 200 };
  }

  async function exec(body: Record<string, unknown>, signal?: AbortSignal): Promise<ExecResult> {
    rejectUnknown(body, ['actor', 'args', 'op', 'profile', 'requestId']);
    optionalText(body, 'requestId', '请求号');
    const actor = optionalText(body, 'actor', '调用方');
    if (typeof body.profile !== 'string')
      throw new BrokerError(400, 'INVALID_PROFILE', '身份标识不合法');
    const prepared = prepareExec(body.op, body.profile, body.args);
    const known = await profiles.has(body.profile);
    if (!known) throw new BrokerError(404, 'PROFILE_NOT_FOUND', '未找到该钉钉身份');
    const opSignal = prepared.write ? undefined : signal;
    if (opSignal?.aborted) throw new ClientClosedError();
    const started = Date.now();
    let result: ExecResult;
    let exitCode: number | null = null;
    let stdoutBytes = 0;
    let durationMs: number;
    try {
      if (prepared.download) {
        const downloaded = await runDownload(
          runner,
          {
            argv: prepared.argv,
            profile: body.profile,
            signal: opSignal,
            timeoutMs: prepared.timeoutMs,
          },
          options.maxFileBytes,
        );
        result = downloaded.result;
        exitCode = downloaded.run?.exitCode ?? null;
        stdoutBytes = downloaded.run?.stdoutBytes ?? 0;
        durationMs = downloaded.run?.durationMs ?? Date.now() - started;
      } else {
        const run = await runner.run({
          argv: prepared.argv,
          profile: body.profile,
          signal: opSignal,
          stdin: prepared.stdin,
          timeoutMs: prepared.timeoutMs,
        });
        result = toExecResult(run);
        exitCode = run.exitCode;
        stdoutBytes = run.stdoutBytes;
        durationMs = run.durationMs;
      }
    } catch (error) {
      if (error instanceof ClientClosedError) throw error;
      if (!(error instanceof QueueTimeoutError)) throw error;
      result = { error: { code: 'TIMEOUT', message: error.message }, ok: false };
      durationMs = Date.now() - started;
    }
    if (result.ok) durationMs = result.durationMs || durationMs;
    writeAudit({
      actor,
      durationMs,
      errorCode: result.ok ? '' : result.error.code,
      event: 'exec',
      exitCode,
      op: prepared.op,
      profile: body.profile,
      stdoutBytes,
    });
    return result;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const method = req.method ?? 'GET';
    if (method === 'GET' && pathname === '/healthz') {
      const health = await healthz();
      sendJson(res, health.status, health.body);
      return;
    }
    if (!bearerAuthorized(req.headers.authorization, token)) {
      sendError(res, 401, 'UNAUTHORIZED', '未授权');
      return;
    }

    if (pathname === '/v1/login') {
      if (method !== 'POST') return sendError(res, 405, 'METHOD_NOT_ALLOWED', '方法不允许');
      const body = parseObject(await readBody(req));
      rejectUnknown(body, ['actor', 'expectedProfile']);
      const job = await logins.start({
        actor: optionalText(body, 'actor', '调用方'),
        expectedProfile: body.expectedProfile,
      });
      sendJson(res, 201, job);
      return;
    }

    const loginMatch = pathname.match(/^\/v1\/login\/([\w-]{24})$/);
    if (loginMatch?.[1]) {
      if (method === 'GET') {
        const job = logins.get(loginMatch[1]);
        if (!job) return sendError(res, 404, 'LOGIN_NOT_FOUND', '登录任务不存在或已过期');
        sendJson(res, 200, job);
        return;
      }
      if (method === 'DELETE') {
        const cancelled = await logins.cancel(loginMatch[1]);
        if (!cancelled) return sendError(res, 404, 'LOGIN_NOT_FOUND', '登录任务不存在或已过期');
        sendJson(res, 200, cancelled);
        return;
      }
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', '方法不允许');
    }

    const statusMatch = pathname.match(/^\/v1\/profiles\/([^/]+)\/status$/);
    if (statusMatch?.[1]) {
      if (method !== 'GET') return sendError(res, 405, 'METHOD_NOT_ALLOWED', '方法不允许');
      const profile = decodeProfile(statusMatch[1]);
      const gone = new AbortController();
      const onClose = (): void => {
        if (!res.writableEnded) gone.abort();
      };
      res.on('close', onClose);
      try {
        const status = await profiles.status(profile, undefined, gone.signal);
        sendJson(res, status.httpStatus, status.body);
      } finally {
        res.removeListener('close', onClose);
      }
      return;
    }

    const profileMatch = pathname.match(/^\/v1\/profiles\/([^/]+)$/);
    if (profileMatch?.[1]) {
      if (method !== 'DELETE') return sendError(res, 405, 'METHOD_NOT_ALLOWED', '方法不允许');
      const profile = decodeProfile(profileMatch[1]);
      sendJson(res, 200, await profiles.logout(profile));
      return;
    }

    if (pathname === '/v1/exec') {
      if (method !== 'POST') return sendError(res, 405, 'METHOD_NOT_ALLOWED', '方法不允许');
      const gone = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) gone.abort();
      });
      sendJson(res, 200, await exec(parseObject(await readBody(req)), gone.signal));
      return;
    }

    sendError(res, 404, 'NOT_FOUND', '路径不存在');
  }

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      if (error instanceof ClientClosedError) return;
      if (error instanceof BrokerError) {
        sendError(res, error.status, error.code, error.message);
        return;
      }
      console.error(error instanceof Error ? error.message : '请求失败');
      sendError(res, 500, 'INTERNAL', '内部错误');
    });
  });

  const host = options.host ?? '0.0.0.0';
  const port = options.port ?? DEFAULT_PORT;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address();
  const actual = typeof address === 'object' && address ? address.port : port;

  return {
    port: actual,
    url: `http://127.0.0.1:${actual}`,
    async close() {
      stopRetention();
      logins.stop();
      runner.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === path.resolve(entry);
}

async function main(): Promise<void> {
  let running: RunningServer | undefined;
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (running) void running.close();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  try {
    const token = assertBrokerToken(process.env.DWS_BROKER_TOKEN);
    const port = Number(process.env.PORT ?? DEFAULT_PORT);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT 不合法');
    running = await startServer({
      bin: process.env.DWS_BIN || DEFAULT_DWS_BIN,
      configDir: process.env.DWS_CONFIG_DIR || DEFAULT_CONFIG_DIR,
      home: process.env.HOME || DEFAULT_HOME,
      keychainDir: process.env.DWS_KEYCHAIN_DIR || DEFAULT_KEYCHAIN_DIR,
      port,
      token,
    });
    console.error(`aihub-dws 已监听 0.0.0.0:${running.port}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : '启动失败');
    process.exitCode = 1;
  }
}

if (invokedDirectly()) {
  void main();
}
