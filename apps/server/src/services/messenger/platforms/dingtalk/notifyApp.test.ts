// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisDel = vi.fn();

vi.mock('@/config/messenger', () => ({
  getMessengerDingTalkConfig: vi.fn(),
}));

vi.mock('@/server/enterprise/services/branding/runtimeBranding', () => ({
  resolveServerRuntimeBranding: vi.fn(),
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => ({
    del: mockRedisDel,
    get: mockRedisGet,
    set: mockRedisSet,
  })),
}));

const recordDingtalkHttpCall = vi.hoisted(() => vi.fn());

vi.mock('@/server/enterprise/services/dingtalkWorkspace/apiCallStats', () => ({
  recordDingtalkHttpCall,
}));

const { getMessengerDingTalkConfig } = await import('@/config/messenger');
const { resolveServerRuntimeBranding } =
  await import('@/server/enterprise/services/branding/runtimeBranding');
const {
  buildDirectoryReplaceAllInput,
  buildNotifyRobotMarkdown,
  buildOaWorkNoticePayload,
  DINGTALK_ASYNCSEND_V2_URL,
  DINGTALK_DEPT_GET_URL,
  DINGTALK_DEPT_LISTSUB_URL,
  DINGTALK_NEW_API_ACCESS_TOKEN_URL,
  DINGTALK_NOTIFY_NEW_TOKEN_REDIS_KEY,
  DINGTALK_NOTIFY_TOKEN_REDIS_KEY,
  DINGTALK_OA_HEAD_BGCOLOR,
  DINGTALK_OA_HEAD_TEXT_FALLBACK,
  DINGTALK_OAPI_GETTOKEN_URL,
  DINGTALK_ROBOT_BATCH_SEND_URL,
  DINGTALK_ROBOT_USERID_CHUNK,
  DINGTALK_USER_LIST_URL,
  DINGTALK_WORK_NOTICE_USERID_CHUNK,
  DingTalkNotifyAppError,
  fetchDirectoryReplaceAllInput,
  getNotifyAppNewApiToken,
  getNotifyAppToken,
  invalidateNotifyAppToken,
  isNotifyChannelEnabled,
  listDepartments,
  listDeptUsers,
  probeNotifyAppToken,
  readNotifyAppFromMessengerConfig,
  readNotifyAppFromProviderRow,
  resetNotifyAppStateForTest,
  resolveWorkNoticeHeadText,
  sendRobotMessage,
  sendWorkNotice,
} = await import('./notifyApp');

const NOTIFY_APP = {
  agentId: '4617854001',
  appKey: 'notify-key',
  appSecret: 'notify-secret',
};

const jsonResponse = (body: unknown, status = 200) =>
  ({
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }) as const;

const tokenFetch = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
  jsonResponse({ access_token: 'tok', errcode: 0, expires_in: 7200 }),
);

beforeEach(() => {
  resetNotifyAppStateForTest();
  recordDingtalkHttpCall.mockReset();
  vi.mocked(getMessengerDingTalkConfig).mockResolvedValue({ notifyApp: NOTIFY_APP } as never);
  mockRedisGet.mockReset().mockResolvedValue(null);
  mockRedisSet.mockReset().mockResolvedValue('OK');
  mockRedisDel.mockReset().mockResolvedValue(1);
  tokenFetch
    .mockReset()
    .mockImplementation(async () =>
      jsonResponse({ access_token: 'tok', errcode: 0, expires_in: 7200 }),
    );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('readNotifyAppFromMessengerConfig', () => {
  it('returns null unless appKey, appSecret, and agentId are all present', () => {
    expect(readNotifyAppFromMessengerConfig(null)).toBeNull();
    expect(
      readNotifyAppFromMessengerConfig({ notifyApp: { appKey: 'a', appSecret: 's' } }),
    ).toBeNull();
    expect(readNotifyAppFromMessengerConfig({ notifyApp: NOTIFY_APP })).toEqual(NOTIFY_APP);
  });
});

describe('isNotifyChannelEnabled', () => {
  it('treats missing as on and false as off', () => {
    expect(isNotifyChannelEnabled(undefined)).toBe(true);
    expect(isNotifyChannelEnabled(true)).toBe(true);
    expect(isNotifyChannelEnabled(false)).toBe(false);
  });
});

describe('readNotifyAppFromProviderRow', () => {
  it('reads notifyAppKey / notifyAgentId / notifyAppSecret', () => {
    expect(
      readNotifyAppFromProviderRow({
        credentials: { notifyAppSecret: 'secret' },
        settings: { notifyAgentId: '9', notifyAppKey: 'key' },
      }),
    ).toEqual({ agentId: '9', appKey: 'key', appSecret: 'secret' });
  });
});

describe('getNotifyAppToken', () => {
  it('calls oapi /gettoken with the notify app key/secret and caches ~100 min', async () => {
    const token = await getNotifyAppToken({ fetchImpl: tokenFetch, now: 1_000 });
    expect(token).toBe('tok');
    expect(tokenFetch).toHaveBeenCalledTimes(1);
    const calledUrl = String(tokenFetch.mock.calls[0]?.[0]);
    expect(calledUrl.startsWith(DINGTALK_OAPI_GETTOKEN_URL)).toBe(true);
    expect(calledUrl).toContain('appkey=notify-key');
    expect(calledUrl).toContain('appsecret=notify-secret');
    expect(mockRedisSet).toHaveBeenCalledWith(
      DINGTALK_NOTIFY_TOKEN_REDIS_KEY,
      expect.stringContaining('"token":"tok"'),
      'EX',
      expect.any(Number),
    );

    const again = await getNotifyAppToken({ fetchImpl: tokenFetch, now: 2_000 });
    expect(again).toBe('tok');
    expect(tokenFetch).toHaveBeenCalledTimes(1);
    expect(recordDingtalkHttpCall).toHaveBeenCalledTimes(1);
    expect(recordDingtalkHttpCall).toHaveBeenCalledWith(
      'GET',
      expect.stringContaining(DINGTALK_OAPI_GETTOKEN_URL),
    );
  });

  it('reuses a still-valid Redis token without refetching', async () => {
    mockRedisGet.mockResolvedValueOnce(
      JSON.stringify({ appKey: NOTIFY_APP.appKey, expiresAt: 50_000, token: 'cached' }),
    );
    const token = await getNotifyAppToken({ fetchImpl: tokenFetch, now: 1_000 });
    expect(token).toBe('cached');
    expect(tokenFetch).not.toHaveBeenCalled();
  });

  it('hydrates memory from Redis expiresAt and refetches after that instant', async () => {
    mockRedisGet.mockResolvedValue(
      JSON.stringify({ appKey: NOTIFY_APP.appKey, expiresAt: 2_000, token: 'cached' }),
    );
    await expect(getNotifyAppToken({ fetchImpl: tokenFetch, now: 1_000 })).resolves.toBe('cached');
    expect(tokenFetch).not.toHaveBeenCalled();

    mockRedisGet.mockResolvedValueOnce(null);
    await expect(getNotifyAppToken({ fetchImpl: tokenFetch, now: 2_000 })).resolves.toBe('tok');
    expect(tokenFetch).toHaveBeenCalledTimes(1);
  });

  it('invalidateNotifyAppToken drops memory so the next call refetches', async () => {
    await getNotifyAppToken({ fetchImpl: tokenFetch, now: 1_000 });
    await invalidateNotifyAppToken();
    expect(mockRedisDel).toHaveBeenCalledWith(
      DINGTALK_NOTIFY_TOKEN_REDIS_KEY,
      DINGTALK_NOTIFY_NEW_TOKEN_REDIS_KEY,
    );
    await getNotifyAppToken({ fetchImpl: tokenFetch, now: 2_000 });
    expect(tokenFetch).toHaveBeenCalledTimes(2);
  });

  it('throws with errcode/errmsg when gettoken fails', async () => {
    tokenFetch.mockResolvedValueOnce(
      jsonResponse({ errcode: 40001, errmsg: 'invalid secret' }, 200),
    );
    await expect(
      getNotifyAppToken({ fetchImpl: tokenFetch, skipCache: true }),
    ).rejects.toMatchObject({
      errcode: 40001,
      errmsg: 'invalid secret',
      name: 'DingTalkNotifyAppError',
    });
  });
});

describe('getNotifyAppNewApiToken', () => {
  const newTokenFetch = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
    jsonResponse({ accessToken: 'new-tok', expireIn: 7200 }),
  );

  beforeEach(() => {
    newTokenFetch
      .mockReset()
      .mockImplementation(async () => jsonResponse({ accessToken: 'new-tok', expireIn: 7200 }));
  });

  it('calls oauth2/accessToken with the notify credentials and caches per appKey', async () => {
    const token = await getNotifyAppNewApiToken({ fetchImpl: newTokenFetch, now: 1_000 });
    expect(token).toBe('new-tok');
    expect(newTokenFetch).toHaveBeenCalledTimes(1);
    expect(String(newTokenFetch.mock.calls[0]?.[0])).toBe(
      'https://api.dingtalk.com/v1.0/oauth2/accessToken',
    );
    expect(JSON.parse(String(newTokenFetch.mock.calls[0]?.[1]?.body))).toEqual({
      appKey: NOTIFY_APP.appKey,
      appSecret: 'notify-secret',
    });
    expect(mockRedisSet).toHaveBeenCalledWith(
      DINGTALK_NOTIFY_NEW_TOKEN_REDIS_KEY,
      expect.stringContaining('"token":"new-tok"'),
      'EX',
      expect.any(Number),
    );

    const again = await getNotifyAppNewApiToken({ fetchImpl: newTokenFetch, now: 2_000 });
    expect(again).toBe('new-tok');
    expect(newTokenFetch).toHaveBeenCalledTimes(1);
  });

  it('does not reuse the oapi gettoken cache', async () => {
    await getNotifyAppToken({ fetchImpl: tokenFetch, now: 1_000 });
    expect(tokenFetch).toHaveBeenCalledTimes(1);
    await getNotifyAppNewApiToken({ fetchImpl: newTokenFetch, now: 1_000 });
    expect(newTokenFetch).toHaveBeenCalledTimes(1);
  });
});

describe('probeNotifyAppToken', () => {
  it('returns ok when gettoken and oauth2/accessToken both succeed', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/gettoken')) {
        return jsonResponse({ access_token: 'tok', errcode: 0, expires_in: 7200 });
      }
      if (url.includes('/oauth2/accessToken')) {
        return jsonResponse({ accessToken: 'new-tok', expireIn: 7200 });
      }
      return jsonResponse({ errcode: 1, errmsg: 'unexpected' }, 400);
    });
    const result = await probeNotifyAppToken({
      appKey: 'k',
      appSecret: 's',
      fetchImpl,
    });
    expect(result).toMatchObject({ errorCode: null, ok: true, robotName: null });
    expect(result.latencyMs).toEqual(expect.any(Number));
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).includes('/gettoken'))).toBe(true);
    expect(
      fetchImpl.mock.calls.some((call) => String(call[0]).includes('/oauth2/accessToken')),
    ).toBe(true);
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).includes('/oToMessages'))).toBe(
      false,
    );
  });

  it('maps invalid secret to auth_failed', async () => {
    tokenFetch.mockResolvedValueOnce(
      jsonResponse({ errcode: 40001, errmsg: 'invalid appsecret' }, 200),
    );
    const result = await probeNotifyAppToken({
      appKey: 'bad',
      appSecret: 'bad',
      fetchImpl: tokenFetch,
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('auth_failed');
  });

  it('fails when gettoken works but the new-API token does not', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/gettoken')) {
        return jsonResponse({ access_token: 'tok', errcode: 0, expires_in: 7200 });
      }
      return jsonResponse({ code: 'InvalidAuthentication', message: 'bad secret' }, 400);
    });
    const result = await probeNotifyAppToken({
      appKey: 'k',
      appSecret: 's',
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('auth_failed');
  });
});

describe('sendWorkNotice', () => {
  const fetchImpl = vi.fn();

  beforeEach(() => {
    fetchImpl.mockReset();
    fetchImpl.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/gettoken')) {
        return jsonResponse({ access_token: 'tok', errcode: 0, expires_in: 7200 });
      }
      if (url.includes('/asyncsend_v2')) {
        return jsonResponse({ errcode: 0, errmsg: 'ok', task_id: 99_001 });
      }
      return jsonResponse({ errcode: 1, errmsg: 'unexpected' }, 400);
    });
  });

  it('sends action_card with single_url and records task_id', async () => {
    const result = await sendWorkNotice(
      {
        actionCard: {
          markdown: 'body',
          singleTitle: '打开',
          singleUrl: 'https://app.example.com/task/1',
          title: '提醒',
        },
        staffIds: ['staff_1'],
      },
      { fetchImpl },
    );

    expect(result).toEqual([{ taskId: '99001' }]);
    expect(recordDingtalkHttpCall).toHaveBeenCalledWith(
      'GET',
      expect.stringContaining(DINGTALK_OAPI_GETTOKEN_URL),
    );
    expect(recordDingtalkHttpCall).toHaveBeenCalledWith('POST', DINGTALK_ASYNCSEND_V2_URL);
    const call = fetchImpl.mock.calls.find((entry) => String(entry[0]).includes('/asyncsend_v2'));
    expect(String(call?.[0])).toContain(DINGTALK_ASYNCSEND_V2_URL);
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      agent_id: 4_617_854_001,
      msg: {
        action_card: {
          markdown: 'body',
          single_title: '打开',
          single_url: 'https://app.example.com/task/1',
          title: '提醒',
        },
        msgtype: 'action_card',
      },
      userid_list: 'staff_1',
    });
  });

  it('sends markdown when there is no action card', async () => {
    await sendWorkNotice(
      { markdown: { text: 'body', title: '提醒' }, staffIds: ['staff_1'] },
      { fetchImpl },
    );
    const call = fetchImpl.mock.calls.find((entry) => String(entry[0]).includes('/asyncsend_v2'));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      agent_id: 4_617_854_001,
      msg: { markdown: { text: 'body', title: '提醒' }, msgtype: 'markdown' },
      userid_list: 'staff_1',
    });
  });

  it('sends oa with head band, form, and optional message_url', async () => {
    const result = await sendWorkNotice(
      {
        oa: buildOaWorkNoticePayload({
          author: '张三',
          content: '交安全报告',
          form: [
            { key: '时间', value: '09:00' },
            { key: '来自', value: '张三' },
          ],
          headText: 'AI平台',
          title: '定时提醒',
        }),
        staffIds: ['staff_hyq'],
      },
      { fetchImpl },
    );

    expect(result).toEqual([{ taskId: '99001' }]);
    const call = fetchImpl.mock.calls.find((entry) => String(entry[0]).includes('/asyncsend_v2'));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      agent_id: 4_617_854_001,
      msg: {
        msgtype: 'oa',
        oa: {
          body: {
            author: '张三',
            content: '交安全报告',
            form: [
              { key: '时间', value: '09:00' },
              { key: '来自', value: '张三' },
            ],
            title: '定时提醒',
          },
          head: { bgcolor: DINGTALK_OA_HEAD_BGCOLOR, text: 'AI平台' },
        },
      },
      userid_list: 'staff_hyq',
    });
  });

  it('evicts a cached token and retries once on asyncsend 40014', async () => {
    let gettoken = 0;
    let asyncsend = 0;
    fetchImpl.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/gettoken')) {
        gettoken += 1;
        return jsonResponse({
          access_token: gettoken === 1 ? 'stale' : 'fresh',
          errcode: 0,
          expires_in: 7200,
        });
      }
      if (url.includes('/asyncsend_v2')) {
        asyncsend += 1;
        if (asyncsend === 1) {
          return jsonResponse({ errcode: 40014, errmsg: '不合法的access_token' });
        }
        return jsonResponse({ errcode: 0, task_id: 77 });
      }
      return jsonResponse({ errcode: 1, errmsg: 'unexpected' }, 400);
    });

    await expect(
      sendWorkNotice(
        { markdown: { text: 'body', title: '提醒' }, staffIds: ['staff_1'] },
        { fetchImpl },
      ),
    ).resolves.toEqual([{ taskId: '77' }]);
    expect(asyncsend).toBe(2);
    expect(gettoken).toBe(2);
    expect(mockRedisDel).toHaveBeenCalledWith(DINGTALK_NOTIFY_TOKEN_REDIS_KEY);
  });

  it('includes message_url on oa for task-owner deep links', async () => {
    await sendWorkNotice(
      {
        oa: buildOaWorkNoticePayload({
          content: '运行完成',
          form: [
            { key: '任务', value: '报表' },
            { key: '时间', value: '09:00' },
          ],
          headText: 'AI 助手',
          messageUrl: 'https://app.example.com/dingtalk/sso?redirect=%2Ftask%2F1',
          title: '任务已完成一次运行',
        }),
        staffIds: ['staff_1'],
      },
      { fetchImpl },
    );
    const call = fetchImpl.mock.calls.find((entry) => String(entry[0]).includes('/asyncsend_v2'));
    expect(JSON.parse(String(call?.[1]?.body)).msg).toEqual({
      msgtype: 'oa',
      oa: {
        body: {
          content: '运行完成',
          form: [
            { key: '任务', value: '报表' },
            { key: '时间', value: '09:00' },
          ],
          title: '任务已完成一次运行',
        },
        head: { bgcolor: DINGTALK_OA_HEAD_BGCOLOR, text: 'AI 助手' },
        message_url: 'https://app.example.com/dingtalk/sso?redirect=%2Ftask%2F1',
      },
    });
  });

  it(`chunks userid_list at ${DINGTALK_WORK_NOTICE_USERID_CHUNK}`, async () => {
    let task = 1;
    fetchImpl.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/gettoken')) {
        return jsonResponse({ access_token: 'tok', errcode: 0, expires_in: 7200 });
      }
      task += 1;
      return jsonResponse({ errcode: 0, task_id: task });
    });
    const staffIds = Array.from({ length: 101 }, (_, index) => `u${index}`);
    const result = await sendWorkNotice(
      { markdown: { text: 'x', title: 't' }, staffIds },
      { fetchImpl },
    );
    const sendCalls = fetchImpl.mock.calls.filter((entry) =>
      String(entry[0]).includes('/asyncsend_v2'),
    );
    expect(sendCalls).toHaveLength(2);
    expect(JSON.parse(String(sendCalls[0]?.[1]?.body)).userid_list.split(',')).toHaveLength(100);
    expect(JSON.parse(String(sendCalls[1]?.[1]?.body)).userid_list.split(',')).toHaveLength(1);
    expect(result).toHaveLength(2);
  });

  it('throws with errcode/errmsg when a chunk fails', async () => {
    fetchImpl.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/gettoken')) {
        return jsonResponse({ access_token: 'tok', errcode: 0, expires_in: 7200 });
      }
      return jsonResponse({ errcode: 88_001, errmsg: 'no permission' });
    });
    await expect(
      sendWorkNotice({ markdown: { text: 'x', title: 't' }, staffIds: ['a'] }, { fetchImpl }),
    ).rejects.toBeInstanceOf(DingTalkNotifyAppError);
    await expect(
      sendWorkNotice({ markdown: { text: 'x', title: 't' }, staffIds: ['a'] }, { fetchImpl }),
    ).rejects.toMatchObject({ errcode: 88_001, errmsg: 'no permission' });
  });
});

describe('sendRobotMessage', () => {
  const fetchImpl = vi.fn();

  beforeEach(() => {
    fetchImpl.mockReset();
    fetchImpl.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/oauth2/accessToken')) {
        return jsonResponse({ accessToken: 'new-tok', expireIn: 7200 });
      }
      if (url.includes('/oToMessages/batchSend')) {
        return jsonResponse({ processQueryKey: 'pqk-1' });
      }
      return jsonResponse({ code: 'unexpected' }, 400);
    });
  });

  it('sends sampleMarkdown with robotCode = notify AppKey', async () => {
    const result = await sendRobotMessage(
      {
        markdown: {
          text: '### AI平台 · 定时提醒\n\n交安全报告\n\n09:00 · 来自 张三',
          title: 'AI平台 · 定时提醒',
        },
        staffIds: ['staff_1'],
      },
      { fetchImpl },
    );

    expect(result).toEqual([{ processQueryKey: 'pqk-1' }]);
    expect(recordDingtalkHttpCall).toHaveBeenCalledWith('POST', DINGTALK_NEW_API_ACCESS_TOKEN_URL);
    expect(recordDingtalkHttpCall).toHaveBeenCalledWith('POST', DINGTALK_ROBOT_BATCH_SEND_URL);
    const tokenCall = fetchImpl.mock.calls.find((entry) =>
      String(entry[0]).includes('/oauth2/accessToken'),
    );
    expect(JSON.parse(String(tokenCall?.[1]?.body))).toEqual({
      appKey: NOTIFY_APP.appKey,
      appSecret: NOTIFY_APP.appSecret,
    });
    const sendCall = fetchImpl.mock.calls.find((entry) =>
      String(entry[0]).includes('/oToMessages/batchSend'),
    );
    expect(String(sendCall?.[0])).toBe(DINGTALK_ROBOT_BATCH_SEND_URL);
    expect(sendCall?.[1]?.headers).toMatchObject({
      'x-acs-dingtalk-access-token': 'new-tok',
    });
    expect(JSON.parse(String(sendCall?.[1]?.body))).toEqual({
      msgKey: 'sampleMarkdown',
      msgParam: JSON.stringify({
        text: '### AI平台 · 定时提醒\n\n交安全报告\n\n09:00 · 来自 张三',
        title: 'AI平台 · 定时提醒',
      }),
      robotCode: NOTIFY_APP.appKey,
      userIds: ['staff_1'],
    });
  });

  it('sends sampleActionCard (single button) when actionCard is given', async () => {
    await sendRobotMessage(
      {
        actionCard: {
          singleTitle: '在AI 助手中查看',
          singleUrl: 'https://app.example.com/dingtalk/sso?redirect=%2Ftask%2F1',
          text: '### AI 助手 · 运行完成\n\n报表完成\n\n09:00',
          title: 'AI 助手 · 运行完成',
        },
        staffIds: ['staff_1'],
      },
      { fetchImpl },
    );
    const sendCall = fetchImpl.mock.calls.find((entry) =>
      String(entry[0]).includes('/oToMessages/batchSend'),
    );
    const body = JSON.parse(String(sendCall?.[1]?.body)) as {
      msgKey: string;
      msgParam: string;
    };
    expect(body.msgKey).toBe('sampleActionCard');
    expect(JSON.parse(body.msgParam)).toEqual({
      title: 'AI 助手 · 运行完成',
      text: '### AI 助手 · 运行完成\n\n报表完成\n\n09:00',
      singleTitle: '在AI 助手中查看',
      singleURL: 'https://app.example.com/dingtalk/sso?redirect=%2Ftask%2F1',
    });
    expect(JSON.parse(body.msgParam)).not.toHaveProperty('actionTitle2');
  });

  it(`chunks userIds at ${DINGTALK_ROBOT_USERID_CHUNK}`, async () => {
    const staffIds = Array.from({ length: 21 }, (_, index) => `u${index}`);
    const result = await sendRobotMessage(
      { markdown: { text: 'x', title: 't' }, staffIds },
      { fetchImpl },
    );
    const sendCalls = fetchImpl.mock.calls.filter((entry) =>
      String(entry[0]).includes('/oToMessages/batchSend'),
    );
    expect(sendCalls).toHaveLength(2);
    expect(JSON.parse(String(sendCalls[0]?.[1]?.body)).userIds).toHaveLength(20);
    expect(JSON.parse(String(sendCalls[1]?.[1]?.body)).userIds).toHaveLength(1);
    expect(result).toHaveLength(2);
  });

  it('evicts the new-API token and retries once on InvalidAuthentication / 40014', async () => {
    let tokenCalls = 0;
    let sendCalls = 0;
    fetchImpl.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/oauth2/accessToken')) {
        tokenCalls += 1;
        return jsonResponse({
          accessToken: tokenCalls === 1 ? 'stale' : 'fresh',
          expireIn: 7200,
        });
      }
      if (url.includes('/oToMessages/batchSend')) {
        sendCalls += 1;
        if (sendCalls === 1) {
          return jsonResponse({ code: 'InvalidAuthentication', message: 'invalid token' }, 401);
        }
        return jsonResponse({ processQueryKey: 'pqk-retry' });
      }
      return jsonResponse({ code: 'unexpected' }, 400);
    });

    await expect(
      sendRobotMessage(
        { markdown: { text: 'body', title: 't' }, staffIds: ['staff_1'] },
        { fetchImpl },
      ),
    ).resolves.toEqual([{ processQueryKey: 'pqk-retry' }]);
    expect(sendCalls).toBe(2);
    expect(tokenCalls).toBe(2);
    expect(mockRedisDel).toHaveBeenCalledWith(DINGTALK_NOTIFY_NEW_TOKEN_REDIS_KEY);

    const retried = fetchImpl.mock.calls.filter((entry) =>
      String(entry[0]).includes('/oToMessages/batchSend'),
    );
    expect(retried[1]?.[1]?.headers).toMatchObject({
      'x-acs-dingtalk-access-token': 'fresh',
    });
  });

  it('evicts and retries once on oapi-style 40014 from batchSend', async () => {
    let sendCalls = 0;
    fetchImpl.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/oauth2/accessToken')) {
        return jsonResponse({ accessToken: 'tok', expireIn: 7200 });
      }
      sendCalls += 1;
      if (sendCalls === 1) {
        return jsonResponse({ errcode: 40014, errmsg: '不合法的access_token' }, 200);
      }
      return jsonResponse({ processQueryKey: 'pqk-2' });
    });

    await expect(
      sendRobotMessage({ markdown: { text: 'body', title: 't' }, staffIds: ['a'] }, { fetchImpl }),
    ).resolves.toEqual([{ processQueryKey: 'pqk-2' }]);
    expect(sendCalls).toBe(2);
  });
});

describe('directory fetch', () => {
  const fetchImpl = vi.fn();

  beforeEach(() => {
    fetchImpl.mockReset();
    fetchImpl.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (url.includes('/gettoken')) {
        return jsonResponse({ access_token: 'tok', errcode: 0, expires_in: 7200 });
      }
      if (url.startsWith(DINGTALK_DEPT_GET_URL)) {
        return jsonResponse({
          errcode: 0,
          result: { dept_id: 1, name: '捷发科技', order: 0, parent_id: 0 },
        });
      }
      if (url.startsWith(DINGTALK_DEPT_LISTSUB_URL)) {
        if (body.dept_id === 1) {
          return jsonResponse({
            errcode: 0,
            result: [{ dept_id: 2, name: '捷发', order: 1, parent_id: 1 }],
          });
        }
        if (body.dept_id === 2) {
          return jsonResponse({
            errcode: 0,
            result: [{ dept_id: 3, name: '安环部', order: 2, parent_id: 2 }],
          });
        }
        return jsonResponse({ errcode: 0, result: [] });
      }
      if (url.startsWith(DINGTALK_USER_LIST_URL)) {
        if (body.dept_id === 3 && body.cursor === 0) {
          return jsonResponse({
            errcode: 0,
            result: {
              has_more: true,
              list: [
                {
                  active: true,
                  avatar: 'https://img.example/a.png',
                  dept_id_list: [2, 3],
                  name: '胡玉琴A',
                  unionid: 'union-1',
                  userid: 'hyq',
                },
              ],
              next_cursor: 100,
            },
          });
        }
        if (body.dept_id === 3 && body.cursor === 100) {
          return jsonResponse({
            errcode: 0,
            result: {
              has_more: false,
              list: [{ active: false, dept_id_list: [3], name: '已离职', userid: 'left' }],
            },
          });
        }
        if (body.dept_id === 2) {
          return jsonResponse({
            errcode: 0,
            result: {
              has_more: false,
              list: [
                {
                  active: true,
                  dept_id_list: [2, 3],
                  name: '胡玉琴A',
                  unionid: 'union-1',
                  userid: 'hyq',
                },
              ],
            },
          });
        }
        return jsonResponse({ errcode: 0, result: { has_more: false, list: [] } });
      }
      return jsonResponse({ errcode: 1, errmsg: 'unexpected' }, 400);
    });
  });

  it('walks listsub from dept 1 and loads the root name via department/get', async () => {
    const depts = await listDepartments({ fetchImpl });
    expect(depts.map((dept) => dept.deptId)).toEqual(['1', '2', '3']);
    expect(depts[0]).toMatchObject({ name: '捷发科技', parentId: null });
    expect(depts[2]).toMatchObject({ name: '安环部', parentId: '2' });
    const getCalls = fetchImpl.mock.calls.filter((entry) =>
      String(entry[0]).startsWith(DINGTALK_DEPT_GET_URL),
    );
    expect(getCalls).toHaveLength(1);
    expect(JSON.parse(String(getCalls[0]?.[1]?.body))).toMatchObject({ dept_id: 1 });
  });

  it('pages listDeptUsers with size 100', async () => {
    const users = await listDeptUsers('3', { fetchImpl });
    expect(users.map((user) => user.staffId)).toEqual(['hyq', 'left']);
    expect(users[1]?.active).toBe(false);
    const userListCalls = fetchImpl.mock.calls.filter((entry) =>
      String(entry[0]).startsWith(DINGTALK_USER_LIST_URL),
    );
    expect(userListCalls).toHaveLength(2);
    expect(JSON.parse(String(userListCalls[0]?.[1]?.body))).toMatchObject({
      cursor: 0,
      size: 100,
    });
    expect(recordDingtalkHttpCall).toHaveBeenCalledWith('POST', DINGTALK_USER_LIST_URL);
  });

  it('treats numeric has_more as more pages and stops when next_cursor does not move', async () => {
    const paging = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (url.includes('/gettoken')) {
        return jsonResponse({ access_token: 'tok', errcode: 0, expires_in: 7200 });
      }
      if (url.startsWith(DINGTALK_USER_LIST_URL) && body.cursor === 0) {
        return jsonResponse({
          errcode: 0,
          result: {
            has_more: 1,
            list: [{ name: 'A', userid: 'a' }],
            next_cursor: 20,
          },
        });
      }
      if (url.startsWith(DINGTALK_USER_LIST_URL)) {
        return jsonResponse({
          errcode: 0,
          result: {
            has_more: 1,
            list: [{ name: 'B', userid: 'b' }],
            next_cursor: 20,
          },
        });
      }
      return jsonResponse({ errcode: 1, errmsg: 'unexpected' }, 400);
    });

    const users = await listDeptUsers('3', { fetchImpl: paging });
    expect(users.map((user) => user.staffId)).toEqual(['a', 'b']);
    const userListCalls = paging.mock.calls.filter((entry) =>
      String(entry[0]).startsWith(DINGTALK_USER_LIST_URL),
    );
    expect(userListCalls).toHaveLength(2);
  });

  it('maps replaceAll input: pinyin, path_names (root 1 skipped), leaf dept = longest path', async () => {
    const snapshot = await fetchDirectoryReplaceAllInput({
      fetchImpl,
      now: new Date('2026-09-16T04:00:00.000Z'),
    });
    const anHuan = snapshot.departments.find((dept) => dept.deptId === '3');
    expect(anHuan).toMatchObject({
      name: '安环部',
      pathNames: '捷发 / 安环部',
    });
    expect(anHuan?.namePinyinFull).toBeTruthy();
    expect(anHuan?.namePinyinInitials).toBeTruthy();
    expect(snapshot.departments.find((dept) => dept.deptId === '1')?.pathNames).toBe('');

    const hyq = snapshot.users.find((user) => user.staffId === 'hyq');
    expect(hyq).toMatchObject({
      active: true,
      avatar: 'https://img.example/a.png',
      deptPath: '捷发 / 安环部',
      leafDeptId: '3',
      leafDeptName: '安环部',
      name: '胡玉琴A',
      unionId: 'union-1',
    });
    expect(snapshot.memberships).toEqual(
      expect.arrayContaining([
        { deptId: '2', staffId: 'hyq' },
        { deptId: '3', staffId: 'hyq' },
        { deptId: '3', staffId: 'left' },
      ]),
    );

    const getCalls = fetchImpl.mock.calls.filter((entry) =>
      String(entry[0]).startsWith(DINGTALK_DEPT_GET_URL),
    );
    const listsubCalls = fetchImpl.mock.calls.filter((entry) =>
      String(entry[0]).startsWith(DINGTALK_DEPT_LISTSUB_URL),
    );
    const userListCalls = fetchImpl.mock.calls.filter((entry) =>
      String(entry[0]).startsWith(DINGTALK_USER_LIST_URL),
    );
    expect(getCalls).toHaveLength(1);
    expect(listsubCalls).toHaveLength(3);
    expect(userListCalls).toHaveLength(4);
  });
});

describe('buildDirectoryReplaceAllInput', () => {
  it('picks the membership with the longest path as the leaf department', () => {
    const input = buildDirectoryReplaceAllInput({
      departments: [
        { deptId: '1', name: 'Root', parentId: null, sortOrder: 0 },
        { deptId: '2', name: '捷发', parentId: '1', sortOrder: 1 },
        { deptId: '3', name: '安环部', parentId: '2', sortOrder: 2 },
      ],
      now: new Date('2026-09-16T00:00:00.000Z'),
      usersByDept: [
        {
          deptId: '3',
          users: [
            {
              active: true,
              avatar: null,
              deptIds: ['2', '3'],
              name: '胡玉琴A',
              staffId: 'hyq',
              unionId: null,
            },
          ],
        },
      ],
    });
    expect(input.users[0]).toMatchObject({
      deptPath: '捷发 / 安环部',
      leafDeptId: '3',
      leafDeptName: '安环部',
    });
  });
});

describe('buildNotifyRobotMarkdown', () => {
  it('uses ### <应用名> · <kind> then content and footer', () => {
    expect(
      buildNotifyRobotMarkdown({
        content: '交安全报告',
        footer: '09:00 · 来自 张三',
        headText: 'AI平台',
        kind: '定时提醒',
      }),
    ).toEqual({
      text: '### AI平台 · 定时提醒\n\n交安全报告\n\n09:00 · 来自 张三',
      title: 'AI平台 · 定时提醒',
    });
  });
});

describe('resolveWorkNoticeHeadText', () => {
  it('uses the published site title when it is set', async () => {
    vi.mocked(resolveServerRuntimeBranding).mockResolvedValueOnce({ name: 'AI平台' } as never);
    expect(await resolveWorkNoticeHeadText()).toBe('AI平台');
  });

  it(`falls back to ${DINGTALK_OA_HEAD_TEXT_FALLBACK} when the site title is empty`, async () => {
    vi.mocked(resolveServerRuntimeBranding).mockResolvedValueOnce({ name: '  ' } as never);
    expect(await resolveWorkNoticeHeadText()).toBe(DINGTALK_OA_HEAD_TEXT_FALLBACK);
  });

  it(`falls back to ${DINGTALK_OA_HEAD_TEXT_FALLBACK} when the name is the Latin AIHub brand`, async () => {
    vi.mocked(resolveServerRuntimeBranding).mockResolvedValueOnce({ name: 'AIHub' } as never);
    expect(await resolveWorkNoticeHeadText()).toBe(DINGTALK_OA_HEAD_TEXT_FALLBACK);
  });

  it(`falls back to ${DINGTALK_OA_HEAD_TEXT_FALLBACK} when branding resolution throws`, async () => {
    vi.mocked(resolveServerRuntimeBranding).mockRejectedValueOnce(new Error('offline'));
    expect(await resolveWorkNoticeHeadText()).toBe(DINGTALK_OA_HEAD_TEXT_FALLBACK);
  });
});
