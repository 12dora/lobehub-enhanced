// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendOtoMessage = vi.fn();
const sendGroupMessage = vi.fn();
const sendBySessionWebhook = vi.fn();
const mockTopicFindById = vi.fn();
const mockMessageFindById = vi.fn();
const mockResolveDingTalkStaffId = vi.fn();
const mockIsDingTalkThreadBusy = vi.fn();

vi.mock('@/config/messenger', () => ({
  getMessengerDingTalkConfig: vi.fn(),
}));

vi.mock('@lobechat/chat-adapter-dingtalk', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    DingTalkApiClient: vi.fn().mockImplementation(() => ({
      sendBySessionWebhook,
      sendGroupMessage,
      sendOtoMessage,
    })),
    getDingTalkSession: vi.fn().mockReturnValue(undefined),
    isSessionWebhookLive: vi.fn().mockReturnValue(false),
  };
});

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    findById: mockTopicFindById,
  })),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    findById: mockMessageFindById,
  })),
}));

vi.mock('./resolveStaffId', () => ({
  resolveDingTalkStaffId: (...args: unknown[]) => mockResolveDingTalkStaffId(...args),
}));

vi.mock('./queue', () => ({
  isDingTalkThreadBusy: (...args: unknown[]) => mockIsDingTalkThreadBusy(...args),
}));

vi.mock('@/server/services/agentRuntime/CompletionLifecycle', () => ({
  extractTextFromMessage: (message: { content?: unknown } | undefined) =>
    typeof message?.content === 'string' ? message.content : undefined,
}));

const { getMessengerDingTalkConfig } = await import('@/config/messenger');
const { mirrorWebTurnToDingTalk } = await import('./mirrorWebTurn');

const CONFIG = {
  chatEnabled: true,
  clientId: 'app',
  clientSecret: 'secret',
  robotCode: 'robot',
};

const DM_TOPIC = {
  metadata: {
    bot: {
      platform: 'dingtalk',
      platformThreadId: 'dingtalk:cid',
      senderExternalUserId: 'staff_from_meta',
    },
    messenger: { conversationType: 'dm', platform: 'dingtalk' },
  },
};

const db = {} as any;

const parseOtoText = (call: unknown): string => {
  const params = (call as [{ msgParam: string }])[0];
  return (JSON.parse(params.msgParam) as { text: string }).text;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMessengerDingTalkConfig).mockResolvedValue(CONFIG as any);
  mockTopicFindById.mockResolvedValue(DM_TOPIC);
  mockMessageFindById.mockResolvedValue(undefined);
  mockResolveDingTalkStaffId.mockResolvedValue('staff_resolved');
  mockIsDingTalkThreadBusy.mockResolvedValue(false);
  sendOtoMessage.mockResolvedValue({ processQueryKey: 'pqk-1' });
  sendGroupMessage.mockResolvedValue({ processQueryKey: 'pqk-g1' });
});

describe('mirrorWebTurnToDingTalk', () => {
  it('sends one oTo markdown with quoted user + assistant for a DingTalk DM topic', async () => {
    await mirrorWebTurnToDingTalk({
      assistantMessage: '助手回复正文',
      db,
      topicId: 'tpc-1',
      userId: 'user-1',
      userMessage: '网页上的问题',
    });

    expect(sendOtoMessage).toHaveBeenCalledTimes(1);
    expect(sendOtoMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        msgKey: 'sampleMarkdown',
        robotCode: 'robot',
        userIds: ['staff_from_meta'],
      }),
    );
    const text = parseOtoText(sendOtoMessage.mock.calls[0]);
    expect(text).toContain('**网页续聊**');
    expect(text).toContain('> 网页上的问题');
    expect(text).toContain('助手回复正文');
    expect(sendGroupMessage).not.toHaveBeenCalled();
    expect(mockResolveDingTalkStaffId).not.toHaveBeenCalled();
  });

  it('does not send when botContext.platform is dingtalk (inbound loop)', async () => {
    await mirrorWebTurnToDingTalk({
      assistantMessage: 'answer',
      botContext: { platform: 'dingtalk' } as any,
      db,
      topicId: 'tpc-1',
      userId: 'user-1',
      userMessage: 'hello',
    });

    expect(sendOtoMessage).not.toHaveBeenCalled();
    expect(mockTopicFindById).not.toHaveBeenCalled();
  });

  it('does not send when userMessageTrigger is bot', async () => {
    await mirrorWebTurnToDingTalk({
      assistantMessage: 'answer',
      db,
      topicId: 'tpc-1',
      userId: 'user-1',
      userMessage: 'hello',
      userMessageTrigger: 'bot',
    });

    expect(sendOtoMessage).not.toHaveBeenCalled();
  });

  it('does not send when the topic has no bot/messenger DingTalk metadata', async () => {
    mockTopicFindById.mockResolvedValueOnce({ metadata: { approvalMode: 'manual' } });

    await mirrorWebTurnToDingTalk({
      assistantMessage: 'answer',
      db,
      topicId: 'tpc-1',
      userId: 'user-1',
      userMessage: 'hello',
    });

    expect(sendOtoMessage).not.toHaveBeenCalled();
  });

  it('does not send group topics (conversationType or encoded senderStaffId)', async () => {
    mockTopicFindById.mockResolvedValueOnce({
      metadata: {
        bot: {
          platform: 'dingtalk',
          platformThreadId: 'dingtalk:cid:staff_a',
          senderExternalUserId: 'staff_a',
        },
        messenger: { conversationType: 'group', platform: 'dingtalk' },
      },
    });

    await mirrorWebTurnToDingTalk({
      assistantMessage: 'answer',
      db,
      topicId: 'tpc-1',
      userId: 'user-1',
      userMessage: 'hello',
    });

    expect(sendOtoMessage).not.toHaveBeenCalled();
    expect(sendGroupMessage).not.toHaveBeenCalled();
  });

  it('does not send when the DingTalk thread is busy', async () => {
    mockIsDingTalkThreadBusy.mockResolvedValueOnce(true);

    await mirrorWebTurnToDingTalk({
      assistantMessage: 'answer',
      db,
      topicId: 'tpc-1',
      userId: 'user-1',
      userMessage: 'hello',
    });

    expect(sendOtoMessage).not.toHaveBeenCalled();
  });

  it('does not send or throw when staffId cannot be resolved', async () => {
    mockTopicFindById.mockResolvedValueOnce({
      metadata: {
        bot: { platform: 'dingtalk', platformThreadId: 'dingtalk:cid' },
        messenger: { conversationType: 'dm', platform: 'dingtalk' },
      },
    });
    mockResolveDingTalkStaffId.mockResolvedValueOnce(null);

    await expect(
      mirrorWebTurnToDingTalk({
        assistantMessage: 'answer',
        db,
        topicId: 'tpc-1',
        userId: 'user-1',
        userMessage: 'hello',
      }),
    ).resolves.toBeUndefined();

    expect(sendOtoMessage).not.toHaveBeenCalled();
  });

  it('does not send when the connector is missing', async () => {
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValueOnce(null);

    await mirrorWebTurnToDingTalk({
      assistantMessage: 'answer',
      db,
      topicId: 'tpc-1',
      userId: 'user-1',
      userMessage: 'hello',
    });

    expect(sendOtoMessage).not.toHaveBeenCalled();
  });

  it('does not send when both user and assistant texts are empty', async () => {
    await mirrorWebTurnToDingTalk({
      assistantMessage: '   ',
      db,
      topicId: 'tpc-1',
      userId: 'user-1',
      userMessage: '',
    });

    expect(sendOtoMessage).not.toHaveBeenCalled();
  });

  it('chunks a long body into multiple oTo messages', async () => {
    const assistant = `${'x'.repeat(10_000)}\n\n${'y'.repeat(10_000)}\n\n${'z'.repeat(10_000)}`;

    await mirrorWebTurnToDingTalk({
      assistantMessage: assistant,
      db,
      topicId: 'tpc-1',
      userId: 'user-1',
      userMessage: 'q',
    });

    expect(sendOtoMessage.mock.calls.length).toBeGreaterThan(1);
    const combined = sendOtoMessage.mock.calls.map((call) => parseOtoText(call)).join('\n\n');
    expect(combined).toContain('**网页续聊**');
    expect(combined).toContain('x'.repeat(100));
    expect(combined).toContain('z'.repeat(100));
  });

  it('reads final texts from the messages table when ids are given', async () => {
    mockMessageFindById.mockImplementation(async (id: string) => {
      if (id === 'msg-user') return { content: 'db user', id: 'msg-user' };
      if (id === 'msg-asst') return { content: 'db assistant', id: 'msg-asst' };
      return undefined;
    });

    await mirrorWebTurnToDingTalk({
      assistantMessage: 'caller assistant (ignored)',
      assistantMessageId: 'msg-asst',
      db,
      topicId: 'tpc-1',
      userId: 'user-1',
      userMessage: 'caller user (ignored)',
      userMessageId: 'msg-user',
    });

    expect(sendOtoMessage).toHaveBeenCalledTimes(1);
    const text = parseOtoText(sendOtoMessage.mock.calls[0]);
    expect(text).toContain('> db user');
    expect(text).toContain('db assistant');
    expect(text).not.toContain('caller user');
    expect(text).not.toContain('caller assistant');
  });
});
