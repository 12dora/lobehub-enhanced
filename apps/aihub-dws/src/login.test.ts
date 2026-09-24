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
import { BrokerError } from './errors.ts';
import {
  createLoginService,
  parseLoginIdentity,
  parseLoginStderr,
  profileChangedByLogin,
} from './login.ts';
import { createProfiles } from './profiles.ts';
import { createRunner } from './runner.ts';
import type { LoginJobView } from './types.ts';

const SAMPLE = [
  '● Step 1: Requesting device authorization code...',
  '  authorization code: JCHB-KBXF',
  '  Authorization code will expire in 900 seconds.',
  '  Authorization link (code included):',
  'https://login.dingtalk.com/oauth2/device/verify.htm?caller=dws&callerUmt=abc&user_code=JCHB-KBXF',
  '  Link for entering the code manually:',
  'https://login.dingtalk.com/oauth2/device/verify.htm?caller=dws&callerUmt=abc',
  '● Step 2: Waiting for user authorization...',
].join('\n');

const SAMPLE_ZH = [
  '● Step 1: 请求设备授权码...',
  '',
  '  授权码: CLWM-LVQL',
  '  授权码将在 900 秒后过期。',
  '',
  '  授权链接（已填入授权码）：',
  'https://login.dingtalk.com/oauth2/device/verify.htm?user_code=CLWM-LVQL',
  '',
  '  手动输入授权码的链接：',
  'https://login.dingtalk.com/oauth2/device/verify.htm',
  '',
  '● Step 2: 等待用户授权...',
].join('\n');

describe('login parsing', () => {
  it('reads the Chinese device-code prompt dws prints in the container', () => {
    expect(parseLoginStderr(SAMPLE_ZH)).toEqual({
      expiresInSec: 900,
      userCode: 'CLWM-LVQL',
      verificationUrl: 'https://login.dingtalk.com/oauth2/device/verify.htm?user_code=CLWM-LVQL',
    });
  });

  it('reads the device-code stderr and the success stdout', () => {
    const parsed = parseLoginStderr(SAMPLE);
    expect(parsed?.userCode).toBe('JCHB-KBXF');
    expect(parsed?.expiresInSec).toBe(900);
    expect(parsed?.verificationUrl).toContain('user_code=JCHB-KBXF');
    expect(parsed?.verificationUrl).not.toBe(
      'https://login.dingtalk.com/oauth2/device/verify.htm?caller=dws&callerUmt=abc',
    );
    const identity = parseLoginIdentity(
      '{"success":true,"corp_id":"dingcorp","corp_name":"示例","user_id":"0123","user_name":"张三"}',
    );
    expect(identity).toEqual({
      identity: { corpId: 'dingcorp', corpName: '示例', userId: '0123', userName: '张三' },
      ok: true,
    });
    expect(parseLoginIdentity('{"success":false,"corp_id":"a","user_id":"b"}')?.ok).toBe(false);
  });

  it('treats a missing snapshot entry as this login, and lastLoginAt only when it moved', () => {
    const startedAt = Date.parse('2026-09-24T12:00:00.000Z');
    const profile = {
      corpId: 'dingcorp',
      corpName: '示例',
      profile: 'dingcorp:0123',
      userId: '0123',
      userName: '张三',
    };
    expect(profileChangedByLogin(undefined, profile, startedAt, true)).toBe(true);
    expect(profileChangedByLogin(profile, profile, startedAt, true)).toBe(false);
    expect(
      profileChangedByLogin(
        { ...profile, lastLoginAt: '2020-01-01T00:00:00.000Z' },
        { ...profile, lastLoginAt: '2020-01-01T00:00:00.000Z' },
        startedAt,
        true,
      ),
    ).toBe(false);
    expect(
      profileChangedByLogin(
        { ...profile, lastLoginAt: '2020-01-01T00:00:00.000Z' },
        { ...profile, lastLoginAt: '2026-09-24T12:00:01.000Z' },
        startedAt,
        true,
      ),
    ).toBe(true);
    expect(
      profileChangedByLogin(
        profile,
        { ...profile, lastLoginAt: '2026-09-24T12:00:01.000Z' },
        startedAt,
        true,
      ),
    ).toBe(true);
    expect(
      profileChangedByLogin(
        undefined,
        { ...profile, lastLoginAt: '2026-09-24T12:00:01.000Z' },
        startedAt,
        false,
      ),
    ).toBe(true);
    expect(profileChangedByLogin(undefined, profile, startedAt, false)).toBe(false);
    expect(
      profileChangedByLogin(
        undefined,
        { ...profile, lastLoginAt: '2020-01-01T00:00:00.000Z' },
        startedAt,
        false,
      ),
    ).toBe(false);
  });
});

describe('login jobs', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
  });

  async function open(
    control: unknown,
    opts?: {
      cancelListMs?: number;
      cancelWaitMs?: number;
      childTimeoutMs?: number;
      keepMs?: number;
      maxPending?: number;
      readyTimeoutMs?: number;
      startDeadlineMs?: number;
    },
  ) {
    const dirs = await makeDirs();
    await writeControl(dirs.configDir, control);
    const restore = applyChildEnv(dirs);
    const runner = createRunner({ bin: FAKE_DWS, queueTimeoutMs: 2_000 });
    const profiles = createProfiles(runner, { cacheMs: 0 });
    const logins = createLoginService(runner, profiles, {
      cancelListMs: opts?.cancelListMs,
      cancelWaitMs: opts?.cancelWaitMs,
      childTimeoutMs: opts?.childTimeoutMs ?? 4_000,
      keepMs: opts?.keepMs ?? 30_000,
      maxPending: opts?.maxPending ?? 10,
      readyTimeoutMs: opts?.readyTimeoutMs ?? 800,
      startDeadlineMs: opts?.startDeadlineMs,
    });
    cleanups.push(async () => {
      logins.stop();
      runner.close();
      restore();
      await rm(dirs.root, { force: true, recursive: true });
    });
    return { dirs, logins, runner };
  }

  async function settle(logins: { get: (id: string) => LoginJobView | undefined }, jobId: string) {
    let view = logins.get(jobId);
    for (let i = 0; i < 40 && view?.status === 'pending'; i += 1) {
      await sleep(25);
      view = logins.get(jobId);
    }
    return view;
  }

  it('completes a matching login without logging the device code', async () => {
    const lines: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      const { logins } = await open({
        login: {
          action: 'ok',
          corp_id: 'dingcorp0123456789',
          exitMs: 20,
          readyMs: 10,
          user_id: '012345678901234567',
        },
        profiles: [PROFILE],
      });
      const job = await logins.start({ actor: 'u1', expectedProfile: PROFILE });
      expect(job.status).toBe('pending');
      expect(job.userCode).toBe('JCHB-KBXF');
      expect(job.verificationUrl).toContain('user_code=JCHB-KBXF');
      expect(Date.parse(job.expiresAt) - Date.now()).toBeGreaterThan(800_000);
      const done = await settle(logins, job.jobId);
      expect(done?.status).toBe('succeeded');
      expect(done?.identity).toMatchObject({ corpId: 'dingcorp0123456789', userName: '张三' });
      expect(lines.join('')).not.toContain('JCHB-KBXF');
      expect(lines.join('')).not.toContain('login.dingtalk.com');
    } finally {
      process.stdout.write = original;
    }
  });

  it('logs out a mismatched profile that did not exist before login', async () => {
    const { dirs, logins } = await open({
      login: {
        action: 'ok',
        corp_id: 'dingOTHERCORP',
        corp_name: '别的公司',
        exitMs: 20,
        readyMs: 10,
        user_id: '999',
        user_name: '李四',
      },
      profiles: [PROFILE],
    });
    const job = await logins.start({ expectedProfile: PROFILE });
    const done = await settle(logins, job.jobId);
    expect(done?.status).toBe('failed');
    expect(done?.errorCode).toBe('IDENTITY_MISMATCH');
    expect(done?.identity).toMatchObject({ corpName: '别的公司', userId: '999', userName: '李四' });
    const calls = await readInvocations(dirs.configDir);
    expect(
      calls.some(
        (call) => call.argv.includes('--profile=dingOTHERCORP:999') && call.argv[1] === 'logout',
      ),
    ).toBe(true);

    await writeControl(dirs.configDir, {
      login: {
        action: 'ok',
        corp_id: 'dingOTHERCORP',
        exitMs: 20,
        readyMs: 10,
        user_id: '999',
        user_name: '李四',
      },
      profiles: [PROFILE, 'dingOTHERCORP:999'],
    });
    const kept = await logins.start({ expectedProfile: PROFILE });
    const keptDone = await settle(logins, kept.jobId);
    expect(keptDone?.errorCode).toBe('IDENTITY_MISMATCH');
    const later = (await readInvocations(dirs.configDir)).filter(
      (call) => call.argv[1] === 'logout',
    );
    expect(later).toHaveLength(1);
  });

  it('reports org cli disabled, expiry, cancel, replacement and the pending cap', async () => {
    const org = await open({
      login: { action: 'org-disabled', exitMs: 15, readyMs: 10 },
      profiles: [PROFILE],
    });
    const orgJob = await org.logins.start({ expectedProfile: PROFILE });
    expect((await settle(org.logins, orgJob.jobId))?.errorCode).toBe('ORG_CLI_DISABLED');

    const expired = await open({
      login: { action: 'hang', expireSeconds: 1, readyMs: 10 },
      profiles: [PROFILE],
    });
    const expiredJob = await expired.logins.start({ expectedProfile: PROFILE });
    await sleep(1_200);
    expect(expired.logins.get(expiredJob.jobId)).toMatchObject({
      errorCode: 'LOGIN_TIMEOUT',
      status: 'expired',
    });

    const hanging = await open({ login: { action: 'hang', readyMs: 10 }, profiles: [PROFILE] });
    const pending = await hanging.logins.start({ expectedProfile: PROFILE });
    expect(await hanging.logins.cancel(pending.jobId)).toEqual({ ok: true, status: 'cancelled' });
    expect(hanging.logins.get(pending.jobId)?.status).toBe('cancelled');
    expect(await hanging.logins.cancel(pending.jobId)).toEqual({ ok: true, status: 'cancelled' });
    expect(await hanging.logins.cancel('a'.repeat(24))).toBeUndefined();
    expect(await org.logins.cancel(orgJob.jobId)).toEqual({ ok: true, status: 'failed' });
    expect(await expired.logins.cancel(expiredJob.jobId)).toEqual({
      ok: true,
      status: 'expired',
    });

    const replaced = await hanging.logins.start({ expectedProfile: PROFILE });
    expect(hanging.logins.get(pending.jobId)?.status).toBe('cancelled');
    expect(replaced.status).toBe('pending');

    const capped = await open(
      { login: { action: 'hang', readyMs: 10 }, profiles: [PROFILE] },
      { maxPending: 2 },
    );
    await capped.logins.start({ expectedProfile: 'dingcorp0123456789:10001' });
    await capped.logins.start({ expectedProfile: 'dingcorp0123456789:10002' });
    await expect(
      capped.logins.start({ expectedProfile: 'dingcorp0123456789:10003' }),
    ).rejects.toMatchObject({
      code: 'TOO_MANY_LOGINS',
      status: 429,
    });

    const quiet = await open(
      { login: { action: 'no-code' }, profiles: [PROFILE] },
      { readyTimeoutMs: 200 },
    );
    await expect(quiet.logins.start({ expectedProfile: PROFILE })).rejects.toBeInstanceOf(
      BrokerError,
    );
  });

  it('reserves a pending slot before the first await', async () => {
    const { logins } = await open({ login: { action: 'hang', readyMs: 20 }, profiles: [PROFILE] });
    const starts = Array.from({ length: 11 }, (_, index) =>
      logins.start({ expectedProfile: `dingcorp0123456789:${20000 + index}` }),
    );
    const results = await Promise.allSettled(starts);
    const ok = results.filter((item) => item.status === 'fulfilled');
    const denied = results.filter((item) => item.status === 'rejected');
    expect(ok).toHaveLength(10);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({
      reason: { code: 'TOO_MANY_LOGINS', status: 429 },
      status: 'rejected',
    });
  });

  it('fails login start when the profile snapshot fails and does not spawn device login', async () => {
    const { dirs, logins } = await open(
      {
        login: {
          action: 'ok',
          corp_id: 'dingcorp0123456789',
          exitMs: 20,
          readyMs: 10,
          user_id: '012345678901234567',
        },
        profileListExit: 1,
        profiles: [PROFILE],
      },
      { startDeadlineMs: 2_000 },
    );
    await expect(logins.start({ expectedProfile: PROFILE })).rejects.toMatchObject({
      code: 'LOGIN_START_FAILED',
      status: 502,
    });
    const calls = await readInvocations(dirs.configDir);
    expect(calls.some((call) => call.argv[0] === 'profile' && call.argv[1] === 'list')).toBe(true);
    expect(calls.some((call) => call.argv[1] === 'login')).toBe(false);

    await writeControl(dirs.configDir, {
      login: {
        action: 'ok',
        corp_id: 'dingcorp0123456789',
        exitMs: 20,
        readyMs: 10,
        user_id: '012345678901234567',
      },
      profiles: [PROFILE],
    });
    const started = Date.now();
    const job = await logins.start({ expectedProfile: PROFILE });
    expect(job.status).toBe('pending');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('fails login start when the profile snapshot hangs', async () => {
    const { dirs, logins } = await open(
      { profileListAction: 'hang', profiles: [PROFILE] },
      { startDeadlineMs: 400 },
    );
    const started = Date.now();
    await expect(logins.start({ expectedProfile: PROFILE })).rejects.toMatchObject({
      code: 'LOGIN_START_FAILED',
      status: 502,
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    const calls = await readInvocations(dirs.configDir);
    expect(calls.some((call) => call.argv[1] === 'login')).toBe(false);
  });

  it('reports a succeeded login on cancel without logging out', async () => {
    const { dirs, logins } = await open({
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
    const job = await logins.start({ expectedProfile: PROFILE });
    const done = await settle(logins, job.jobId);
    expect(done?.status).toBe('succeeded');
    expect(await logins.cancel(job.jobId)).toEqual({
      identity: {
        corpId: 'dingcorp0123456789',
        corpName: '示例科技有限公司',
        userId: '012345678901234567',
        userName: '张三',
      },
      ok: true,
      status: 'succeeded',
    });
    expect(logins.get(job.jobId)?.status).toBe('succeeded');
    const calls = await readInvocations(dirs.configDir);
    expect(calls.some((call) => call.argv[1] === 'logout')).toBe(false);
  });

  it('fails login start on the deadline and kills the device-code child', async () => {
    const { dirs, logins } = await open(
      { login: { action: 'no-code' }, profiles: [PROFILE] },
      { readyTimeoutMs: 10_000, startDeadlineMs: 800 },
    );
    const started = Date.now();
    await expect(logins.start({ expectedProfile: PROFILE })).rejects.toMatchObject({
      code: 'LOGIN_START_FAILED',
      status: 502,
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    await sleep(50);
    await writeControl(dirs.configDir, {
      login: {
        action: 'ok',
        corp_id: 'dingcorp0123456789',
        exitMs: 20,
        readyMs: 10,
        user_id: '012345678901234567',
      },
      profiles: [PROFILE],
    });
    const job = await logins.start({ expectedProfile: PROFILE });
    expect(job.status).toBe('pending');
  });

  it('fails login start when the profile lock eats the deadline', async () => {
    const { dirs, logins, runner } = await open(
      { exec: { action: 'hang' }, profiles: [PROFILE] },
      { startDeadlineMs: 250 },
    );
    const held = runner.run({
      argv: ['todo', '+get', '--task-id=1'],
      profile: PROFILE,
      timeoutMs: 5_000,
    });
    await sleep(40);
    const started = Date.now();
    await expect(logins.start({ expectedProfile: PROFILE })).rejects.toMatchObject({
      code: 'LOGIN_START_FAILED',
      status: 502,
    });
    expect(Date.now() - started).toBeLessThan(1_500);
    const calls = await readInvocations(dirs.configDir);
    expect(calls.some((call) => call.argv[1] === 'login')).toBe(false);
    runner.close();
    await held.catch(() => undefined);
  });

  it('reports success when a killed pending login already wrote the expected profile', async () => {
    const { dirs, logins } = await open(
      {
        login: {
          action: 'persist-hang',
          corp_id: 'dingcorp0123456789',
          corp_name: '示例科技有限公司',
          readyMs: 10,
          user_id: '012345678901234567',
          user_name: '张三',
        },
        profiles: [],
      },
      { startDeadlineMs: 3_000 },
    );
    const job = await logins.start({ actor: 'u1', expectedProfile: PROFILE });
    expect(job.status).toBe('pending');
    const started = Date.now();
    expect(await logins.cancel(job.jobId)).toEqual({
      identity: {
        corpId: 'dingcorp0123456789',
        corpName: '示例科技有限公司',
        userId: '012345678901234567',
        userName: '张三',
      },
      ok: true,
      status: 'succeeded',
    });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(logins.get(job.jobId)?.status).toBe('succeeded');
    const calls = await readInvocations(dirs.configDir);
    expect(calls.some((call) => call.argv[1] === 'logout')).toBe(false);
    await writeControl(dirs.configDir, {
      login: { action: 'hang', readyMs: 10 },
      profiles: [PROFILE],
    });
    const next = await logins.start({ expectedProfile: PROFILE });
    expect(next.status).toBe('pending');
  });

  it('logs out a stray profile written before the pending login was killed', async () => {
    const { dirs, logins } = await open({
      login: {
        action: 'persist-hang',
        corp_id: 'dingOTHERCORP',
        corp_name: '别的公司',
        readyMs: 10,
        stray_corp_id: 'dingSTRAYCORP',
        stray_user_id: '999',
        stray_user_name: '李四',
        user_id: '999',
        user_name: '李四',
      },
      profiles: [PROFILE],
    });
    const job = await logins.start({ expectedProfile: PROFILE });
    expect(await logins.cancel(job.jobId)).toEqual({ ok: true, status: 'cancelled' });
    expect(logins.get(job.jobId)?.status).toBe('cancelled');
    const calls = await readInvocations(dirs.configDir);
    const loggedOut = calls
      .filter((call) => call.argv[1] === 'logout')
      .map((call) => call.argv.find((arg) => arg.startsWith('--profile=')));
    expect(loggedOut).toEqual(
      expect.arrayContaining(['--profile=dingOTHERCORP:999', '--profile=dingSTRAYCORP:999']),
    );
    expect(loggedOut).not.toContain(`--profile=${PROFILE}`);
  });

  it('keeps a pre-existing profile unless lastLoginAt moved, and still logs out other newcomers', async () => {
    const same = '2020-01-01T00:00:00.000Z';
    const unchanged = await open({
      login: {
        action: 'persist-hang',
        corp_id: 'dingcorp0123456789',
        corp_name: '示例科技有限公司',
        lastLoginAt: same,
        readyMs: 10,
        user_id: '012345678901234567',
        user_name: '张三',
      },
      profiles: [
        {
          corpId: 'dingcorp0123456789',
          corpName: '示例科技有限公司',
          lastLoginAt: same,
          profile: PROFILE,
          status: 'active',
          userId: '012345678901234567',
          userName: '张三',
        },
      ],
    });
    const kept = await unchanged.logins.start({ expectedProfile: PROFILE });
    expect(await unchanged.logins.cancel(kept.jobId)).toEqual({ ok: true, status: 'cancelled' });
    expect(
      (await readInvocations(unchanged.dirs.configDir)).some((call) => call.argv[1] === 'logout'),
    ).toBe(false);

    const refreshed = await open({
      login: {
        action: 'persist-hang',
        corp_id: 'dingcorp0123456789',
        corp_name: '示例科技有限公司',
        lastLoginAt: '2026-09-24T12:00:01.000Z',
        readyMs: 10,
        stray_corp_id: 'dingSTRAYCORP',
        stray_user_id: '999',
        user_id: '012345678901234567',
        user_name: '张三',
      },
      profiles: [
        {
          corpId: 'dingcorp0123456789',
          corpName: '示例科技有限公司',
          lastLoginAt: '2020-01-01T00:00:00.000Z',
          profile: PROFILE,
          status: 'active',
          userId: '012345678901234567',
          userName: '张三',
        },
      ],
    });
    const job = await refreshed.logins.start({ expectedProfile: PROFILE });
    expect(await refreshed.logins.cancel(job.jobId)).toEqual({
      identity: {
        corpId: 'dingcorp0123456789',
        corpName: '示例科技有限公司',
        userId: '012345678901234567',
        userName: '张三',
      },
      ok: true,
      status: 'succeeded',
    });
    const calls = await readInvocations(refreshed.dirs.configDir);
    expect(
      calls.some(
        (call) => call.argv[1] === 'logout' && call.argv.includes('--profile=dingSTRAYCORP:999'),
      ),
    ).toBe(true);
    expect(
      calls.some((call) => call.argv[1] === 'logout' && call.argv.includes(`--profile=${PROFILE}`)),
    ).toBe(false);
  });

  it('reports reconciled false and audits when the post-cancel profile list fails', async () => {
    const lines: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      const { dirs, logins } = await open(
        {
          login: {
            action: 'persist-hang',
            corp_id: 'dingcorp0123456789',
            readyMs: 10,
            user_id: '012345678901234567',
          },
          profiles: [],
        },
        { cancelListMs: 400 },
      );
      const job = await logins.start({ actor: 'u1', expectedProfile: PROFILE });
      await writeControl(dirs.configDir, { profileListExit: 1 });
      const started = Date.now();
      expect(await logins.cancel(job.jobId)).toEqual({
        ok: true,
        reconciled: false,
        status: 'cancelled',
      });
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(logins.get(job.jobId)?.status).toBe('cancelled');
      expect(await logins.cancel(job.jobId)).toEqual({
        ok: true,
        reconciled: false,
        status: 'cancelled',
      });
      expect(lines.join('')).toContain('"errorCode":"CANCEL_RECONCILE_FAILED"');
      expect(lines.join('')).not.toContain(PROFILE);
      expect(
        (await readInvocations(dirs.configDir)).some((call) => call.argv[1] === 'logout'),
      ).toBe(false);

      const hangingList = await open(
        {
          login: {
            action: 'persist-hang',
            corp_id: 'dingcorp0123456789',
            readyMs: 10,
            user_id: '012345678901234567',
          },
          profiles: [],
        },
        { cancelListMs: 300, cancelWaitMs: 200 },
      );
      const slow = await hangingList.logins.start({ expectedProfile: PROFILE });
      await writeControl(hangingList.dirs.configDir, { profileListAction: 'hang' });
      const slowStarted = Date.now();
      expect(await hangingList.logins.cancel(slow.jobId)).toEqual({
        ok: true,
        reconciled: false,
        status: 'cancelled',
      });
      expect(Date.now() - slowStarted).toBeLessThan(2_000);
    } finally {
      process.stdout.write = original;
    }
  });

  it('does not take the login profile lock while reconciling a cancel', async () => {
    const { logins, runner } = await open({
      exec: { action: 'hang' },
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
    const job = await logins.start({ expectedProfile: PROFILE });
    const held = runner.run({
      argv: ['todo', '+get', '--task-id=1'],
      profile: PROFILE,
      timeoutMs: 5_000,
    });
    await sleep(40);
    const started = Date.now();
    expect(await logins.cancel(job.jobId)).toMatchObject({
      ok: true,
      status: 'succeeded',
    });
    expect(Date.now() - started).toBeLessThan(3_000);
    runner.close();
    await held.catch(() => undefined);
  });
});
