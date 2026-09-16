import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const replace = vi.fn();
const finalize = vi.fn();
const sendOtoMessage = vi.fn();
const sendGroupMessage = vi.fn();
const sendBySessionWebhook = vi.fn();
const recallMessage = vi.fn();
const mockResolveDingTalkBrandingDisplayName = vi.fn();
const mockSetDingTalkLastList = vi.fn();

vi.mock('@/config/messenger', () => ({
  getMessengerDingTalkConfig: vi.fn(),
}));

vi.mock('./branding', () => ({
  resolveDingTalkBrandingDisplayName: (...args: unknown[]) =>
    mockResolveDingTalkBrandingDisplayName(...args),
}));

vi.mock('./redis', () => ({
  setDingTalkLastList: (...args: unknown[]) => mockSetDingTalkLastList(...args),
}));

vi.mock('@lobechat/chat-adapter-dingtalk', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    DingTalkAiCardStream: vi.fn().mockImplementation(() => ({ create, finalize, replace })),
    DingTalkApiClient: vi.fn().mockImplementation(() => ({
      recallMessage,
      sendBySessionWebhook,
      sendGroupMessage,
      sendOtoMessage,
    })),
    getDingTalkSession: vi.fn(),
    isSessionWebhookLive: vi.fn().mockReturnValue(false),
    rememberDingTalkCard: vi.fn(),
  };
});

vi.mock('@/server/services/bot/platforms/dingtalk/sendAttachments', () => ({
  sendDingTalkAttachments: vi.fn(),
}));

const { getMessengerDingTalkConfig } = await import('@/config/messenger');
const {
  DingTalkCardUnavailableError,
  dtmdSendMessageUrl,
  getDingTalkSession,
  isSessionWebhookLive,
} = await import('@lobechat/chat-adapter-dingtalk');
const { sendDingTalkAttachments } =
  await import('@/server/services/bot/platforms/dingtalk/sendAttachments');
const {
  createDingTalkReplySink,
  paginateEntries,
  parseDingTalkAskerCommand,
  sendDingTalkChoiceList,
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
  DINGTALK_THINKING_REPLY,
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
  sendOtoMessage.mockResolvedValue({ processQueryKey: 'pqk-1' });
  sendGroupMessage.mockResolvedValue({ processQueryKey: 'pqk-g1' });
  recallMessage.mockResolvedValue(undefined);
  vi.mocked(getDingTalkSession).mockReset();
  vi.mocked(getDingTalkSession).mockReturnValue(undefined);
  vi.mocked(isSessionWebhookLive).mockReturnValue(false);
  mockResolveDingTalkBrandingDisplayName.mockResolvedValue('AI平台');
});

describe('DingTalk AI-card reply sink', () => {
  it('falls back to text when card create fails', async () => {
    create.mockRejectedValueOnce(new DingTalkCardUnavailableError('card down'));
    const order: string[] = [];
    sendOtoMessage.mockImplementation(async (params: { msgParam: string }) => {
      const text = (JSON.parse(params.msgParam) as { text: string }).text;
      order.push(text === DINGTALK_THINKING_REPLY ? 'thinking' : 'answer');
      return { processQueryKey: 'pqk-1' };
    });
    recallMessage.mockImplementation(async () => {
      order.push('recall');
    });
    const sink = await createDingTalkReplySink('dingtalk:cid');
    await sink?.onStart?.();
    await sink?.onComplete?.('final markdown');
    expect(finalize).not.toHaveBeenCalled();
    expect(order).toEqual(['thinking', 'recall', 'answer']);
    expect(recallMessage).toHaveBeenCalledWith({
      openConversationId: undefined,
      processQueryKeys: ['pqk-1'],
      robotCode: 'robot',
    });
    const answerParam = JSON.parse(
      (sendOtoMessage.mock.calls[1] as [{ msgParam: string }])[0].msgParam,
    ) as { text: string };
    expect(answerParam.text).toBe('final markdown');
  });

  it('finalizes the card with error text so it is never left open', async () => {
    const sink = await createDingTalkReplySink('dingtalk:cid');
    await sink?.onStart?.();
    await sink?.onPartial?.('thinking');
    await sink?.onError?.('执行失败');
    expect(create).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('thinking');
    expect(replace).toHaveBeenCalledWith('执行失败');
    expect(finalize).toHaveBeenCalledWith('执行失败');
  });

  it('replaces thinking with the final answer on the AI-card stream', async () => {
    const sink = await createDingTalkReplySink('dingtalk:cid');
    await sink?.onStart?.();
    await sink?.onComplete?.('最终回答');
    expect(create).toHaveBeenCalledWith(DINGTALK_THINKING_REPLY);
    expect(replace).toHaveBeenCalledWith('最终回答');
    expect(finalize).toHaveBeenCalledWith('最终回答');
    expect(recallMessage).not.toHaveBeenCalled();
    expect(sendOtoMessage).not.toHaveBeenCalled();
  });
});

describe('DingTalk markdown thinking placeholder', () => {
  const TEXT_CONFIG = { ...CONFIG, aiCardTemplateId: null };

  it('recalls the thinking placeholder before sending the answer', async () => {
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValue(TEXT_CONFIG as any);
    const sink = await createDingTalkReplySink('dingtalk:cid');
    await sink?.onStart?.();
    expect(sendOtoMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        msgKey: 'sampleMarkdown',
        robotCode: 'robot',
      }),
    );
    const thinkingParam = JSON.parse(
      (sendOtoMessage.mock.calls[0] as [{ msgParam: string }])[0].msgParam,
    ) as { text: string };
    expect(thinkingParam.text).toBe(DINGTALK_THINKING_REPLY);

    await sink?.onComplete?.('最终回答');
    expect(recallMessage).toHaveBeenCalledWith({
      openConversationId: undefined,
      processQueryKeys: ['pqk-1'],
      robotCode: 'robot',
    });
    expect(sendOtoMessage).toHaveBeenCalledTimes(2);
    const answerParam = JSON.parse(
      (sendOtoMessage.mock.calls[1] as [{ msgParam: string }])[0].msgParam,
    ) as { text: string };
    expect(answerParam.text).toBe('最终回答');
  });

  it('recalls the thinking placeholder before sending an error reply', async () => {
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValue(TEXT_CONFIG as any);
    const sink = await createDingTalkReplySink('dingtalk:cid');
    await sink?.onStart?.();
    await sink?.onError?.('执行失败');
    expect(recallMessage).toHaveBeenCalledWith({
      openConversationId: undefined,
      processQueryKeys: ['pqk-1'],
      robotCode: 'robot',
    });
    const errorParam = JSON.parse(
      (sendOtoMessage.mock.calls.at(-1) as [{ msgParam: string }])[0].msgParam,
    ) as { text: string };
    expect(errorParam.text).toBe('执行失败');
  });

  it('swallows recall failures and still sends the answer', async () => {
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValue(TEXT_CONFIG as any);
    recallMessage.mockRejectedValueOnce(new Error('recall 500'));
    const sink = await createDingTalkReplySink('dingtalk:cid');
    await sink?.onStart?.();
    await expect(sink?.onComplete?.('最终回答')).resolves.toBeUndefined();
    expect(sendOtoMessage).toHaveBeenCalledTimes(2);
  });

  it('recalls group thinking placeholders via groupMessages/recall', async () => {
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValue(TEXT_CONFIG as any);
    const sink = await createDingTalkReplySink('dingtalk:cid_group:staff_a');
    await sink?.onStart?.();
    expect(sendGroupMessage).toHaveBeenCalled();
    await sink?.onComplete?.('群回复');
    expect(recallMessage).toHaveBeenCalledWith({
      openConversationId: 'cid_group',
      processQueryKeys: ['pqk-g1'],
      robotCode: 'robot',
    });
  });

  it('sends recallable thinking via robot API even when the session webhook is live', async () => {
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValue(TEXT_CONFIG as any);
    vi.mocked(isSessionWebhookLive).mockReturnValue(true);
    vi.mocked(getDingTalkSession).mockReturnValue({
      sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=abc',
    } as any);

    const sink = await createDingTalkReplySink('dingtalk:cid');
    await sink?.onStart?.();

    expect(sendBySessionWebhook).not.toHaveBeenCalled();
    expect(sendOtoMessage).toHaveBeenCalledTimes(1);
    const thinkingParam = JSON.parse(
      (sendOtoMessage.mock.calls[0] as [{ msgParam: string }])[0].msgParam,
    ) as { text: string };
    expect(thinkingParam.text).toBe(DINGTALK_THINKING_REPLY);

    await sink?.onComplete?.('最终回答');
    expect(recallMessage).toHaveBeenCalledWith({
      openConversationId: undefined,
      processQueryKeys: ['pqk-1'],
      robotCode: 'robot',
    });
    // Answer is not recallable, so it may use the live session webhook.
    expect(sendBySessionWebhook).toHaveBeenCalled();
  });

  it('recalls thinking and does not post a whitespace-only answer', async () => {
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValue(TEXT_CONFIG as any);
    const sink = await createDingTalkReplySink('dingtalk:cid');
    await sink?.onStart?.();
    await sink?.onComplete?.('\n  ');
    expect(recallMessage).toHaveBeenCalledWith({
      openConversationId: undefined,
      processQueryKeys: ['pqk-1'],
      robotCode: 'robot',
    });
    expect(sendOtoMessage).toHaveBeenCalledTimes(1);
  });
});

describe('DingTalk AI-card attachments', () => {
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
  const parseParam = (call: { msgParam: string }) =>
    JSON.parse(call.msgParam) as Record<string, unknown>;

  const expectShortcutCard4 = (param: Record<string, unknown>, text: string, title: string) => {
    expect(param.title).toBe(title);
    expect(param.text).toBe(text);
    expect(param.actionTitle1).toBe(DINGTALK_COMMAND_SHORTCUT_BUTTONS[0].label);
    expect(param.actionTitle2).toBe(DINGTALK_COMMAND_SHORTCUT_BUTTONS[1].label);
    expect(param.actionTitle3).toBe(DINGTALK_COMMAND_SHORTCUT_BUTTONS[2].label);
    expect(param.actionTitle4).toBe(DINGTALK_COMMAND_SHORTCUT_BUTTONS[3].label);
    expect(param).not.toHaveProperty('actionTitle5');
    expect(param).not.toHaveProperty('singleTitle');
    expect(param.actionURL1).toBe(dtmdSendMessageUrl(DINGTALK_COMMAND_SHORTCUT_BUTTONS[0].command));
    expect(param.actionURL2).toBe(dtmdSendMessageUrl(DINGTALK_COMMAND_SHORTCUT_BUTTONS[1].command));
    expect(param.actionURL3).toBe(dtmdSendMessageUrl(DINGTALK_COMMAND_SHORTCUT_BUTTONS[2].command));
    expect(param.actionURL4).toBe(dtmdSendMessageUrl(DINGTALK_COMMAND_SHORTCUT_BUTTONS[3].command));
  };

  it('sends a welcome ActionCard with branding title and shortcut buttons', async () => {
    vi.mocked(getDingTalkSession).mockReturnValue({
      conversationId: 'cid',
      conversationType: '1',
      senderStaffId: 'staff_dm',
    } as any);
    await sendDingTalkWelcomeCard('dingtalk:cid');
    expect(sendOtoMessage).toHaveBeenCalledTimes(1);
    expect(sendOtoMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        msgKey: 'sampleActionCard4',
        robotCode: 'robot',
        userIds: ['staff_dm'],
      }),
    );
    expectShortcutCard4(
      parseParam(sendOtoMessage.mock.calls[0][0]),
      DINGTALK_WELCOME_TEXT,
      '已连接 AI平台',
    );
    expect(sendGroupMessage).not.toHaveBeenCalled();
  });

  it('sends the welcome card via the group API and @-mentions the asker', async () => {
    await sendDingTalkWelcomeCard('dingtalk:cid:staff_9');
    expect(sendGroupMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        msgKey: 'sampleActionCard4',
        openConversationId: 'cid',
        robotCode: 'robot',
      }),
    );
    const param = parseParam(sendGroupMessage.mock.calls[0][0]);
    expectShortcutCard4(param, `@staff_9 ${DINGTALK_WELCOME_TEXT}`, '已连接 AI平台');
    expect(param.at).toEqual({ atUserIds: ['staff_9'] });
    expect(sendOtoMessage).not.toHaveBeenCalled();
  });

  it('sends sampleActionCard for a single-button picker', async () => {
    await sendDingTalkChoiceList({
      askerStaffId: 'staff_1',
      entries: [{ command: '/切换 1', label: 'Inbox' }],
      text: '点选要切换的助手',
      threadId: 'dingtalk:cid',
      title: '助手',
    });
    expect(sendOtoMessage).toHaveBeenCalledWith(
      expect.objectContaining({ msgKey: 'sampleActionCard' }),
    );
    const param = parseParam(sendOtoMessage.mock.calls[0][0]);
    expect(param.singleTitle).toBe('Inbox');
    expect(param.singleURL).toBe(dtmdSendMessageUrl('/切换 1'));
    expect(param).not.toHaveProperty('actionTitle1');
    expect(param).not.toHaveProperty('actionTitle2');
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
    expect(sendOtoMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ msgKey: 'sampleActionCard4' }),
    );
    expectShortcutCard4(
      parseParam(sendOtoMessage.mock.calls[1][0]),
      DINGTALK_COMMAND_CARD_TEXT,
      DINGTALK_COMMAND_CARD_TITLE,
    );
    expect(DINGTALK_HELP_TEXT).toContain('## 常用指令');
    expect(DINGTALK_HELP_TEXT).not.toContain('/');
    expect(DINGTALK_HELP_TEXT).toContain('点下面的按钮即可：查看助手、新会话、最近会话。');
    expect(DINGTALK_HELP_TEXT).toContain('群聊中请 @机器人');
    expect(DINGTALK_HELP_TEXT).not.toMatch(/[!！]/);
    expect(DINGTALK_COMMAND_SHORTCUT_BUTTONS.map((button) => button.command)).toEqual([
      '/助手',
      '/新会话',
      '/会话',
      '/帮助',
    ]);
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
    expect(sendGroupMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ msgKey: 'sampleActionCard4', openConversationId: 'cid' }),
    );
    const cardParam = parseParam(sendGroupMessage.mock.calls[1][0]);
    expectShortcutCard4(
      cardParam,
      `@staff_9 ${DINGTALK_COMMAND_CARD_TEXT}`,
      DINGTALK_COMMAND_CARD_TITLE,
    );
    expect(cardParam.at).toEqual({ atUserIds: ['staff_9'] });
  });

  it('records last-list for agents/topics/question pickers and skips scope lists', async () => {
    await sendDingTalkChoiceList({
      askerStaffId: 'staff_1',
      entries: [{ command: 'messenger:switch:agt_1', label: 'Inbox' }],
      pageCommandPrefix: 'messenger:agents:page:',
      text: '点选要切换的助手',
      threadId: 'dingtalk:cid',
      title: '选择助手',
    });
    expect(mockSetDingTalkLastList).toHaveBeenCalledWith('dingtalk:cid', 'agents');

    mockSetDingTalkLastList.mockClear();
    await sendDingTalkChoiceList({
      askerStaffId: 'staff_1',
      entries: [{ command: 'messenger:resume:t1', label: '周报' }],
      pageCommandPrefix: 'messenger:topics:page:',
      text: '最近会话',
      threadId: 'dingtalk:cid',
      title: '最近会话',
    });
    expect(mockSetDingTalkLastList).toHaveBeenCalledWith('dingtalk:cid', 'topics');

    mockSetDingTalkLastList.mockClear();
    await sendDingTalkChoiceList({
      askerStaffId: 'staff_1',
      entries: [{ command: 'messenger:answer:yes', label: '是' }],
      pageCommandPrefix: 'messenger:question:page:',
      text: '确认',
      threadId: 'dingtalk:cid',
      title: '需要确认',
    });
    expect(mockSetDingTalkLastList).toHaveBeenCalledWith('dingtalk:cid', 'question');

    mockSetDingTalkLastList.mockClear();
    await sendDingTalkChoiceList({
      askerStaffId: 'staff_1',
      entries: [{ command: 'messenger:scope:personal', label: '个人' }],
      pageCommandPrefix: 'messenger:scope:page:',
      text: '点选要切换的范围',
      threadId: 'dingtalk:cid',
      title: '选择范围',
    });
    expect(mockSetDingTalkLastList).not.toHaveBeenCalled();
  });
});
