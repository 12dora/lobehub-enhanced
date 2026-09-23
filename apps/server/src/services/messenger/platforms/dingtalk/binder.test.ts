// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendOtoMessage = vi.fn();
const sendBySessionWebhook = vi.fn();
const createClient = vi.fn();

vi.mock('@/config/messenger', () => ({
  getMessengerDingTalkConfig: vi.fn(),
}));

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.example.com' },
}));

const sendGroupMessage = vi.fn();
const mockGetDingTalkCard = vi.fn();
const mockLoadDingTalkPendingApproval = vi.fn();
const mockClaimDingTalkApprovalNotice = vi.fn<(...args: unknown[]) => Promise<boolean>>(
  async () => true,
);

vi.mock('@lobechat/chat-adapter-dingtalk', () => ({
  buildActionCardParam: vi.fn().mockImplementation((options: any) => ({
    msgKey: 'sampleActionCard2',
    msgParam: JSON.stringify({ title: options.title, text: options.text }),
  })),
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
  DingTalkAiCardStream: vi.fn(),
  DingTalkApiClient: vi.fn().mockImplementation(() => ({
    sendBySessionWebhook,
    sendGroupMessage,
    sendOtoMessage,
  })),
  DingTalkCardUnavailableError: class extends Error {},
  getDingTalkCard: (...args: unknown[]) => mockGetDingTalkCard(...args),
  getDingTalkSession: vi.fn().mockReturnValue(undefined),
  isSessionWebhookLive: vi.fn().mockReturnValue(false),
  parseDingTalkConfirmAction: (content: unknown) => {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    const action = (parsed as { cardPrivateData?: { params?: { action?: string } } })
      ?.cardPrivateData?.params?.action;
    if (action === 'agree' || action === 'approve') return 'approve';
    return action === 'reject' ? action : undefined;
  },
  rememberDingTalkCard: vi.fn(),
}));

vi.mock('./approvalStore', () => ({
  claimDingTalkApprovalNotice: (...args: unknown[]) => mockClaimDingTalkApprovalNotice(...args),
  loadDingTalkPendingApproval: (...args: unknown[]) => mockLoadDingTalkPendingApproval(...args),
}));

vi.mock('./branding', () => ({
  resolveDingTalkBrandingDisplayName: vi.fn(async () => 'AI 平台'),
}));

vi.mock('@/server/services/bot/platforms/dingtalk/sendAttachments', () => ({
  sendDingTalkAttachments: vi.fn(),
}));

vi.mock('@/server/services/bot/platforms/dingtalk/client', () => ({
  DingTalkClientFactory: vi.fn().mockImplementation(() => ({ createClient })),
}));

const { getMessengerDingTalkConfig } = await import('@/config/messenger');
const { getDingTalkSession, isSessionWebhookLive } =
  await import('@lobechat/chat-adapter-dingtalk');
const { MessengerDingTalkBinder } = await import('./binder');
const { resolveDingTalkBrandingDisplayName } = await import('./branding');
const { formatDingTalkUnknownUserReply } = await import('./const');

const VALID_CONFIG = {
  aiCardTemplateId: null,
  chatEnabled: true,
  clientId: 'app_key',
  clientSecret: 'app_secret',
  idleNewTopicEnabled: true,
  idleNewTopicHours: 24,
  pushEnabled: true,
  robotCode: 'robot_1',
  selectCardTemplateId: null,
};

beforeEach(() => {
  mockClaimDingTalkApprovalNotice.mockReset();
  mockClaimDingTalkApprovalNotice.mockResolvedValue(true);
  vi.mocked(getMessengerDingTalkConfig).mockResolvedValue(VALID_CONFIG as any);
  sendOtoMessage.mockResolvedValue({});
  sendBySessionWebhook.mockResolvedValue(undefined);
  sendGroupMessage.mockResolvedValue({});
  mockGetDingTalkCard.mockReturnValue(undefined);
  vi.mocked(getDingTalkSession).mockReturnValue(undefined);
  vi.mocked(isSessionWebhookLive).mockReturnValue(false);
  createClient.mockReturnValue({ id: 'client' });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MessengerDingTalkBinder.sendDmText', () => {
  it('sends oTo batchSend with sampleText {content}', async () => {
    const binder = new MessengerDingTalkBinder();
    await binder.sendDmText('staff_1', 'hello');

    expect(sendOtoMessage).toHaveBeenCalledWith({
      msgKey: 'sampleText',
      msgParam: JSON.stringify({ content: 'hello' }),
      robotCode: 'robot_1',
      userIds: ['staff_1'],
    });
  });

  it('no-ops when dingtalk is not configured', async () => {
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValueOnce(null);
    await new MessengerDingTalkBinder().sendDmText('staff_1', 'hello');
    expect(sendOtoMessage).not.toHaveBeenCalled();
  });

  it('uses 回复 as markdown title when the body has no title line', async () => {
    vi.mocked(getDingTalkSession).mockReturnValue({
      conversationId: 'cid',
      conversationType: '1',
      senderStaffId: 'staff_1',
      sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=abc',
      sessionWebhookExpiredTime: Date.now() + 60_000,
    } as any);
    vi.mocked(isSessionWebhookLive).mockReturnValue(true);

    await new MessengerDingTalkBinder().sendDmText('dingtalk:cid', '\n\n');

    expect(sendBySessionWebhook).toHaveBeenCalledWith(
      'https://oapi.dingtalk.com/robot/sendBySession?session=abc',
      expect.objectContaining({
        markdown: expect.objectContaining({ title: '回复' }),
        msgtype: 'markdown',
      }),
    );
  });
});

describe('MessengerDingTalkBinder.handleUnlinkedMessage', () => {
  it('sends the branding-aware unknown-user sentence', async () => {
    vi.mocked(resolveDingTalkBrandingDisplayName).mockResolvedValueOnce('某某平台');

    await new MessengerDingTalkBinder().handleUnlinkedMessage({
      authorUserId: 'staff_1',
      chatId: 'staff_1',
    });

    expect(sendOtoMessage).toHaveBeenCalledWith({
      msgKey: 'sampleText',
      msgParam: JSON.stringify({ content: formatDingTalkUnknownUserReply('某某平台') }),
      robotCode: 'robot_1',
      userIds: ['staff_1'],
    });
  });
});

describe('MessengerDingTalkBinder.createClient', () => {
  it('builds a client via DingTalkClientFactory', async () => {
    const client = await new MessengerDingTalkBinder().createClient();
    expect(client).toEqual({ id: 'client' });
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: 'app_key',
        credentials: { clientSecret: 'app_secret' },
        platform: 'dingtalk',
      }),
      { appUrl: 'https://app.example.com' },
    );
  });
});

describe('MessengerDingTalkBinder group replies', () => {
  it('@-mentions the asker in group markdown', async () => {
    const binder = new MessengerDingTalkBinder();
    await binder.sendDmText('dingtalk:cid:staff_9', '已加入队列');

    expect(sendGroupMessage).toHaveBeenCalledWith({
      msgKey: 'sampleMarkdown',
      msgParam: JSON.stringify({
        at: { atUserIds: ['staff_9'] },
        text: '@staff_9 已加入队列',
        title: '已加入队列',
      }),
      openConversationId: 'cid',
      robotCode: 'robot_1',
    });
  });
});

describe('MessengerDingTalkBinder.extractCallbackAction', () => {
  beforeEach(() => {
    mockLoadDingTalkPendingApproval.mockReset();
    mockLoadDingTalkPendingApproval.mockResolvedValue(null);
  });

  it('returns messenger:not_asker when a different staffId taps the card', async () => {
    mockGetDingTalkCard.mockReturnValue({
      askerStaffId: 'staff_1',
      threadId: 'dingtalk:cid:staff_1',
    });
    const binder = new MessengerDingTalkBinder();
    const action = await binder.extractCallbackAction(
      new Request('https://example.com', {
        body: JSON.stringify({ outTrackId: 'card_1', userId: 'staff_2' }),
        method: 'POST',
      }),
    );
    expect(action).toEqual({
      callbackId: 'card_1',
      chatId: 'dingtalk:cid:staff_1',
      data: 'messenger:not_asker',
      fromUserId: 'staff_2',
    });
    expect(mockLoadDingTalkPendingApproval).not.toHaveBeenCalled();
  });

  it('routes the asker button to messenger:confirm', async () => {
    mockGetDingTalkCard.mockReturnValue({
      askerStaffId: 'staff_1',
      threadId: 'dingtalk:cid:staff_1',
    });
    mockLoadDingTalkPendingApproval.mockResolvedValue({
      askerStaffId: 'staff_1',
      threadId: 'dingtalk:cid:staff_1',
    });
    const binder = new MessengerDingTalkBinder();
    const action = await binder.extractCallbackAction(
      new Request('https://example.com', {
        body: JSON.stringify({
          content: { cardPrivateData: { params: { action: 'approve' } } },
          outTrackId: 'confirm-1',
          userId: 'staff_1',
        }),
        method: 'POST',
      }),
    );
    expect(action).toEqual({
      callbackId: 'confirm-1',
      chatId: 'dingtalk:cid:staff_1',
      data: 'messenger:confirm:approve',
      fromUserId: 'staff_1',
    });
  });

  it('maps the imported template agree button to messenger:confirm:approve', async () => {
    mockGetDingTalkCard.mockReturnValue({
      askerStaffId: 'staff_1',
      threadId: 'dingtalk:cid:staff_1',
    });
    mockLoadDingTalkPendingApproval.mockResolvedValue({
      askerStaffId: 'staff_1',
      threadId: 'dingtalk:cid:staff_1',
    });
    const action = await new MessengerDingTalkBinder().extractCallbackAction(
      new Request('https://example.com', {
        body: JSON.stringify({
          content: { cardPrivateData: { params: { action: 'agree' } } },
          outTrackId: 'confirm-1',
          userId: 'staff_1',
        }),
        method: 'POST',
      }),
    );
    expect(action?.data).toBe('messenger:confirm:approve');
  });
});

describe('MessengerDingTalkBinder.acknowledgeCallback', () => {
  it('sends 仅提问人可操作 once per card and clicker', async () => {
    mockClaimDingTalkApprovalNotice.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const binder = new MessengerDingTalkBinder();
    const action = {
      callbackId: 'confirm-1',
      chatId: 'dingtalk:cid:staff_1',
      data: 'messenger:not_asker',
      fromUserId: 'staff_2',
    };
    await binder.acknowledgeCallback(action, { toast: '仅提问人可操作' });
    await binder.acknowledgeCallback(action, { toast: '仅提问人可操作' });
    expect(sendGroupMessage).toHaveBeenCalledTimes(1);
    expect(mockClaimDingTalkApprovalNotice).toHaveBeenCalledWith(
      'not-asker',
      'confirm-1',
      'staff_2',
    );
  });

  it('still sends other toasts', async () => {
    mockClaimDingTalkApprovalNotice.mockResolvedValue(false);
    await new MessengerDingTalkBinder().acknowledgeCallback(
      {
        callbackId: 'card_1',
        chatId: 'dingtalk:cid:staff_1',
        data: 'messenger:switch:agt',
        fromUserId: 'staff_1',
      },
      { toast: '已切换到：Inbox' },
    );
    expect(mockClaimDingTalkApprovalNotice).not.toHaveBeenCalled();
    expect(sendGroupMessage).toHaveBeenCalled();
  });
});

describe('MessengerDingTalkBinder.sendAgentPicker', () => {
  it('posts an ActionCard in-group via sendGroupMessage', async () => {
    const binder = new MessengerDingTalkBinder();
    await binder.sendAgentPicker('dingtalk:cid:staff_9', {
      entries: [
        { id: 'agt_main', isActive: true, title: 'Inbox' },
        { id: 'agt_other', isActive: false, title: 'Other' },
      ],
      text: '点选要切换的助手',
    });

    expect(sendGroupMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        msgKey: 'sampleActionCard2',
        openConversationId: 'cid',
        robotCode: 'robot_1',
      }),
    );
  });
});
