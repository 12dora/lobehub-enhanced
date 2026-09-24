// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendOtoMessage = vi.fn();

const redisState = vi.hoisted(() => {
  const store = new Map<string, string>();
  const state = {
    client: null as null | {
      del: ReturnType<typeof vi.fn>;
      expire: ReturnType<typeof vi.fn>;
      incr: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
    },
    failSet: false,
    store,
    useClient: true,
  };
  state.client = {
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    expire: vi.fn(async () => 1),
    incr: vi.fn(async () => 1),
    set: vi.fn(async (key: string, value: string, ...extra: unknown[]) => {
      if (state.failSet) throw new Error('redis down');
      if (extra.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
  };
  return state;
});

vi.mock('@/config/messenger', () => ({
  getMessengerDingTalkConfig: vi.fn(),
}));

vi.mock('@lobechat/chat-adapter-dingtalk', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    DingTalkApiClient: vi.fn().mockImplementation(() => ({ sendOtoMessage })),
  };
});

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => (redisState.useClient ? redisState.client : null),
}));

const { DingTalkApiClient } = await import('@lobechat/chat-adapter-dingtalk');
const { getMessengerDingTalkConfig } = await import('@/config/messenger');
const { notifyDingtalkPersonalLoginResult, sendDingtalkPersonalAuthCard } =
  await import('./personalAuthCard');

const CONFIG = {
  clientId: 'app_key',
  clientSecret: 'app_secret',
  notifyApp: { agentId: '9', appKey: 'notify-key', appSecret: 'notify-secret' },
  pushEnabled: false,
  robotCode: 'robot_1',
};

const login = {
  expiresAt: '2026-09-24T07:30:00.000Z',
  jobId: 'job-auth-1',
  userCode: 'JCHB-KBXF',
  verificationUrl: 'https://login.dingtalk.com/oauth2/device/verify.htm?user_code=JCHB-KBXF',
};

const db = {} as never;

const cardParam = () =>
  JSON.parse(sendOtoMessage.mock.calls[0][0].msgParam) as Record<string, string>;

beforeEach(() => {
  vi.clearAllMocks();
  redisState.failSet = false;
  redisState.useClient = true;
  redisState.store.clear();
  sendOtoMessage.mockResolvedValue({ processQueryKey: 'pqk-1' });
  vi.mocked(getMessengerDingTalkConfig).mockResolvedValue(CONFIG as never);
});

describe('sendDingtalkPersonalAuthCard', () => {
  it('sends a 1:1 action card without the push or notify-app gates', async () => {
    const result = await sendDingtalkPersonalAuthCard({
      db,
      login,
      staffId: 'staff_9',
      userId: 'user_1',
    });

    expect(result).toEqual({ sent: true });
    expect(DingTalkApiClient).toHaveBeenCalledWith('app_key', 'app_secret');
    expect(sendOtoMessage).toHaveBeenCalledTimes(1);
    expect(sendOtoMessage).toHaveBeenCalledWith({
      msgKey: 'sampleActionCard',
      msgParam: expect.any(String),
      robotCode: 'robot_1',
      userIds: ['staff_9'],
    });
    const param = cardParam();
    expect(param.title).toBe('授权 AI 助手读取钉钉个人数据');
    expect(param.singleTitle).toBe('去授权');
    expect(param.singleURL).toBe(login.verificationUrl);
    expect(param.text).toContain('你的待办');
    expect(param.text).toContain('你所在群的聊天记录');
    expect(param.text).toContain('工作日志');
    expect(param.text).toContain('验证码：JCHB-KBXF');
    expect(param.text).toContain('有效期：到 15:30');
    expect(param.text).toContain('点下方「去授权」→ 选择公司 → 同意');
    expect(param.text).toContain('确认卡片');
    expect(redisState.client?.set).toHaveBeenCalledWith(
      'dingtalk-personal:authcard:job-auth-1',
      '1',
      'EX',
      20 * 60,
      'NX',
    );
    expect(redisState.client?.incr).toHaveBeenCalledTimes(1);
  });

  it('does not send a second card for the same job', async () => {
    const first = await sendDingtalkPersonalAuthCard({
      db,
      login,
      staffId: 'staff_9',
      userId: 'user_1',
    });
    const second = await sendDingtalkPersonalAuthCard({
      db,
      login,
      staffId: 'staff_9',
      userId: 'user_1',
    });

    expect(first).toEqual({ sent: true });
    expect(second).toEqual({ sent: true });
    expect(sendOtoMessage).toHaveBeenCalledTimes(1);
    expect(redisState.client?.incr).toHaveBeenCalledTimes(1);
  });

  it('sends when Redis is down or missing', async () => {
    redisState.failSet = true;
    const failed = await sendDingtalkPersonalAuthCard({
      db,
      login,
      staffId: 'staff_9',
      userId: 'user_1',
    });
    expect(failed).toEqual({ sent: true });
    expect(sendOtoMessage).toHaveBeenCalledTimes(1);

    sendOtoMessage.mockClear();
    redisState.useClient = false;
    const missing = await sendDingtalkPersonalAuthCard({
      db,
      login: { ...login, jobId: 'job-auth-2' },
      staffId: 'staff_9',
      userId: 'user_1',
    });
    expect(missing).toEqual({ sent: true });
    expect(sendOtoMessage).toHaveBeenCalledTimes(1);
  });

  it('returns sent:false and releases the dedupe key when the robot send throws', async () => {
    sendOtoMessage.mockRejectedValueOnce(new Error('dingtalk 500'));
    const result = await sendDingtalkPersonalAuthCard({
      db,
      login,
      staffId: 'staff_9',
      userId: 'user_1',
    });

    expect(result).toEqual({ sent: false });
    expect(redisState.client?.del).toHaveBeenCalledWith('dingtalk-personal:authcard:job-auth-1');
    expect(redisState.store.has('dingtalk-personal:authcard:job-auth-1')).toBe(false);
    expect(redisState.client?.incr).not.toHaveBeenCalled();

    sendOtoMessage.mockResolvedValueOnce({});
    const retry = await sendDingtalkPersonalAuthCard({
      db,
      login,
      staffId: 'staff_9',
      userId: 'user_1',
    });
    expect(retry).toEqual({ sent: true });
    expect(sendOtoMessage).toHaveBeenCalledTimes(2);
  });

  it('does not throw when the connector, staff id, or url is unusable', async () => {
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValueOnce(null);
    await expect(
      sendDingtalkPersonalAuthCard({ db, login, staffId: 'staff_9', userId: 'user_1' }),
    ).resolves.toEqual({ sent: false });

    vi.mocked(getMessengerDingTalkConfig).mockResolvedValueOnce({
      ...CONFIG,
      robotCode: '',
    } as never);
    await expect(
      sendDingtalkPersonalAuthCard({ db, login, staffId: 'staff_9', userId: 'user_1' }),
    ).resolves.toEqual({ sent: false });

    await expect(
      sendDingtalkPersonalAuthCard({ db, login, staffId: '  ', userId: 'user_1' }),
    ).resolves.toEqual({ sent: false });

    await expect(
      sendDingtalkPersonalAuthCard({
        db,
        login: { ...login, verificationUrl: 'not a url' },
        staffId: 'staff_9',
        userId: 'user_1',
      }),
    ).resolves.toEqual({ sent: false });

    expect(sendOtoMessage).not.toHaveBeenCalled();
    expect(redisState.client?.set).not.toHaveBeenCalled();
  });
});

describe('notifyDingtalkPersonalLoginResult', () => {
  const textOf = () => cardParam().text;

  it('sends a success markdown in the 1:1 chat', async () => {
    const result = await notifyDingtalkPersonalLoginResult({
      db,
      ok: true,
      staffId: 'staff_9',
      userId: 'user_1',
      userName: '张三',
    });

    expect(result).toEqual({ sent: true });
    expect(sendOtoMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        msgKey: 'sampleMarkdown',
        robotCode: 'robot_1',
        userIds: ['staff_9'],
      }),
    );
    expect(cardParam().title).toBe('钉钉个人数据授权成功');
    expect(textOf()).toBe('钉钉个人数据授权成功，可以继续提问了');
    expect(redisState.client?.incr).toHaveBeenCalledTimes(1);
    expect(redisState.client?.set).not.toHaveBeenCalled();
  });

  it('names the mismatched account', async () => {
    const named = await notifyDingtalkPersonalLoginResult({
      db,
      errorCode: 'IDENTITY_MISMATCH',
      ok: false,
      staffId: 'staff_9',
      userId: 'user_1',
      userName: '李四',
    });
    expect(named).toEqual({ sent: true });
    expect(textOf()).toBe('你授权的是 李四 的账号，请用本人钉钉账号授权');

    sendOtoMessage.mockClear();
    await notifyDingtalkPersonalLoginResult({
      db,
      errorCode: 'IDENTITY_MISMATCH',
      ok: false,
      staffId: 'staff_9',
      userId: 'user_1',
    });
    expect(textOf()).toBe('你授权的不是本人钉钉账号，请用本人钉钉账号授权');
  });

  it.each([
    ['ORG_CLI_DISABLED', '贵司钉钉管理员未开放该功能给 CLI（开发者后台 → CLI 设置），请联系管理员'],
    ['LOGIN_TIMEOUT', '授权超时了，请重新发起授权'],
    ['LOGIN_FAILED', '钉钉个人数据授权失败，请稍后重试'],
    ['LOGIN_NOT_FOUND', '钉钉个人数据授权未完成，请稍后重试'],
  ] as const)('explains %s', async (errorCode, text) => {
    const result = await notifyDingtalkPersonalLoginResult({
      db,
      errorCode,
      ok: false,
      staffId: 'staff_9',
      userId: 'user_1',
    });
    expect(result).toEqual({ sent: true });
    expect(cardParam().title).toBe('钉钉个人数据授权未完成');
    expect(textOf()).toBe(text);
  });

  it('returns sent:false and does not throw when the send fails', async () => {
    sendOtoMessage.mockRejectedValueOnce(new Error('dingtalk 500'));
    await expect(
      notifyDingtalkPersonalLoginResult({
        db,
        ok: false,
        staffId: 'staff_9',
        userId: 'user_1',
      }),
    ).resolves.toEqual({ sent: false });
    expect(redisState.client?.incr).not.toHaveBeenCalled();

    vi.mocked(getMessengerDingTalkConfig).mockResolvedValueOnce(null);
    await expect(
      notifyDingtalkPersonalLoginResult({ db, ok: true, staffId: 'staff_9', userId: 'user_1' }),
    ).resolves.toEqual({ sent: false });
  });
});
