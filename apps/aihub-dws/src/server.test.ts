import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  api,
  boot,
  PROFILE,
  readInvocations,
  sleep,
  TOKEN,
  writeControl,
} from '../test/harness.ts';
import { assertBrokerToken } from './auth.ts';
import { parseDwsVersion } from './server.ts';

describe('parseDwsVersion', () => {
  it('normalizes the version probe', () => {
    expect(parseDwsVersion('dws version v1.0.62\n')).toBe('v1.0.62');
    expect(parseDwsVersion('1.0.62')).toBe('v1.0.62');
    expect(parseDwsVersion('')).toBe('');
  });
});

describe('http broker', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
  });

  it('refuses a short token before listening', () => {
    expect(() => assertBrokerToken('short')).toThrow(/32/);
  });

  it('exits when started with a short token', async () => {
    const serverFile = fileURLToPath(new URL('./server.ts', import.meta.url));
    const child = spawn(process.execPath, [serverFile], {
      env: { ...process.env, DWS_BROKER_TOKEN: 'short', PORT: '0' },
    });
    const stderr: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    expect(code).toBe(1);
    expect(Buffer.concat(stderr).toString('utf8')).toContain('32');
  });

  it('serves health, auth, exec, download, status and login', async () => {
    const started = await boot({ profiles: [PROFILE], version: 'v1.0.62' });
    cleanups.push(started.close);
    const info = await stat(started.configDir);
    expect(info.mode & 0o777).toBe(0o700);

    const health = await api(started.server, 'GET', '/healthz', undefined, null);
    expect(health.status).toBe(200);
    expect(health.json).toEqual({ dwsVersion: 'v1.0.62', ok: true });

    const denied = await api(
      started.server,
      'POST',
      '/v1/exec',
      { op: 'todo.list', profile: PROFILE },
      'nope',
    );
    expect(denied.status).toBe(401);
    expect(denied.json).toMatchObject({ error: { code: 'UNAUTHORIZED' } });

    const lines: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      const listed = await api(started.server, 'POST', '/v1/exec', {
        actor: '员工甲',
        args: {},
        op: 'todo.list',
        profile: PROFILE,
      });
      expect(listed.status).toBe(200);
      expect(listed.json).toMatchObject({ data: { ok: true }, ok: true });
      expect(lines.join('')).not.toContain(PROFILE);
      expect(lines.join('')).toContain('"event":"exec"');
    } finally {
      process.stdout.write = original;
    }

    const calls = await readInvocations(started.configDir);
    const todo = calls.find((call) => call.argv.includes('+get-my-tasks'));
    expect(todo?.argv).toEqual([
      `--profile=${PROFILE}`,
      'todo',
      '+get-my-tasks',
      '--status=false',
      '--role-types=creator,executor,participant',
      '--page=1',
      '--size=20',
      '--format=json',
      '--timeout=30',
    ]);

    const badWindow = await api(started.server, 'POST', '/v1/exec', {
      args: {
        conversationId: 'cid1',
        end: '2026-09-10T00:00:00.000Z',
        start: '2026-09-01T00:00:00.000Z',
      },
      op: 'chat.messages',
      profile: PROFILE,
    });
    expect(badWindow.status).toBe(400);
    expect(badWindow.json).toMatchObject({ error: { code: 'INVALID_ARGS' } });

    const missing = await api(started.server, 'POST', '/v1/exec', {
      args: {},
      op: 'contact.self',
      profile: 'dingcorp0123456789:000',
    });
    expect(missing.status).toBe(404);
    expect(missing.json).toMatchObject({ error: { code: 'PROFILE_NOT_FOUND' } });

    await writeControl(started.configDir, { exec: { action: 'rate' }, profiles: [PROFILE] });
    const rate = await api(started.server, 'POST', '/v1/exec', {
      args: { taskId: '1' },
      op: 'todo.get',
      profile: PROFILE,
    });
    expect(rate.status).toBe(200);
    expect(rate.json).toMatchObject({ error: { code: 'RATE_LIMITED' }, ok: false });

    await writeControl(started.configDir, {
      exec: { action: 'pat', patUri: 'https://open.dingtalk.com/dev/pat?x=1' },
      profiles: [PROFILE],
    });
    const pat = await api(started.server, 'POST', '/v1/exec', {
      args: { taskId: '1' },
      op: 'todo.get',
      profile: PROFILE,
    });
    expect(pat.json).toMatchObject({
      error: { code: 'PAT_REQUIRED', patUri: 'https://open.dingtalk.com/dev/pat?x=1' },
      ok: false,
    });

    await writeControl(started.configDir, { download: { name: '报表.xlsx' }, profiles: [PROFILE] });
    const file = await api(started.server, 'POST', '/v1/exec', {
      args: { resourceId: 'res1', resourceType: 'fileId' },
      op: 'chat.downloadFile',
      profile: PROFILE,
    });
    expect(file.status).toBe(200);
    expect(file.json).toMatchObject({ ok: true });
    const body = file.json as { file?: { contentBase64: string; name: string } };
    expect(body.file?.name).toBe('报表.xlsx');
    expect(Buffer.from(body.file?.contentBase64 ?? '', 'base64').toString('utf8')).toBe(
      'hello-dws',
    );

    const status = await api(
      started.server,
      'GET',
      `/v1/profiles/${encodeURIComponent(PROFILE)}/status`,
    );
    expect(status.status).toBe(200);
    expect(status.json).toMatchObject({
      authenticated: true,
      corpName: '示例科技有限公司',
      userName: '张三',
    });

    const removed = await api(
      started.server,
      'DELETE',
      `/v1/profiles/${encodeURIComponent(PROFILE)}`,
    );
    expect(removed.json).toEqual({ ok: true, removed: true });

    await writeControl(started.configDir, {
      login: {
        action: 'ok',
        corp_id: 'dingcorp0123456789',
        exitMs: 20,
        readyMs: 10,
        user_id: '012345678901234567',
      },
      profiles: [PROFILE],
    });
    const created = await api(started.server, 'POST', '/v1/login', {
      actor: '员工甲',
      expectedProfile: PROFILE,
    });
    expect(created.status).toBe(201);
    const createdBody = created.json as { jobId: string; status: string; userCode: string };
    expect(createdBody.userCode).toBe('JCHB-KBXF');
    let current = createdBody;
    for (let i = 0; i < 30 && current.status === 'pending'; i += 1) {
      await sleep(30);
      const polled = await api(started.server, 'GET', `/v1/login/${createdBody.jobId}`);
      current = polled.json as typeof current;
    }
    expect(current.status).toBe('succeeded');

    const method = await api(started.server, 'GET', '/v1/exec');
    expect(method.status).toBe(405);

    const huge = await fetch(`${started.server.url}/v1/exec`, {
      body: 'x'.repeat(70 * 1024),
      headers: { 'authorization': `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(huge.status).toBe(400);
  });

  it('returns 503 until a failed version probe recovers', async () => {
    const held = await boot({ versionExit: 1 }, { versionRetryMs: 60_000 });
    cleanups.push(held.close);
    const down = await api(held.server, 'GET', '/healthz', undefined, null);
    expect(down.status).toBe(503);
    expect(down.json).toEqual({ dwsVersion: '', ok: false });
    const again = await api(held.server, 'GET', '/healthz', undefined, null);
    expect(again.status).toBe(503);
    const probed = (await readInvocations(held.configDir)).filter(
      (call) => call.argv[0] === 'version',
    );
    expect(probed).toHaveLength(1);

    const started = await boot({ versionExit: 1 }, { versionRetryMs: 0 });
    cleanups.push(started.close);
    await writeControl(started.configDir, { version: 'v1.0.62' });
    // The retry runs in the background; the first call only triggers it.
    await api(started.server, 'GET', '/healthz', undefined, null);
    let up = await api(started.server, 'GET', '/healthz', undefined, null);
    for (let i = 0; i < 50 && up.status !== 200; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      up = await api(started.server, 'GET', '/healthz', undefined, null);
    }
    expect(up.status).toBe(200);
    expect(up.json).toEqual({ dwsVersion: 'v1.0.62', ok: true });
  });

  it('does not re-probe a healthy dws version until the retry interval', async () => {
    const started = await boot({ version: 'v1.0.62' }, { versionRetryMs: 60_000 });
    cleanups.push(started.close);
    expect((await api(started.server, 'GET', '/healthz', undefined, null)).status).toBe(200);
    expect((await api(started.server, 'GET', '/healthz', undefined, null)).status).toBe(200);
    const probed = (await readInvocations(started.configDir)).filter(
      (call) => call.argv[0] === 'version',
    );
    expect(probed).toHaveLength(1);
  });

  it('clears a healthy version when a background re-probe fails, without blocking', async () => {
    const started = await boot({ version: 'v1.0.62' }, { versionRetryMs: 0 });
    cleanups.push(started.close);
    await writeControl(started.configDir, { versionExit: 1 });
    const triggering = await api(started.server, 'GET', '/healthz', undefined, null);
    expect(triggering.status).toBe(200);
    expect(triggering.json).toEqual({ dwsVersion: 'v1.0.62', ok: true });

    let down = await api(started.server, 'GET', '/healthz', undefined, null);
    for (let i = 0; i < 40 && down.status !== 503; i += 1) {
      await sleep(40);
      down = await api(started.server, 'GET', '/healthz', undefined, null);
    }
    expect(down.status).toBe(503);
    expect(down.json).toEqual({ dwsVersion: '', ok: false });

    await writeControl(started.configDir, { version: 'v1.0.62' });
    let up = await api(started.server, 'GET', '/healthz', undefined, null);
    for (let i = 0; i < 40 && up.status !== 200; i += 1) {
      await sleep(40);
      up = await api(started.server, 'GET', '/healthz', undefined, null);
    }
    expect(up.status).toBe(200);
    expect(up.json).toEqual({ dwsVersion: 'v1.0.62', ok: true });

    const hanging = await boot(
      { version: 'v1.0.62' },
      { versionRetryMs: 0, versionTimeoutMs: 30_000 },
    );
    cleanups.push(hanging.close);
    await writeControl(hanging.configDir, { versionAction: 'hang' });
    const startedAt = Date.now();
    const health = await api(hanging.server, 'GET', '/healthz', undefined, null);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(health.status).toBe(200);
    expect(health.json).toEqual({ dwsVersion: 'v1.0.62', ok: true });
    let calls = (await readInvocations(hanging.configDir)).filter(
      (call) => call.argv[0] === 'version',
    );
    for (let i = 0; i < 40 && calls.length < 2; i += 1) {
      await sleep(25);
      calls = (await readInvocations(hanging.configDir)).filter(
        (call) => call.argv[0] === 'version',
      );
    }
    expect(calls).toHaveLength(2);
    const againAt = Date.now();
    const again = await api(hanging.server, 'GET', '/healthz', undefined, null);
    expect(Date.now() - againAt).toBeLessThan(1_000);
    expect(again.status).toBe(200);
    await sleep(50);
    const later = (await readInvocations(hanging.configDir)).filter(
      (call) => call.argv[0] === 'version',
    );
    expect(later).toHaveLength(2);
    const pid = later[1]?.pid;
    expect(pid).toBeTruthy();
    if (pid) {
      try {
        process.kill(pid, 0);
      } catch {
        throw new Error('version probe was killed or already exited');
      }
    }
  });

  it('does not report a revoke as removed while the profile remains', async () => {
    const absent = await boot({ profiles: [] });
    cleanups.push(absent.close);
    const gone = await api(absent.server, 'DELETE', `/v1/profiles/${encodeURIComponent(PROFILE)}`);
    expect(gone.status).toBe(200);
    expect(gone.json).toEqual({ absent: true, ok: true, removed: false });

    const failed = await boot({ logoutExit: 7, profiles: [PROFILE] });
    cleanups.push(failed.close);
    const bad = await api(failed.server, 'DELETE', `/v1/profiles/${encodeURIComponent(PROFILE)}`);
    expect(bad.status).toBe(502);
    expect(bad.json).toMatchObject({ error: { code: 'LOGOUT_FAILED' } });

    const unknown = await boot({
      profiles: [],
      statusExit: 3,
      statusStderr: '{\n',
      statusStdout: '',
    });
    cleanups.push(unknown.close);
    const status = await api(
      unknown.server,
      'GET',
      `/v1/profiles/${encodeURIComponent(PROFILE)}/status`,
    );
    expect(status.status).toBe(200);
    expect(status.json).toEqual({ authenticated: false });
  });

  it('returns the login terminal status and leaves a succeeded token in place', async () => {
    const alive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const waitPid = async (configDir: string, flag: string): Promise<number> => {
      for (let i = 0; i < 40; i += 1) {
        const calls = await readInvocations(configDir);
        const found = calls.find((call) => call.argv.includes(flag) && call.pid);
        if (found?.pid) return found.pid;
        await sleep(25);
      }
      throw new Error(`missing ${flag}`);
    };

    const hanging = await boot({
      login: { action: 'hang', readyMs: 10 },
      profiles: [PROFILE],
    });
    cleanups.push(hanging.close);
    const missing = await api(hanging.server, 'DELETE', `/v1/login/${'ab'.repeat(12)}`);
    expect(missing.status).toBe(404);
    expect(missing.json).toMatchObject({ error: { code: 'LOGIN_NOT_FOUND' } });

    const created = await api(hanging.server, 'POST', '/v1/login', { expectedProfile: PROFILE });
    expect(created.status).toBe(201);
    const jobId = (created.json as { jobId: string }).jobId;
    const pid = await waitPid(hanging.configDir, 'login');
    const deleted = await api(hanging.server, 'DELETE', `/v1/login/${jobId}`);
    expect(deleted.status).toBe(200);
    expect(deleted.json).toEqual({ ok: true, status: 'cancelled' });
    const after = await api(hanging.server, 'GET', `/v1/login/${jobId}`);
    expect(after.json).toMatchObject({ status: 'cancelled' });
    await sleep(200);
    expect(alive(pid)).toBe(false);

    const failed = await boot({
      login: { action: 'org-disabled', exitMs: 15, readyMs: 10 },
      profiles: [PROFILE],
    });
    cleanups.push(failed.close);
    const failedJob = await api(failed.server, 'POST', '/v1/login', { expectedProfile: PROFILE });
    const failedId = (failedJob.json as { jobId: string }).jobId;
    let failedView = failedJob.json as { status: string };
    for (let i = 0; i < 30 && failedView.status === 'pending'; i += 1) {
      await sleep(30);
      failedView = (await api(failed.server, 'GET', `/v1/login/${failedId}`)).json as {
        status: string;
      };
    }
    expect(failedView.status).toBe('failed');
    const failedDelete = await api(failed.server, 'DELETE', `/v1/login/${failedId}`);
    expect(failedDelete.status).toBe(200);
    expect(failedDelete.json).toEqual({ ok: true, status: 'failed' });

    const done = await boot({
      login: {
        action: 'ok',
        corp_id: 'dingcorp0123456789',
        corp_name: '示例科技有限公司',
        exitMs: 20,
        readyMs: 10,
        user_id: '012345678901234567',
        user_name: '张三',
      },
      profiles: [PROFILE],
    });
    cleanups.push(done.close);
    const startedLogin = await api(done.server, 'POST', '/v1/login', { expectedProfile: PROFILE });
    const succeededId = (startedLogin.json as { jobId: string }).jobId;
    let view = startedLogin.json as { status: string };
    for (let i = 0; i < 30 && view.status === 'pending'; i += 1) {
      await sleep(30);
      view = (await api(done.server, 'GET', `/v1/login/${succeededId}`)).json as { status: string };
    }
    expect(view.status).toBe('succeeded');
    const kept = await api(done.server, 'DELETE', `/v1/login/${succeededId}`);
    expect(kept.status).toBe(200);
    expect(kept.json).toEqual({
      identity: {
        corpId: 'dingcorp0123456789',
        corpName: '示例科技有限公司',
        userId: '012345678901234567',
        userName: '张三',
      },
      ok: true,
      status: 'succeeded',
    });
    expect((await readInvocations(done.configDir)).some((call) => call.argv[1] === 'logout')).toBe(
      false,
    );
    const still = await api(done.server, 'GET', `/v1/login/${succeededId}`);
    expect(still.json).toMatchObject({
      identity: { userId: '012345678901234567' },
      status: 'succeeded',
    });
  });

  it('finalizes a pending login whose profile was written before the child was killed', async () => {
    const started = await boot({
      login: {
        action: 'persist-hang',
        corp_id: 'dingcorp0123456789',
        corp_name: '示例科技有限公司',
        readyMs: 10,
        user_id: '012345678901234567',
        user_name: '张三',
      },
      profiles: [],
    });
    cleanups.push(started.close);
    const created = await api(started.server, 'POST', '/v1/login', { expectedProfile: PROFILE });
    expect(created.status).toBe(201);
    const jobId = (created.json as { jobId: string }).jobId;
    const deleted = await api(started.server, 'DELETE', `/v1/login/${jobId}`);
    expect(deleted.status).toBe(200);
    expect(deleted.json).toEqual({
      identity: {
        corpId: 'dingcorp0123456789',
        corpName: '示例科技有限公司',
        userId: '012345678901234567',
        userName: '张三',
      },
      ok: true,
      status: 'succeeded',
    });
    const after = await api(started.server, 'GET', `/v1/login/${jobId}`);
    expect(after.json).toMatchObject({
      identity: { userId: '012345678901234567' },
      status: 'succeeded',
    });
    expect(
      (await readInvocations(started.configDir)).some((call) => call.argv[1] === 'logout'),
    ).toBe(false);
  });

  it('kills a status probe when the client disconnects and lets logout finish', async () => {
    const alive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const waitPid = async (configDir: string, flag: string): Promise<number> => {
      for (let i = 0; i < 40; i += 1) {
        const calls = await readInvocations(configDir);
        const found = calls.find((call) => call.argv.includes(flag) && call.pid);
        if (found?.pid) return found.pid;
        await sleep(25);
      }
      throw new Error(`missing ${flag}`);
    };

    const reading = await boot({ profiles: [PROFILE], statusAction: 'hang' });
    cleanups.push(reading.close);
    const readStop = new AbortController();
    const readReq = fetch(
      `${reading.server.url}/v1/profiles/${encodeURIComponent(PROFILE)}/status`,
      {
        headers: { authorization: `Bearer ${TOKEN}` },
        method: 'GET',
        signal: readStop.signal,
      },
    );
    const readPid = await waitPid(reading.configDir, 'status');
    readStop.abort();
    await readReq.catch(() => undefined);
    await sleep(200);
    expect(alive(readPid)).toBe(false);

    const revoking = await boot({ logoutAction: 'hang', profiles: [PROFILE] });
    cleanups.push(revoking.close);
    const revokeStop = new AbortController();
    const revokeReq = fetch(`${revoking.server.url}/v1/profiles/${encodeURIComponent(PROFILE)}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
      method: 'DELETE',
      signal: revokeStop.signal,
    });
    const revokePid = await waitPid(revoking.configDir, 'logout');
    revokeStop.abort();
    await revokeReq.catch(() => undefined);
    await sleep(200);
    expect(alive(revokePid)).toBe(true);
  });

  it('kills a read when the client disconnects and lets a write finish', async () => {
    const alive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const waitPid = async (configDir: string, flag: string): Promise<number> => {
      for (let i = 0; i < 40; i += 1) {
        const calls = await readInvocations(configDir);
        const found = calls.find((call) => call.argv.includes(flag) && call.pid);
        if (found?.pid) return found.pid;
        await sleep(25);
      }
      throw new Error(`missing ${flag}`);
    };

    const reading = await boot({ exec: { action: 'hang' }, profiles: [PROFILE] });
    cleanups.push(reading.close);
    const readStop = new AbortController();
    const readReq = fetch(`${reading.server.url}/v1/exec`, {
      body: JSON.stringify({ args: { taskId: 'task-1' }, op: 'todo.get', profile: PROFILE }),
      headers: { 'authorization': `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      method: 'POST',
      signal: readStop.signal,
    });
    const readPid = await waitPid(reading.configDir, '+get');
    readStop.abort();
    await readReq.catch(() => undefined);
    await sleep(200);
    expect(alive(readPid)).toBe(false);

    const writing = await boot({ exec: { action: 'hang' }, profiles: [PROFILE] });
    cleanups.push(writing.close);
    const writeStop = new AbortController();
    const writeReq = fetch(`${writing.server.url}/v1/exec`, {
      body: JSON.stringify({ args: { taskId: 'task-1' }, op: 'todo.complete', profile: PROFILE }),
      headers: { 'authorization': `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      method: 'POST',
      signal: writeStop.signal,
    });
    const writePid = await waitPid(writing.configDir, '+complete');
    writeStop.abort();
    await writeReq.catch(() => undefined);
    await sleep(200);
    expect(alive(writePid)).toBe(true);

    const lines: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      const finishing = await boot({
        exec: { action: 'ok', delayMs: 250 },
        profiles: [PROFILE],
      });
      cleanups.push(finishing.close);
      const stop = new AbortController();
      const req = fetch(`${finishing.server.url}/v1/exec`, {
        body: JSON.stringify({ args: { taskId: 'task-1' }, op: 'todo.complete', profile: PROFILE }),
        headers: { 'authorization': `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        method: 'POST',
        signal: stop.signal,
      });
      await sleep(40);
      stop.abort();
      await req.catch(() => undefined);
      await sleep(800);
      const audit = lines.join('');
      expect(audit).toContain('"op":"todo.complete"');
      expect(audit).toContain('"exitCode":0');
    } finally {
      process.stdout.write = original;
    }
  });
});
