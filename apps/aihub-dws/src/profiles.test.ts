import { rm } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyChildEnv,
  FAKE_DWS,
  makeDirs,
  PROFILE,
  readInvocations,
  sleep,
  writeControl,
} from '../test/harness.ts';
import { createProfiles, mapProfileNames, mapProfileRecords, mapStatus } from './profiles.ts';
import { createRunner } from './runner.ts';

describe('profile mapping', () => {
  it('maps status and profile list payloads', () => {
    expect(mapStatus({ authenticated: false, message: '未登录', success: true })).toEqual({
      authenticated: false,
    });
    expect(
      mapStatus({
        authenticated: true,
        corp_name: '示例科技有限公司',
        refresh_expires_at: '2026-10-24T00:00:00.000Z',
        refresh_token_valid: true,
        token_valid: false,
        user_name: '张三',
      }),
    ).toEqual({
      authenticated: true,
      corpName: '示例科技有限公司',
      refreshExpiresAt: '2026-10-24T00:00:00.000Z',
      refreshTokenValid: true,
      tokenValid: false,
      userName: '张三',
    });
    expect(mapProfileNames({ profiles: [{ profile: 'a:b' }, 'c:d'] })).toEqual(['a:b', 'c:d']);
    expect(
      mapProfileRecords({
        profiles: [
          {
            corpId: 'dingcorp',
            corpName: '示例',
            lastLoginAt: '2026-09-24T12:00:00.000Z',
            profile: 'dingcorp:0123',
            userId: '0123',
            userName: '张三',
          },
          { last_login_at: '2020-01-01T00:00:00.000Z', profile: 'dingother:9' },
          'dingplain:1',
        ],
      }),
    ).toEqual([
      {
        corpId: 'dingcorp',
        corpName: '示例',
        lastLoginAt: '2026-09-24T12:00:00.000Z',
        profile: 'dingcorp:0123',
        userId: '0123',
        userName: '张三',
      },
      {
        corpId: 'dingother',
        corpName: '',
        lastLoginAt: '2020-01-01T00:00:00.000Z',
        profile: 'dingother:9',
        userId: '9',
        userName: '',
      },
      { corpId: 'dingplain', corpName: '', profile: 'dingplain:1', userId: '1', userName: '' },
    ]);
  });
});

describe('profiles', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
  });

  it('caches profile list for 10s and logout clears it', async () => {
    const dirs = await makeDirs();
    await writeControl(dirs.configDir, { profiles: [PROFILE] });
    const restore = applyChildEnv(dirs);
    let now = 1_000;
    const runner = createRunner({ bin: FAKE_DWS, queueTimeoutMs: 2_000 });
    const profiles = createProfiles(runner, { cacheMs: 10_000, now: () => now });
    cleanups.push(async () => {
      runner.close();
      restore();
      await rm(dirs.root, { force: true, recursive: true });
    });

    expect(await profiles.has(PROFILE)).toBe(true);
    await writeControl(dirs.configDir, { profiles: [] });
    now += 1_000;
    expect(await profiles.has(PROFILE)).toBe(true);
    now += 10_000;
    expect(await profiles.has(PROFILE)).toBe(false);

    await writeControl(dirs.configDir, { logoutExit: 0, profiles: [PROFILE] });
    profiles.invalidate();
    expect(await profiles.has(PROFILE)).toBe(true);
    const loggedOut = await profiles.logout(PROFILE, 'actor-1');
    expect(loggedOut).toEqual({ ok: true, removed: true });
    await writeControl(dirs.configDir, { profiles: [] });
    expect(await profiles.has(PROFILE)).toBe(false);

    const calls = await readInvocations(dirs.configDir);
    expect(
      calls.some(
        (call) =>
          call.argv[0] === 'auth' &&
          call.argv[1] === 'logout' &&
          call.argv.includes(`--profile=${PROFILE}`),
      ),
    ).toBe(true);
  });

  it('turns exit 2 into an unauthenticated status', async () => {
    const dirs = await makeDirs();
    await writeControl(dirs.configDir, {
      statusExit: 2,
      status: { authenticated: false, success: false },
    });
    const restore = applyChildEnv(dirs);
    const runner = createRunner({ bin: FAKE_DWS, queueTimeoutMs: 2_000 });
    const profiles = createProfiles(runner, { cacheMs: 0 });
    cleanups.push(async () => {
      runner.close();
      restore();
      await rm(dirs.root, { force: true, recursive: true });
    });
    const status = await profiles.status(PROFILE);
    expect(status).toEqual({ body: { authenticated: false }, httpStatus: 200 });
    await expect(profiles.logout('nope')).rejects.toMatchObject({
      code: 'INVALID_PROFILE',
      status: 400,
    });

    await writeControl(dirs.configDir, {
      statusExit: 3,
      statusStderr: '{\n  "error": {"message": "profile not found"}\n}\n',
      statusStdout: '',
    });
    const unknown = await profiles.status(PROFILE);
    expect(unknown).toEqual({ body: { authenticated: false }, httpStatus: 200 });
  });

  it('reports logout success only when the profile is gone', async () => {
    const dirs = await makeDirs();
    await writeControl(dirs.configDir, { profiles: [] });
    const restore = applyChildEnv(dirs);
    const runner = createRunner({ bin: FAKE_DWS, queueTimeoutMs: 2_000 });
    const profiles = createProfiles(runner, {
      cacheMs: 0,
      logoutChildMs: 300,
      logoutTotalMs: 5_000,
    });
    cleanups.push(async () => {
      runner.close();
      restore();
      await rm(dirs.root, { force: true, recursive: true });
    });

    const absent = await profiles.logout(PROFILE, 'actor-1');
    expect(absent).toEqual({ absent: true, ok: true, removed: false });
    expect((await readInvocations(dirs.configDir)).some((call) => call.argv[1] === 'logout')).toBe(
      false,
    );

    await writeControl(dirs.configDir, { logoutExit: 1, profiles: [PROFILE] });
    await expect(profiles.logout(PROFILE)).rejects.toMatchObject({
      code: 'LOGOUT_FAILED',
      status: 502,
    });

    await writeControl(dirs.configDir, { logoutExit: 0, logoutKeep: true, profiles: [PROFILE] });
    await expect(profiles.logout(PROFILE)).rejects.toMatchObject({
      code: 'LOGOUT_FAILED',
      status: 502,
    });

    await writeControl(dirs.configDir, { logoutAction: 'hang', profiles: [PROFILE] });
    await expect(profiles.logout(PROFILE)).rejects.toMatchObject({
      code: 'LOGOUT_FAILED',
      status: 502,
    });
  });

  async function openStore(options?: {
    logoutChildMs?: number;
    logoutTotalMs?: number;
    statusChildMs?: number;
    statusQueueMs?: number;
  }) {
    const dirs = await makeDirs();
    await writeControl(dirs.configDir, { profiles: [PROFILE] });
    const restore = applyChildEnv(dirs);
    const runner = createRunner({ bin: FAKE_DWS, queueTimeoutMs: 2_000 });
    const profiles = createProfiles(runner, { cacheMs: 0, ...options });
    cleanups.push(async () => {
      runner.close();
      restore();
      await rm(dirs.root, { force: true, recursive: true });
    });
    return { dirs, profiles, runner };
  }

  it('fails status when the queue or the child exceeds its budget', async () => {
    const queued = await openStore({ statusQueueMs: 200 });
    await writeControl(queued.dirs.configDir, { exec: { action: 'hang' }, profiles: [PROFILE] });
    const held = queued.runner.run({
      argv: ['todo', '+get', '--task-id=1'],
      profile: PROFILE,
      timeoutMs: 5_000,
    });
    await sleep(40);
    const queuedAt = Date.now();
    await expect(queued.profiles.status(PROFILE)).rejects.toMatchObject({
      code: 'TIMEOUT',
      status: 502,
    });
    expect(Date.now() - queuedAt).toBeLessThan(1_000);
    expect(
      (await readInvocations(queued.dirs.configDir)).some((call) => call.argv[1] === 'status'),
    ).toBe(false);
    queued.runner.close();
    await held.catch(() => undefined);

    const slow = await openStore({ statusChildMs: 200 });
    await writeControl(slow.dirs.configDir, { profiles: [PROFILE], statusAction: 'hang' });
    const slowAt = Date.now();
    const status = await slow.profiles.status(PROFILE);
    expect(Date.now() - slowAt).toBeLessThan(1_500);
    expect(status.httpStatus).toBe(502);
    expect(status.body).toMatchObject({ error: { code: 'TIMEOUT' } });
  });

  it('fails logout with LOGOUT_FAILED when a step or the total budget is exhausted', async () => {
    const preList = await openStore({ logoutChildMs: 200, logoutTotalMs: 5_000 });
    await writeControl(preList.dirs.configDir, {
      profileListAction: 'hang',
      profiles: [PROFILE],
    });
    const preAt = Date.now();
    await expect(preList.profiles.logout(PROFILE)).rejects.toMatchObject({
      code: 'LOGOUT_FAILED',
      status: 502,
    });
    expect(Date.now() - preAt).toBeLessThan(1_500);
    expect(
      (await readInvocations(preList.dirs.configDir)).some((call) => call.argv[1] === 'logout'),
    ).toBe(false);

    const child = await openStore({ logoutChildMs: 200, logoutTotalMs: 10_000 });
    await writeControl(child.dirs.configDir, { logoutAction: 'hang', profiles: [PROFILE] });
    const childAt = Date.now();
    await expect(child.profiles.logout(PROFILE)).rejects.toMatchObject({
      code: 'LOGOUT_FAILED',
      status: 502,
    });
    expect(Date.now() - childAt).toBeLessThan(1_500);
    expect(
      (await readInvocations(child.dirs.configDir)).some((call) => call.argv[1] === 'logout'),
    ).toBe(true);

    const total = await openStore({ logoutChildMs: 10_000, logoutTotalMs: 1_000 });
    await writeControl(total.dirs.configDir, { logoutAction: 'hang', profiles: [PROFILE] });
    const totalAt = Date.now();
    await expect(total.profiles.logout(PROFILE)).rejects.toMatchObject({
      code: 'LOGOUT_FAILED',
      status: 502,
    });
    expect(Date.now() - totalAt).toBeLessThan(2_500);
    expect(
      (await readInvocations(total.dirs.configDir)).some((call) => call.argv[1] === 'logout'),
    ).toBe(true);

    const postList = await openStore({ logoutChildMs: 200, logoutTotalMs: 5_000 });
    await writeControl(postList.dirs.configDir, {
      profileListHangFrom: 2,
      profiles: [PROFILE],
    });
    const postAt = Date.now();
    await expect(postList.profiles.logout(PROFILE)).rejects.toMatchObject({
      code: 'LOGOUT_FAILED',
      status: 502,
    });
    expect(Date.now() - postAt).toBeLessThan(1_500);
    const postCalls = await readInvocations(postList.dirs.configDir);
    expect(postCalls.filter((call) => call.argv[1] === 'logout')).toHaveLength(1);
    expect(postCalls.filter((call) => call.argv[0] === 'profile')).toHaveLength(2);
  });
});
