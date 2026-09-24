// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendOtoMessage = vi.fn();

const cardDeps = vi.hoisted(() => ({
  requireVerifiedDingtalkIdentity: vi.fn(),
  sendDingTalkActionCardToThread: vi.fn(),
}));

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

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://chat.example.com' },
}));

vi.mock('@/envs/dingtalkPersonal', () => ({
  dingtalkPersonalEnv: {},
}));

vi.mock('@/config/messenger', () => ({
  getMessengerDingTalkConfig: vi.fn(),
}));

vi.mock('./cards', () => ({
  sendDingTalkActionCardToThread: cardDeps.sendDingTalkActionCardToThread,
}));

vi.mock('./tokenCache', () => ({
  sharedDingTalkApiClient: vi.fn(() => ({ sendOtoMessage })),
}));

vi.mock('@/server/enterprise/services/dingtalkWorkspace/identity', () => ({
  requireVerifiedDingtalkIdentity: cardDeps.requireVerifiedDingtalkIdentity,
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => (redisState.useClient ? redisState.client : null),
}));

const { getMessengerDingTalkConfig } = await import('@/config/messenger');
const { sharedDingTalkApiClient } = await import('./tokenCache');
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

const appAuthorizeUrl = `https://chat.example.com/dingtalk/sso?redirect=${encodeURIComponent('/settings/connector?dingtalkPersonal=authorize')}`;

const reauthorizeLink = (): string => `[重新授权](${appAuthorizeUrl})`;

const cardParam = () =>
  JSON.parse(sendOtoMessage.mock.calls[0][0].msgParam) as Record<string, string>;

beforeEach(() => {
  vi.clearAllMocks();
  redisState.failSet = false;
  redisState.useClient = true;
  redisState.store.clear();
  sendOtoMessage.mockResolvedValue({ processQueryKey: 'pqk-1' });
  cardDeps.sendDingTalkActionCardToThread.mockReset();
  cardDeps.sendDingTalkActionCardToThread.mockResolvedValue({ sent: false });
  cardDeps.requireVerifiedDingtalkIdentity.mockReset();
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

    expect(result).toEqual({ sent: true, via: 'oto' });
    expect(cardDeps.sendDingTalkActionCardToThread).not.toHaveBeenCalled();
    expect(cardDeps.requireVerifiedDingtalkIdentity).not.toHaveBeenCalled();
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
      'dingtalk-personal:authcard:job-auth-1:oto',
      '1',
      'EX',
      20 * 60,
      'NX',
    );
    expect(redisState.client?.incr).toHaveBeenCalledTimes(1);
  });

  it('sends the 1:1 card through the shared DingTalk client', async () => {
    await sendDingtalkPersonalAuthCard({
      db,
      login,
      staffId: 'staff_9',
      userId: 'user_1',
    });

    expect(sharedDingTalkApiClient).toHaveBeenCalledWith({
      appKey: 'app_key',
      appSecret: 'app_secret',
      robotCode: 'robot_1',
    });
    expect(sendOtoMessage).toHaveBeenCalledWith(
      expect.objectContaining({ robotCode: 'robot_1', userIds: ['staff_9'] }),
    );
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

    expect(first).toEqual({ sent: true, via: 'oto' });
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
    expect(failed).toEqual({ sent: true, via: 'oto' });
    expect(sendOtoMessage).toHaveBeenCalledTimes(1);

    sendOtoMessage.mockClear();
    redisState.useClient = false;
    const missing = await sendDingtalkPersonalAuthCard({
      db,
      login: { ...login, jobId: 'job-auth-2' },
      staffId: 'staff_9',
      userId: 'user_1',
    });
    expect(missing).toEqual({ sent: true, via: 'oto' });
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
    expect(redisState.client?.del).toHaveBeenCalledWith(
      'dingtalk-personal:authcard:job-auth-1:oto',
    );
    expect(redisState.store.has('dingtalk-personal:authcard:job-auth-1:oto')).toBe(false);
    expect(redisState.client?.incr).not.toHaveBeenCalled();

    sendOtoMessage.mockResolvedValueOnce({});
    const retry = await sendDingtalkPersonalAuthCard({
      db,
      login,
      staffId: 'staff_9',
      userId: 'user_1',
    });
    expect(retry).toEqual({ sent: true, via: 'oto' });
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

    expect(sendOtoMessage).not.toHaveBeenCalled();
    expect(redisState.client?.set).not.toHaveBeenCalled();
  });

  const sessionCard = () =>
    cardDeps.sendDingTalkActionCardToThread.mock.calls[0]?.[1] as {
      singleTitle: string;
      singleURL: string;
      text: string;
      title: string;
    };

  it('posts the card on a live DM session webhook and does not bill a 1:1 send', async () => {
    cardDeps.sendDingTalkActionCardToThread.mockResolvedValue({ sent: true, via: 'session' });
    const result = await sendDingtalkPersonalAuthCard({
      db,
      login,
      staffId: 'staff_9',
      threadId: 'dingtalk:cid_dm',
      userId: 'user_1',
    });

    expect(result).toEqual({ sent: true, via: 'session' });
    expect(cardDeps.requireVerifiedDingtalkIdentity).not.toHaveBeenCalled();
    expect(cardDeps.sendDingTalkActionCardToThread).toHaveBeenCalledTimes(1);
    expect(cardDeps.sendDingTalkActionCardToThread).toHaveBeenCalledWith(
      'dingtalk:cid_dm',
      expect.objectContaining({
        singleTitle: '去授权',
        singleURL: login.verificationUrl,
        title: '授权 AI 助手读取钉钉个人数据',
      }),
    );
    const text = sessionCard().text;
    expect(text).toContain('你的待办');
    expect(text).toContain('你所在群的聊天记录');
    expect(text).toContain('工作日志');
    expect(text).toContain('验证码：JCHB-KBXF');
    expect(text).not.toContain('本人点击');
    expect(sendOtoMessage).not.toHaveBeenCalled();
    expect(redisState.client?.incr).not.toHaveBeenCalled();
    expect(redisState.client?.set).toHaveBeenCalledWith(
      'dingtalk-personal:authcard:job-auth-1:dingtalk:cid_dm',
      '1',
      'EX',
      20 * 60,
      'NX',
    );
  });

  it('prefixes a live group card with the verified name', async () => {
    cardDeps.requireVerifiedDingtalkIdentity.mockResolvedValue({
      name: '张三',
      staffId: 'staff_9',
      unionId: 'union_1',
    });
    cardDeps.sendDingTalkActionCardToThread.mockResolvedValue({ sent: true, via: 'session' });
    const result = await sendDingtalkPersonalAuthCard({
      db,
      login,
      staffId: 'staff_9',
      threadId: 'dingtalk:cid_group:staff_9',
      userId: 'user_1',
    });

    expect(result).toEqual({ sent: true, via: 'session' });
    expect(cardDeps.requireVerifiedDingtalkIdentity).toHaveBeenCalledWith(db, 'user_1');
    const text = sessionCard().text;
    expect(text.startsWith('仅 张三 本人点击（别人点击不会生效）\n\n')).toBe(true);
    expect(text).toContain('你的待办');
    expect(sendOtoMessage).not.toHaveBeenCalled();
    expect(redisState.client?.incr).not.toHaveBeenCalled();
  });

  it('falls back to the 1:1 card when the session webhook is not live', async () => {
    cardDeps.sendDingTalkActionCardToThread.mockResolvedValue({ sent: false });
    const dm = await sendDingtalkPersonalAuthCard({
      db,
      login,
      staffId: 'staff_9',
      threadId: 'dingtalk:cid_dm',
      userId: 'user_1',
    });

    expect(dm).toEqual({ sent: true, via: 'oto' });
    expect(cardDeps.sendDingTalkActionCardToThread).toHaveBeenCalledWith(
      'dingtalk:cid_dm',
      expect.any(Object),
    );
    expect(sendOtoMessage).toHaveBeenCalledTimes(1);
    expect(cardParam().text).not.toContain('本人点击');
    expect(cardParam().title).toBe('授权 AI 助手读取钉钉个人数据');
    expect(cardParam().singleURL).toBe(login.verificationUrl);
    expect(redisState.client?.incr).toHaveBeenCalledTimes(1);

    sendOtoMessage.mockClear();
    redisState.client?.incr.mockClear();
    cardDeps.sendDingTalkActionCardToThread.mockClear();
    cardDeps.requireVerifiedDingtalkIdentity.mockResolvedValue({
      name: '李四',
      staffId: 'staff_9',
      unionId: 'union_1',
    });
    const group = await sendDingtalkPersonalAuthCard({
      db,
      login: { ...login, jobId: 'job-auth-group' },
      staffId: 'staff_9',
      threadId: 'dingtalk:cid_group:staff_9',
      userId: 'user_1',
    });
    expect(group).toEqual({ sent: true, via: 'oto' });
    expect(cardParam().text.startsWith('仅 李四 本人点击（别人点击不会生效）\n\n')).toBe(true);
    expect(redisState.client?.incr).toHaveBeenCalledTimes(1);
  });

  it('falls back to 1:1 when the session send throws', async () => {
    cardDeps.sendDingTalkActionCardToThread.mockRejectedValueOnce(new Error('webhook down'));
    const result = await sendDingtalkPersonalAuthCard({
      db,
      login,
      staffId: 'staff_9',
      threadId: 'dingtalk:cid_dm',
      userId: 'user_1',
    });
    expect(result).toEqual({ sent: true, via: 'oto' });
    expect(sendOtoMessage).toHaveBeenCalledTimes(1);
  });

  it('does not send a second session card for the same job', async () => {
    cardDeps.sendDingTalkActionCardToThread.mockResolvedValue({ sent: true, via: 'session' });
    const first = await sendDingtalkPersonalAuthCard({
      db,
      login,
      staffId: 'staff_9',
      threadId: 'dingtalk:cid_dm',
      userId: 'user_1',
    });
    const second = await sendDingtalkPersonalAuthCard({
      db,
      login,
      staffId: 'staff_9',
      threadId: 'dingtalk:cid_dm',
      userId: 'user_1',
    });

    expect(first).toEqual({ sent: true, via: 'session' });
    expect(second).toEqual({ sent: true });
    expect(cardDeps.sendDingTalkActionCardToThread).toHaveBeenCalledTimes(1);
    expect(sendOtoMessage).not.toHaveBeenCalled();
  });

  it('sends the group card without a name when the lookup fails', async () => {
    cardDeps.requireVerifiedDingtalkIdentity.mockRejectedValueOnce(
      new Error('DINGTALK_IDENTITY_UNBOUND'),
    );
    cardDeps.sendDingTalkActionCardToThread.mockResolvedValue({ sent: true, via: 'session' });
    const failed = await sendDingtalkPersonalAuthCard({
      db,
      login,
      staffId: 'staff_9',
      threadId: 'dingtalk:cid_group:staff_9',
      userId: 'user_1',
    });
    expect(failed).toEqual({ sent: true, via: 'session' });
    const failedText = sessionCard().text;
    expect(failedText.startsWith('仅本人点击（别人点击不会生效）\n\n')).toBe(true);
    expect(failedText).not.toContain('undefined');
    expect(failedText).not.toContain('DINGTALK_IDENTITY');
    expect(failedText).toContain('你的待办');

    cardDeps.sendDingTalkActionCardToThread.mockClear();
    cardDeps.requireVerifiedDingtalkIdentity.mockResolvedValueOnce({
      name: '   ',
      staffId: 'staff_9',
      unionId: 'union_1',
    });
    const blank = await sendDingtalkPersonalAuthCard({
      db,
      login: { ...login, jobId: 'job-auth-blank-name' },
      staffId: 'staff_9',
      threadId: 'dingtalk:cid_group:staff_9',
      userId: 'user_1',
    });
    expect(blank).toEqual({ sent: true, via: 'session' });
    expect(sessionCard().text.startsWith('仅本人点击（别人点击不会生效）\n\n')).toBe(true);
    expect(sendOtoMessage).not.toHaveBeenCalled();
  });

  it('prefixes a group thread whose conversation id contains a colon', async () => {
    cardDeps.sendDingTalkActionCardToThread.mockResolvedValue({ sent: true, via: 'session' });
    await sendDingtalkPersonalAuthCard({
      db,
      login,
      staffId: 'staff_9',
      threadId: 'dingtalk:cid:extra:staff_9',
      userId: 'user_1',
    });
    expect(cardDeps.requireVerifiedDingtalkIdentity).toHaveBeenCalledWith(db, 'user_1');
    expect(sessionCard().text.startsWith('仅本人点击（别人点击不会生效）\n\n')).toBe(true);
  });

  it('delivers the same job again in another conversation', async () => {
    cardDeps.sendDingTalkActionCardToThread.mockResolvedValue({ sent: true, via: 'session' });
    const dm = await sendDingtalkPersonalAuthCard({
      db,
      login,
      staffId: 'staff_9',
      threadId: 'dingtalk:cid_dm',
      userId: 'user_1',
    });
    const group = await sendDingtalkPersonalAuthCard({
      db,
      login,
      staffId: 'staff_9',
      threadId: 'dingtalk:cid_group:staff_9',
      userId: 'user_1',
    });

    expect(dm).toEqual({ sent: true, via: 'session' });
    expect(group).toEqual({ sent: true, via: 'session' });
    expect(cardDeps.sendDingTalkActionCardToThread).toHaveBeenCalledTimes(2);
    expect(redisState.store.has('dingtalk-personal:authcard:job-auth-1:dingtalk:cid_dm')).toBe(
      true,
    );
    expect(
      redisState.store.has('dingtalk-personal:authcard:job-auth-1:dingtalk:cid_group:staff_9'),
    ).toBe(true);
  });

  it('still delivers a group card after the same job was sent in the 1:1 fallback', async () => {
    const oto = await sendDingtalkPersonalAuthCard({
      db,
      login,
      staffId: 'staff_9',
      userId: 'user_1',
    });
    cardDeps.sendDingTalkActionCardToThread.mockResolvedValue({ sent: true, via: 'session' });
    const group = await sendDingtalkPersonalAuthCard({
      db,
      login,
      staffId: 'staff_9',
      threadId: 'dingtalk:cid_group:staff_9',
      userId: 'user_1',
    });

    expect(oto).toEqual({ sent: true, via: 'oto' });
    expect(group).toEqual({ sent: true, via: 'session' });
    expect(sendOtoMessage).toHaveBeenCalledTimes(1);
    expect(cardDeps.sendDingTalkActionCardToThread).toHaveBeenCalledTimes(1);
  });

  it('sends the app authorize link when the verification URL is not https on a DingTalk host', async () => {
    for (const [index, verificationUrl] of [
      'not a url',
      'javascript:alert(1)',
      'http://login.dingtalk.com/oauth2/device/verify.htm?user_code=JCHB-KBXF',
      'https://evil.example/verify',
    ].entries()) {
      sendOtoMessage.mockClear();
      const result = await sendDingtalkPersonalAuthCard({
        db,
        login: { ...login, jobId: `job-unsafe-${index}`, verificationUrl },
        staffId: 'staff_9',
        userId: 'user_1',
      });
      expect(result).toEqual({ sent: true, via: 'oto' });
      expect(cardParam().singleURL).toBe(appAuthorizeUrl);
      expect(cardParam().singleURL.startsWith('https://')).toBe(true);
      expect(cardParam().text).not.toContain(verificationUrl);
    }

    sendOtoMessage.mockClear();
    cardDeps.sendDingTalkActionCardToThread.mockResolvedValue({ sent: true, via: 'session' });
    const subdomain = 'https://accounts.dingtalk.com/oauth2/device/verify.htm?user_code=JCHB-KBXF';
    const kept = await sendDingtalkPersonalAuthCard({
      db,
      login: { ...login, jobId: 'job-subdomain', verificationUrl: subdomain },
      staffId: 'staff_9',
      threadId: 'dingtalk:cid_dm',
      userId: 'user_1',
    });
    expect(kept).toEqual({ sent: true, via: 'session' });
    expect(sessionCard().singleURL).toBe(subdomain);
  });

  it('still uses the session webhook when the robot code is missing', async () => {
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValue({
      ...CONFIG,
      robotCode: '',
    } as never);
    cardDeps.sendDingTalkActionCardToThread.mockResolvedValue({ sent: true, via: 'session' });
    const sent = await sendDingtalkPersonalAuthCard({
      db,
      login,
      staffId: 'staff_9',
      threadId: 'dingtalk:cid_dm',
      userId: 'user_1',
    });
    expect(sent).toEqual({ sent: true, via: 'session' });
    expect(sendOtoMessage).not.toHaveBeenCalled();

    cardDeps.sendDingTalkActionCardToThread.mockResolvedValueOnce({ sent: false });
    const missed = await sendDingtalkPersonalAuthCard({
      db,
      login: { ...login, jobId: 'job-auth-no-robot' },
      staffId: 'staff_9',
      threadId: 'dingtalk:cid_dm',
      userId: 'user_1',
    });
    expect(missed).toEqual({ sent: false });
    expect(sendOtoMessage).not.toHaveBeenCalled();
    expect(
      redisState.store.has('dingtalk-personal:authcard:job-auth-no-robot:dingtalk:cid_dm'),
    ).toBe(false);
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
    expect(textOf()).toBe(
      `你授权的是 李四 的账号，请用本人钉钉账号重新授权（${reauthorizeLink()}）`,
    );

    sendOtoMessage.mockClear();
    await notifyDingtalkPersonalLoginResult({
      db,
      errorCode: 'IDENTITY_MISMATCH',
      ok: false,
      staffId: 'staff_9',
      userId: 'user_1',
    });
    expect(textOf()).toBe(
      `你授权的不是本人钉钉账号，请用本人钉钉账号重新授权（${reauthorizeLink()}）`,
    );
  });

  it.each([
    [
      'ORG_CLI_DISABLED',
      '贵司钉钉管理员未开放该功能给 CLI（开发者后台 → [CLI 设置](https://open-dev.dingtalk.com/fe/old#/developerSettings)），请联系管理员',
    ],
    ['LOGIN_TIMEOUT', `授权超时了，请${reauthorizeLink()}`],
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
