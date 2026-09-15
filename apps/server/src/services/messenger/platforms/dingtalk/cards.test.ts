import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const replace = vi.fn();
const finalize = vi.fn();

vi.mock('@/config/messenger', () => ({
  getMessengerDingTalkConfig: vi.fn(),
}));

vi.mock('@lobechat/chat-adapter-dingtalk', () => {
  class DingTalkCardUnavailableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'DingTalkCardUnavailableError';
    }
  }
  return {
    buildActionCardParam: vi.fn().mockReturnValue({ msgKey: 'sampleActionCard2', msgParam: '{}' }),
    chunkMarkdown: (text: string) => [text],
    decodeDingTalkThreadId: (threadId: string) => ({
      conversationId: threadId.replace(/^dingtalk:/, ''),
    }),
    DingTalkAiCardStream: vi.fn().mockImplementation(() => ({ create, finalize, replace })),
    DingTalkApiClient: vi.fn().mockImplementation(() => ({
      sendBySessionWebhook: vi.fn(),
      sendGroupMessage: vi.fn(),
      sendOtoMessage: vi.fn(),
    })),
    DingTalkCardUnavailableError,
    getDingTalkSession: vi.fn(),
    isSessionWebhookLive: vi.fn().mockReturnValue(false),
    rememberDingTalkCard: vi.fn(),
  };
});

vi.mock('@/server/services/bot/platforms/dingtalk/sendAttachments', () => ({
  sendDingTalkAttachments: vi.fn(),
}));

const { getMessengerDingTalkConfig } = await import('@/config/messenger');
const { DingTalkCardUnavailableError } = await import('@lobechat/chat-adapter-dingtalk');
const {
  createDingTalkReplySink,
  paginateEntries,
  parseDingTalkAskerCommand,
  wrapDingTalkAskerCommand,
} = await import('./cards');

const CONFIG = {
  aiCardTemplateId: 'ai-tpl',
  chatEnabled: true,
  clientId: 'app',
  clientSecret: 'secret',
  idleNewTopicEnabled: true,
  idleNewTopicHours: 24,
  pushEnabled: true,
  robotCode: 'robot',
  selectCardTemplateId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMessengerDingTalkConfig).mockResolvedValue(CONFIG as any);
  create.mockResolvedValue(undefined);
  replace.mockResolvedValue(undefined);
  finalize.mockResolvedValue(undefined);
});

describe('DingTalk AI-card reply sink', () => {
  it('falls back to text when card create fails', async () => {
    create.mockRejectedValueOnce(new DingTalkCardUnavailableError('card down'));
    const sink = await createDingTalkReplySink('dingtalk:cid');
    await sink?.onStart?.();
    await sink?.onComplete?.('final markdown');
    expect(finalize).not.toHaveBeenCalled();
  });

  it('finalizes the card with error text so it is never left open', async () => {
    const sink = await createDingTalkReplySink('dingtalk:cid');
    await sink?.onStart?.();
    await sink?.onPartial?.('thinking');
    await sink?.onError?.('执行失败');
    expect(create).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('thinking');
    expect(finalize).toHaveBeenCalledWith('执行失败');
  });
});

describe('asker-prefixed commands', () => {
  it('wraps group commands with the asker staff id', () => {
    expect(wrapDingTalkAskerCommand('messenger:switch:agt_1', 'staff_a', true)).toBe(
      'messenger:asker:staff_a:switch:agt_1',
    );
    expect(parseDingTalkAskerCommand('messenger:asker:staff_a:switch:agt_1')).toEqual({
      askerStaffId: 'staff_a',
      command: 'messenger:switch:agt_1',
    });
  });
});

describe('paginateEntries', () => {
  it('pages lists larger than 5', () => {
    const entries = [1, 2, 3, 4, 5, 6, 7];
    expect(paginateEntries(entries, 1).items).toEqual([1, 2, 3, 4, 5]);
    expect(paginateEntries(entries, 2)).toEqual({
      current: 2,
      items: [6, 7],
      totalPages: 2,
    });
  });
});
