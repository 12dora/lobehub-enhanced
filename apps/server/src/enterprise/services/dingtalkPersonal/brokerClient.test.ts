// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = vi.hoisted(() => `broker-${'t'.repeat(32)}`);

vi.mock('@/envs/dingtalkPersonal', () => ({
  dingtalkPersonalEnv: {
    DINGTALK_PERSONAL_BROKER_TOKEN: TOKEN,
    DINGTALK_PERSONAL_BROKER_URL: 'http://aihub-dws:8080',
  },
}));

const {
  cancelDingtalkPersonalLogin,
  DINGTALK_PERSONAL_BROKER_TIMEOUT_MS,
  deleteDingtalkPersonalProfile,
  downloadDingtalkPersonalFile,
  execDingtalkPersonal,
  getDingtalkPersonalLoginJob,
  getDingtalkPersonalProfileStatus,
  isDingtalkVerificationUrl,
  startDingtalkPersonalLogin,
} = await import('./brokerClient');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });

describe('dingtalk personal broker client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const secretBlob = (error: unknown) =>
    `${error instanceof Error ? error.message : ''} ${JSON.stringify(error)}`;

  it('sends the bearer token and the server profile, and decodes a downloaded file', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        durationMs: 10,
        file: {
          contentBase64: Buffer.from('hello').toString('base64'),
          name: '库存.xlsx',
          sizeBytes: 99,
        },
        ok: true,
      }),
    );

    const file = await downloadDingtalkPersonalFile({
      actor: 'user-a',
      args: { resourceId: 'file-1', resourceType: 'fileId' },
      op: 'chat.downloadFile',
      profile: 'dingcorp:staff1',
    });

    expect(file.buffer.toString()).toBe('hello');
    expect(file.name).toBe('库存.xlsx');
    expect(file.sizeBytes).toBe(5);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://aihub-dws:8080/v1/exec');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init.body))).toEqual({
      actor: 'user-a',
      args: { resourceId: 'file-1', resourceType: 'fileId' },
      op: 'chat.downloadFile',
      profile: 'dingcorp:staff1',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps broker and exec errors without copying tokens into the thrown error', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: { code: 'UNAUTHORIZED', message: `Bearer ${TOKEN}` } }, 401),
    );
    await expect(
      startDingtalkPersonalLogin({ expectedProfile: 'dingcorp:staff1' }),
    ).rejects.toMatchObject({ code: 'DINGTALK_PERSONAL_INTERNAL' });

    fetchMock.mockResolvedValueOnce(
      json({ error: { code: 'LOGIN_NOT_FOUND', message: TOKEN } }, 404),
    );
    await expect(getDingtalkPersonalLoginJob('job-1')).rejects.toMatchObject({
      code: 'DINGTALK_PERSONAL_LOGIN_NOT_FOUND',
    });

    fetchMock.mockResolvedValueOnce(json({ error: { code: 'TIMEOUT', message: '执行超时' } }, 502));
    await expect(getDingtalkPersonalProfileStatus('dingcorp:staff1')).rejects.toMatchObject({
      code: 'DINGTALK_PERSONAL_TIMEOUT',
    });

    fetchMock.mockResolvedValueOnce(
      json({ error: { code: 'TOO_MANY_LOGINS', message: TOKEN } }, 429),
    );
    await expect(
      startDingtalkPersonalLogin({ expectedProfile: 'dingcorp:staff1' }),
    ).rejects.toMatchObject({ code: 'DINGTALK_PERSONAL_RATE_LIMITED' });

    fetchMock.mockResolvedValueOnce(
      json(
        {
          error: { code: 'LOGIN_START_FAILED', message: `失败 token=${TOKEN}` },
        },
        502,
      ),
    );
    try {
      await startDingtalkPersonalLogin({ expectedProfile: 'dingcorp:staff1' });
      throw new Error('expected upstream');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'DINGTALK_PERSONAL_UPSTREAM',
        details: { message: expect.stringContaining('[redacted]') },
      });
      expect(secretBlob(error)).not.toContain(TOKEN);
    }

    fetchMock.mockResolvedValueOnce(
      json({ ok: false, error: { code: 'NOT_AUTHORIZED', message: TOKEN } }),
    );
    await expect(
      execDingtalkPersonal({ args: {}, op: 'todo.list', profile: 'dingcorp:staff1' }),
    ).rejects.toMatchObject({ code: 'DINGTALK_PERSONAL_UNAUTHORIZED' });

    fetchMock.mockResolvedValueOnce(
      json({
        ok: false,
        error: {
          code: 'PAT_REQUIRED',
          message: TOKEN,
          patUri: `https://dingtalk.example/p?token=${TOKEN}`,
        },
      }),
    );
    try {
      await execDingtalkPersonal({ args: {}, op: 'todo.list', profile: 'dingcorp:staff1' });
      throw new Error('expected pat');
    } catch (error) {
      expect(error).toMatchObject({ code: 'DINGTALK_PERSONAL_PAT_REQUIRED' });
      expect(secretBlob(error)).not.toContain(TOKEN);
      expect(secretBlob(error)).toContain('https://dingtalk.example/p');
    }

    fetchMock.mockResolvedValueOnce(
      json({
        error: {
          code: 'VALIDATION',
          message: `该节点是在线表格或在线文档，不能直接下载。在线表格请用 readSheet，在线文档请用 readDoc。 token=${TOKEN}${'长'.repeat(200)}`,
        },
        ok: false,
      }),
    );
    try {
      await execDingtalkPersonal({ args: {}, op: 'drive.download', profile: 'dingcorp:staff1' });
      throw new Error('expected validation');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'DINGTALK_PERSONAL_INVALID_ARGS',
        details: { message: expect.stringContaining('readSheet') },
      });
      const message = (error as { details?: { message?: string } }).details?.message ?? '';
      expect(message.length).toBeLessThanOrEqual(200);
      expect(message).toContain('readDoc');
      expect(secretBlob(error)).not.toContain(TOKEN);
    }

    fetchMock.mockResolvedValueOnce(json({ error: { code: 'VALIDATION' }, ok: false }));
    await expect(
      execDingtalkPersonal({ args: {}, op: 'chat.downloadFile', profile: 'dingcorp:staff1' }),
    ).rejects.toMatchObject({ code: 'DINGTALK_PERSONAL_INVALID_ARGS', details: undefined });

    fetchMock.mockRejectedValueOnce(new TypeError(`connect ${TOKEN}`));
    try {
      await execDingtalkPersonal({ args: {}, op: 'todo.list', profile: 'dingcorp:staff1' });
      throw new Error('expected unavailable');
    } catch (error) {
      expect(error).toMatchObject({ code: 'DINGTALK_PERSONAL_BROKER_UNAVAILABLE' });
      expect(secretBlob(error)).not.toContain(TOKEN);
    }

    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain(TOKEN);
  });

  it('rejects a verificationUrl that is not https on a DingTalk host', async () => {
    const pending = (verificationUrl: string) =>
      json(
        {
          expiresAt: '2026-09-24T00:15:00.000Z',
          jobId: 'job-1',
          status: 'pending',
          userCode: 'JCHB-KBXF',
          verificationUrl,
        },
        201,
      );

    for (const verificationUrl of [
      'javascript:alert(1)',
      'http://login.dingtalk.com/oauth2/device/verify.htm?user_code=JCHB-KBXF',
      'https://evil.example/verify',
      'https://login.dingtalk.com.evil.com/verify',
      'https://dingtalk.com/verify',
    ]) {
      fetchMock.mockResolvedValueOnce(pending(verificationUrl));
      await expect(
        startDingtalkPersonalLogin({ expectedProfile: 'dingcorp:staff1' }),
      ).rejects.toMatchObject({
        code: 'DINGTALK_PERSONAL_UPSTREAM',
        details: { message: '授权链接无效' },
      });
    }

    const accepted = 'https://login.dingtalk.com/oauth2/device/verify.htm?user_code=JCHB-KBXF';
    fetchMock.mockResolvedValueOnce(pending(accepted));
    await expect(
      startDingtalkPersonalLogin({ expectedProfile: 'dingcorp:staff1' }),
    ).resolves.toMatchObject({ verificationUrl: accepted });

    const subdomain = 'https://accounts.dingtalk.com/oauth2/device/verify.htm?user_code=JCHB-KBXF';
    fetchMock.mockResolvedValueOnce(pending(subdomain));
    await expect(getDingtalkPersonalLoginJob('job-1')).resolves.toMatchObject({
      verificationUrl: subdomain,
    });

    expect(isDingtalkVerificationUrl(accepted)).toBe(true);
    expect(isDingtalkVerificationUrl('https://foo.bar.dingtalk.com/a')).toBe(true);
    expect(isDingtalkVerificationUrl('http://login.dingtalk.com/a')).toBe(false);
    expect(isDingtalkVerificationUrl('https://notdingtalk.com/a')).toBe(false);
  });

  it('aborts login start at 30s and a job read at 10s', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );

    let startCode = '';
    const start = startDingtalkPersonalLogin({ expectedProfile: 'dingcorp:staff1' }).catch(
      (error: { code?: string }) => {
        startCode = error.code ?? '';
      },
    );
    await vi.advanceTimersByTimeAsync(DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.loginJob);
    expect(startCode).toBe('');
    await vi.advanceTimersByTimeAsync(
      DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.loginStart - DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.loginJob,
    );
    await start;
    expect(startCode).toBe('DINGTALK_PERSONAL_BROKER_UNAVAILABLE');

    let jobCode = '';
    const job = getDingtalkPersonalLoginJob('job-1').catch((error: { code?: string }) => {
      jobCode = error.code ?? '';
    });
    await vi.advanceTimersByTimeAsync(DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.loginJob);
    await job;
    expect(jobCode).toBe('DINGTALK_PERSONAL_BROKER_UNAVAILABLE');
  });

  it('aborts exec at 75s and download at 150s', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );

    let execDone = false;
    const exec = execDingtalkPersonal({ args: {}, op: 'todo.list', profile: 'c:s' })
      .catch(() => undefined)
      .finally(() => {
        execDone = true;
      });
    await vi.advanceTimersByTimeAsync(DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.loginStart);
    expect(execDone).toBe(false);
    await vi.advanceTimersByTimeAsync(
      DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.exec - DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.loginStart,
    );
    await exec;
    expect(execDone).toBe(true);

    let downloadDone = false;
    const download = downloadDingtalkPersonalFile({
      args: {},
      op: 'chat.downloadFile',
      profile: 'c:s',
    })
      .catch(() => undefined)
      .finally(() => {
        downloadDone = true;
      });
    await vi.advanceTimersByTimeAsync(DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.exec);
    expect(downloadDone).toBe(false);
    await vi.advanceTimersByTimeAsync(
      DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.download - DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.exec,
    );
    await download;
    expect(downloadDone).toBe(true);
  });

  it('returns the profile delete result and maps LOGOUT_FAILED', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true, removed: true }));
    await expect(deleteDingtalkPersonalProfile('dingcorp:staff1')).resolves.toEqual({
      absent: false,
      removed: true,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(decodeURIComponent(url)).toBe('http://aihub-dws:8080/v1/profiles/dingcorp:staff1');
    expect(init.method).toBe('DELETE');

    fetchMock.mockResolvedValueOnce(json({ absent: true, ok: true, removed: false }));
    await expect(deleteDingtalkPersonalProfile('dingcorp:staff1')).resolves.toEqual({
      absent: true,
      removed: false,
    });

    fetchMock.mockResolvedValueOnce(
      json({ error: { code: 'LOGOUT_FAILED', message: `token=${TOKEN}` } }, 502),
    );
    try {
      await deleteDingtalkPersonalProfile('dingcorp:staff1');
      throw new Error('expected revoke failure');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'DINGTALK_PERSONAL_REVOKE_FAILED',
        details: { message: expect.stringContaining('[redacted]') },
      });
      expect(secretBlob(error)).not.toContain(TOKEN);
    }
  });

  it('parses a login cancel and rejects a body without a status', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        identity: { corpId: 'dingcorp', corpName: '示例公司', userId: 'staff1', userName: '甲' },
        ok: true,
        status: 'succeeded',
      }),
    );
    await expect(cancelDingtalkPersonalLogin('job-1')).resolves.toEqual({
      identity: { corpId: 'dingcorp', corpName: '示例公司', userId: 'staff1', userName: '甲' },
      status: 'succeeded',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://aihub-dws:8080/v1/login/job-1');
    expect(init.method).toBe('DELETE');

    fetchMock.mockResolvedValueOnce(json({ ok: true, status: 'cancelled' }));
    await expect(cancelDingtalkPersonalLogin('job-1')).resolves.toEqual({ status: 'cancelled' });

    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    await expect(cancelDingtalkPersonalLogin('job-1')).rejects.toMatchObject({
      code: 'DINGTALK_PERSONAL_BROKER_UNAVAILABLE',
    });
  });

  it('aborts status at 30s, revoke at 45s, and login cancel at 45s', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );

    let statusCode = '';
    const status = getDingtalkPersonalProfileStatus('dingcorp:staff1').catch(
      (error: { code?: string }) => {
        statusCode = error.code ?? '';
      },
    );
    await vi.advanceTimersByTimeAsync(DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.loginJob);
    expect(statusCode).toBe('');
    await vi.advanceTimersByTimeAsync(
      DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.profileStatus -
        DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.loginJob,
    );
    await status;
    expect(statusCode).toBe('DINGTALK_PERSONAL_BROKER_UNAVAILABLE');

    let revokeCode = '';
    const revoke = deleteDingtalkPersonalProfile('dingcorp:staff1').catch(
      (error: { code?: string }) => {
        revokeCode = error.code ?? '';
      },
    );
    await vi.advanceTimersByTimeAsync(DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.profileStatus);
    expect(revokeCode).toBe('');
    await vi.advanceTimersByTimeAsync(
      DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.revoke -
        DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.profileStatus,
    );
    await revoke;
    expect(revokeCode).toBe('DINGTALK_PERSONAL_BROKER_UNAVAILABLE');

    let cancelCode = '';
    const cancel = cancelDingtalkPersonalLogin('job-1').catch((error: { code?: string }) => {
      cancelCode = error.code ?? '';
    });
    await vi.advanceTimersByTimeAsync(DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.loginJob);
    expect(cancelCode).toBe('');
    await vi.advanceTimersByTimeAsync(
      DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.cancelLogin -
        DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.loginJob,
    );
    await cancel;
    expect(cancelCode).toBe('DINGTALK_PERSONAL_BROKER_UNAVAILABLE');
  });

  it('keeps the abort timer armed until the response body is read', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          new Promise((_resolve, reject) => {
            const abort = () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            };
            if (init.signal?.aborted) {
              abort();
              return;
            }
            init.signal?.addEventListener('abort', abort);
          }),
      } as Response),
    );

    let code = '';
    const pending = getDingtalkPersonalLoginJob('job-1').catch((error: { code?: string }) => {
      code = error.code ?? '';
    });
    await vi.advanceTimersByTimeAsync(DINGTALK_PERSONAL_BROKER_TIMEOUT_MS.loginJob - 1);
    expect(code).toBe('');
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(code).toBe('DINGTALK_PERSONAL_BROKER_UNAVAILABLE');
  });
});
