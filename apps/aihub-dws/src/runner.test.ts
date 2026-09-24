import { rm } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyChildEnv,
  FAKE_DWS,
  makeDirs,
  readInvocations,
  sleep,
  writeControl,
} from '../test/harness.ts';
import { ClientClosedError, QueueTimeoutError } from './errors.ts';
import { buildChildEnv, createRunner, toExecResult } from './runner.ts';
import type { RunResult } from './types.ts';

const base = (over: Partial<RunResult> = {}): RunResult => ({
  durationMs: 5,
  exitCode: 0,
  outputTooLarge: false,
  signal: null,
  stderr: '',
  stdout: '{"ok":true,"data":{"n":1}}',
  stdoutBytes: 10,
  timedOut: false,
  ...over,
});

describe('toExecResult', () => {
  it('maps exit codes and hides token-like stderr', () => {
    expect(toExecResult(base()).ok).toBe(true);
    const logical = toExecResult(base({ stdout: '{"ok":false,"message":"模板不存在"}' }));
    expect(logical).toMatchObject({
      error: { code: 'API_ERROR', message: '模板不存在' },
      ok: false,
    });
    const limited = toExecResult(base({ exitCode: 1, stderr: '调用频率超限\n', stdout: '' }));
    expect(limited).toMatchObject({ error: { code: 'RATE_LIMITED' }, ok: false });
    const leaked = toExecResult(
      base({ exitCode: 1, stderr: 'access_token=supersecretvalue\n', stdout: '' }),
    );
    expect(leaked).toMatchObject({
      error: { code: 'API_ERROR', message: '钉钉接口返回错误' },
      ok: false,
    });
    expect(JSON.stringify(leaked)).not.toContain('supersecretvalue');
    expect(toExecResult(base({ exitCode: 2, stdout: '' }))).toMatchObject({
      error: { code: 'NOT_AUTHORIZED' },
    });
    expect(toExecResult(base({ exitCode: 3, stderr: 'bad', stdout: '' }))).toMatchObject({
      error: { code: 'VALIDATION' },
    });
    const pat = toExecResult(
      base({
        exitCode: 4,
        stderr: '{"code":"PAT_REQUIRED","data":{"uri":"https://open.dingtalk.com/p"}}',
        stdout: '',
      }),
    );
    expect(pat).toMatchObject({
      error: { code: 'PAT_REQUIRED', patUri: 'https://open.dingtalk.com/p' },
    });
    const org = toExecResult(
      base({
        exitCode: 4,
        stderr: '{"code":"PAT_ORG_POLICY_DENIED","data":{"uri":"https://x"}}',
        stdout: '',
      }),
    );
    expect(org).toMatchObject({ error: { code: 'ORG_POLICY_DENIED' } });
    expect(toExecResult(base({ exitCode: 8, stdout: '' }))).toMatchObject({
      error: { code: 'INTERNAL', exitCode: 8 },
    });
    expect(toExecResult(base({ outputTooLarge: true, stdout: '' }))).toMatchObject({
      error: { code: 'OUTPUT_TOO_LARGE' },
    });
    expect(toExecResult(base({ timedOut: true, stdout: '' }))).toMatchObject({
      error: { code: 'TIMEOUT' },
    });
    const plain = toExecResult(base({ stdout: '{"count":1}' }));
    expect(plain).toMatchObject({ data: { count: 1 }, ok: true });
  });

  it('reads nested dws error JSON and skips a bare brace', () => {
    const pretty = '{\n  "error": {\n    "message": "未知的 profile"\n  }\n}\n';
    expect(toExecResult(base({ exitCode: 3, stderr: pretty, stdout: '' }))).toMatchObject({
      error: { code: 'VALIDATION', message: '未知的 profile' },
    });
    expect(
      toExecResult(base({ exitCode: 1, stderr: '{"errorMsg":"出错了"}\n', stdout: '' })),
    ).toMatchObject({
      error: { code: 'API_ERROR', message: '出错了' },
    });
    expect(
      toExecResult(base({ exitCode: 1, stderr: '{\n', stdout: '{"message":"不能为空"}' })),
    ).toMatchObject({ error: { code: 'API_ERROR', message: '不能为空' } });
    expect(toExecResult(base({ exitCode: 3, stderr: '{\n', stdout: '' }))).toMatchObject({
      error: { code: 'VALIDATION', message: '参数校验失败' },
    });
    expect(
      toExecResult(base({ exitCode: 0, stdout: '{"ok":false,"error":{"message":"模板不存在"}}' })),
    ).toMatchObject({ error: { code: 'API_ERROR', message: '模板不存在' } });
    const clipped = toExecResult(
      base({ exitCode: 3, stderr: `${'呀'.repeat(400)}\n`, stdout: '' }),
    );
    expect(clipped.ok).toBe(false);
    if (!clipped.ok) {
      expect(clipped.error.message).toHaveLength(300);
      expect(clipped.error.message).not.toContain('{');
    }
  });
});

describe('runner', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
  });

  async function open(
    control: unknown,
    opts?: { concurrency?: number; queueTimeoutMs?: number; stdoutCap?: number },
  ) {
    const dirs = await makeDirs();
    await writeControl(dirs.configDir, control);
    const restore = applyChildEnv(dirs);
    const runner = createRunner({
      bin: FAKE_DWS,
      concurrency: opts?.concurrency ?? 4,
      queueTimeoutMs: opts?.queueTimeoutMs ?? 1_000,
      stdoutCap: opts?.stdoutCap,
    });
    cleanups.push(async () => {
      runner.close();
      restore();
      await rm(dirs.root, { force: true, recursive: true });
    });
    return { dirs, runner };
  }

  it('passes only the env allowlist to dws', async () => {
    const { dirs, runner } = await open({ exec: { action: 'ok' } });
    const run = await runner.run({
      argv: ['todo', '+get', '--task-id=1'],
      lockProfile: false,
      timeoutMs: 2_000,
    });
    expect(run.exitCode).toBe(0);
    const calls = await readInvocations(dirs.configDir);
    const exec = calls.find((call) => call.argv.includes('+get'));
    expect(exec?.hasBrokerToken).toBe(false);
    expect(exec?.envKeys).not.toContain('DWS_BROKER_TOKEN');
    expect(exec?.envKeys).not.toContain('NOT_FOR_CHILD');
    expect(exec?.env.NO_COLOR).toBe('1');
    expect(exec?.env.HTTP_PROXY).toBe('http://127.0.0.1:9');
    expect(exec?.env.DINGTALK_DWS_AGENTCODE).toBe('aihub');
    expect(exec?.env.TZ).toBe('Asia/Shanghai');
    expect(buildChildEnv({ DWS_BROKER_TOKEN: 'x', PATH: '/bin' })).toEqual({
      NO_COLOR: '1',
      PATH: '/bin',
    });
  });

  it('kills a hung child and a huge stdout', async () => {
    const hung = await open({ exec: { action: 'hang' } });
    const timed = await hung.runner.run({
      argv: ['todo', '+get', '--task-id=1'],
      lockProfile: false,
      timeoutMs: 200,
    });
    expect(timed.timedOut).toBe(true);
    expect(toExecResult(timed)).toMatchObject({ error: { code: 'TIMEOUT' }, ok: false });

    const huge = await open({ exec: { action: 'huge', bytes: 400 } }, { stdoutCap: 128 });
    const oversized = await huge.runner.run({
      argv: ['todo', '+get', '--task-id=1'],
      lockProfile: false,
      timeoutMs: 2_000,
    });
    expect(oversized.outputTooLarge).toBe(true);
    expect(oversized.stdout).toBe('');
  });

  it('queues past the global concurrency limit', async () => {
    const { runner } = await open(
      { exec: { action: 'hang' } },
      { concurrency: 1, queueTimeoutMs: 200 },
    );
    const first = runner.run({
      argv: ['todo', '+get', '--task-id=1'],
      lockProfile: false,
      timeoutMs: 5_000,
    });
    await sleep(40);
    await expect(
      runner.run({ argv: ['todo', '+get', '--task-id=2'], lockProfile: false, timeoutMs: 5_000 }),
    ).rejects.toBeInstanceOf(QueueTimeoutError);
    runner.close();
    await first;
  });

  it('runs one child per profile at a time', async () => {
    const profile = 'dingcorp0123456789:012345678901234567';
    const { dirs, runner } = await open({ exec: { action: 'ok', delayMs: 200 } });
    await Promise.all([
      runner.run({ argv: ['todo', '+get', '--task-id=1'], profile, timeoutMs: 5_000 }),
      runner.run({ argv: ['todo', '+get', '--task-id=1'], profile, timeoutMs: 5_000 }),
    ]);
    const calls = (await readInvocations(dirs.configDir))
      .filter((call) => call.argv.includes('+get'))
      .sort((a, b) => a.t - b.t);
    expect(calls.length).toBe(2);
    expect((calls[1]?.t ?? 0) - (calls[0]?.t ?? 0)).toBeGreaterThanOrEqual(150);
  });

  it('kills a running child when the caller aborts and drops a queued one', async () => {
    const running = await open({ exec: { action: 'hang' } });
    const ac = new AbortController();
    const pending = running.runner.run({
      argv: ['todo', '+get', '--task-id=1'],
      lockProfile: false,
      signal: ac.signal,
      timeoutMs: 5_000,
    });
    await sleep(40);
    ac.abort();
    const killed = await pending;
    expect(killed.timedOut).toBe(false);
    expect(killed.signal === 'SIGKILL' || killed.exitCode === null).toBe(true);

    const queued = await open(
      { exec: { action: 'hang' } },
      { concurrency: 1, queueTimeoutMs: 2_000 },
    );
    const first = queued.runner.run({
      argv: ['todo', '+get', '--task-id=1'],
      lockProfile: false,
      timeoutMs: 5_000,
    });
    await sleep(40);
    const stop = new AbortController();
    const second = queued.runner.run({
      argv: ['todo', '+get', '--task-id=2'],
      lockProfile: false,
      signal: stop.signal,
      timeoutMs: 5_000,
    });
    await sleep(20);
    stop.abort();
    await expect(second).rejects.toBeInstanceOf(ClientClosedError);
    const calls = await readInvocations(queued.dirs.configDir);
    expect(calls.some((call) => call.argv.includes('--task-id=2'))).toBe(false);
    queued.runner.close();
    await first.catch(() => undefined);
  });
});
