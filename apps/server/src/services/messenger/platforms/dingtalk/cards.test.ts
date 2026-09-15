import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const replace = vi.fn();
const finalize = vi.fn();
const sendOtoMessage = vi.fn();
const sendGroupMessage = vi.fn();
const sendBySessionWebhook = vi.fn();
const mockBuildActionCardParam = vi.fn().mockReturnValue({
  msgKey: 'sampleActionCard4',
  msgParam: '{}',
});
const mockResolveDingTalkBrandingDisplayName = vi.fn();

vi.mock('@/config/messenger', () => ({
  getMessengerDingTalkConfig: vi.fn(),
}));

vi.mock('./branding', () => ({
  resolveDingTalkBrandingDisplayName: (...args: unknown[]) =>
    mockResolveDingTalkBrandingDisplayName(...args),
}));

vi.mock('@lobechat/chat-adapter-dingtalk', () => {
  class DingTalkCardUnavailableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'DingTalkCardUnavailableError';
    }
  }
  return {
    buildActionCardParam: (...args: unknown[]) => mockBuildActionCardParam(...args),
    chunkMarkdown: (text: string) => [text],
    decodeDingTalkThreadId: (threadId: string) => {
      const rest = threadId.startsWith('dingtalk:') ? threadId.slice('dingtalk:'.length) : threadId;
      const sep = rest.lastIndexOf(':');
      if (sep > 0) {
        return {
          conversationId: rest.slice(0, sep),
          senderStaffId: rest.slice(sep + 1),
        };
      }
      return { conversationId: rest };
    },
    DingTalkAiCardStream: vi.fn().mockImplementation(() => ({ create, finalize, replace })),
    DingTalkApiClient: vi.fn().mockImplementation(() => ({
      sendBySessionWebhook,
      sendGroupMessage,
      sendOtoMessage,
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
const { sendDingTalkAttachments } =
  await import('@/server/services/bot/platforms/dingtalk/sendAttachments');
const {
  createDingTalkReplySink,
  paginateEntries,
  parseDingTalkAskerCommand,
  sendDingTalkHelpReply,
  sendDingTalkUnknownCommandReply,
  sendDingTalkWelcomeCard,
  wrapDingTalkAskerCommand,
} = await import('./cards');
const {
  DINGTALK_COMMAND_CARD_TEXT,
  DINGTALK_COMMAND_CARD_TITLE,
  DINGTALK_COMMAND_SHORTCUT_BUTTONS,
  DINGTALK_HELP_TEXT,
  DINGTALK_UNKNOWN_COMMAND_REPLY,
  DINGTALK_WELCOME_TEXT,
} = await import('./const');

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
  sendOtoMessage.mockResolvedValue({});
  sendGroupMessage.mockResolvedValue({});
  mockBuildActionCardParam.mockReturnValue({ msgKey: 'sampleActionCard4', msgParam: '{}' });
  mockResolveDingTalkBrandingDisplayName.mockResolvedValue('AI平台');
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

  it('filters outbound attachments through mapOutboundAttachments', async () => {
    const sink = await createDingTalkReplySink('dingtalk:cid');
    await sink?.onStart?.();
    await sink?.onComplete?.('done', {
      attachments: [
        { name: 'a.png', type: 'image' },
        { name: 'c.mp3', type: 'audio' },
      ],
    });
    expect(sendDingTalkAttachments).toHaveBeenCalledWith(expect.anything(), expect.anything(), [
      { name: 'a.png', type: 'image' },
    ]);
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

describe('DingTalk onboarding cards', () => {
  it('sends a welcome ActionCard with branding title and shortcut buttons', async () => {
    await sendDingTalkWelcomeCard('dingtalk:cid');
    expect(mockBuildActionCardParam).toHaveBeenCalledWith({
      buttons: DINGTALK_COMMAND_SHORTCUT_BUTTONS,
      text: DINGTALK_WELCOME_TEXT,
      title: '已连接 AI平台',
    });
    expect(sendOtoMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        msgKey: 'sampleActionCard4',
        robotCode: 'robot',
        userIds: ['cid'],
      }),
    );
    expect(sendGroupMessage).not.toHaveBeenCalled();
  });

  it('sends the welcome card via the group API and @-mentions the asker', async () => {
    await sendDingTalkWelcomeCard('dingtalk:cid:staff_9');
    expect(mockBuildActionCardParam).toHaveBeenCalledWith(
      expect.objectContaining({
        text: `@staff_9 ${DINGTALK_WELCOME_TEXT}`,
        title: '已连接 AI平台',
      }),
    );
    expect(sendGroupMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        msgKey: 'sampleActionCard4',
        openConversationId: 'cid',
        robotCode: 'robot',
      }),
    );
    expect(sendOtoMessage).not.toHaveBeenCalled();
  });

  it('sends tidy help markdown then the same shortcut card', async () => {
    await sendDingTalkHelpReply('dingtalk:cid');
    expect(sendOtoMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        msgKey: 'sampleMarkdown',
        msgParam: JSON.stringify({ text: DINGTALK_HELP_TEXT, title: '常用指令' }),
      }),
    );
    expect(mockBuildActionCardParam).toHaveBeenCalledWith({
      buttons: DINGTALK_COMMAND_SHORTCUT_BUTTONS,
      text: DINGTALK_COMMAND_CARD_TEXT,
      title: DINGTALK_COMMAND_CARD_TITLE,
    });
    expect(DINGTALK_HELP_TEXT).toContain('## 常用指令');
    expect(DINGTALK_HELP_TEXT).toContain('/助手 — 列出并切换助手');
    expect(DINGTALK_HELP_TEXT).toContain('群聊中需 @机器人');
    expect(DINGTALK_HELP_TEXT).not.toMatch(/[!！]/);
  });

  it('sends 未知命令 then the shortcut card, via the group API when in a group', async () => {
    await sendDingTalkUnknownCommandReply('dingtalk:cid:staff_9');
    expect(sendGroupMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        msgKey: 'sampleMarkdown',
        openConversationId: 'cid',
        robotCode: 'robot',
      }),
    );
    expect(JSON.parse(sendGroupMessage.mock.calls[0][0].msgParam)).toEqual({
      at: { atUserIds: ['staff_9'] },
      text: `@staff_9 ${DINGTALK_UNKNOWN_COMMAND_REPLY}`,
      title: DINGTALK_UNKNOWN_COMMAND_REPLY,
    });
    expect(mockBuildActionCardParam).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: DINGTALK_COMMAND_SHORTCUT_BUTTONS,
        text: `@staff_9 ${DINGTALK_COMMAND_CARD_TEXT}`,
      }),
    );
    expect(sendGroupMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ msgKey: 'sampleActionCard4', openConversationId: 'cid' }),
    );
  });
});
