import { beforeEach, describe, expect, it, vi } from 'vitest';

const load = vi.fn();
const claim = vi.fn();
const revert = vi.fn();
const finalize = vi.fn();
const save = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true);
const claimNotice = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true);
const sendMarkdown = vi.fn();
const threadActive = vi.fn<(...args: unknown[]) => boolean>(() => false);
const handleSubscribedMessage = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const findMessagePlugin = vi.fn();
const rejectPlugin = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true);
const scan = vi.fn<(...args: unknown[]) => Promise<[string, string[]]>>(
  async () => ['0', []] as [string, string[]],
);
const sendCard = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const updateCard = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const approvalPreview = vi.fn();
const approvalCtor = vi.fn();
const todoPreview = vi.fn();
const todoCtor = vi.fn();
const calendarPreview = vi.fn();
const calendarCtor = vi.fn();

vi.mock('./approvalStore', () => ({
  claimDingTalkApprovalNotice: (...args: unknown[]) => claimNotice(...args),
  claimDingTalkPendingApproval: (...args: unknown[]) => claim(...args),
  finalizeDingTalkPendingApproval: (...args: unknown[]) => finalize(...args),
  loadDingTalkPendingApproval: (...args: unknown[]) => load(...args),
  loadDingTalkPendingApprovalByThread: vi.fn(),
  revertDingTalkPendingApproval: (...args: unknown[]) => revert(...args),
  saveDingTalkPendingApproval: (...args: unknown[]) => save(...args),
  sealDingTalkPendingApproval: vi.fn(),
}));

vi.mock('./cards', () => ({
  createDingTalkReplySink: vi.fn(),
  sendDingTalkMarkdown: (...args: unknown[]) => sendMarkdown(...args),
}));

vi.mock('./questions', () => ({
  forwardDingTalkWaitingQuestion: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    findMessagePlugin(...args: unknown[]) {
      return findMessagePlugin(...args);
    }

    rejectPendingMessagePlugin(...args: unknown[]) {
      return rejectPlugin(...args);
    }
  },
}));
vi.mock('@/config/messenger', () => ({ getMessengerDingTalkConfig: vi.fn() }));
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => ({ scan: (...args: unknown[]) => scan(...args) }),
}));
vi.mock('@/server/services/bot/AgentBridgeService', () => ({
  AgentBridgeService: class {
    static isThreadActive(threadId: string) {
      return threadActive(threadId);
    }

    handleSubscribedMessage(...args: unknown[]) {
      return handleSubscribedMessage(...args);
    }
  },
}));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://chat.example.com' } }));

vi.mock('@lobechat/chat-adapter-dingtalk', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@lobechat/chat-adapter-dingtalk');
  return {
    ...actual,
    sendDingTalkStreamConfirmCard: (...args: unknown[]) => sendCard(...args),
    updateDingTalkConfirmCard: (...args: unknown[]) => updateCard(...args),
  };
});

vi.mock('@/server/enterprise/services/dingtalkWorkspace/approval', () => ({
  DingtalkApprovalService: class {
    constructor(db: unknown, userId: string) {
      approvalCtor(db, userId);
    }

    preview(input: unknown) {
      return approvalPreview(input);
    }
  },
}));

vi.mock('@/server/enterprise/services/dingtalkWorkspace/todo', () => ({
  DingtalkTodoService: class {
    constructor(db: unknown, userId: string) {
      todoCtor(db, userId);
    }

    preview(input: unknown) {
      return todoPreview(input);
    }
  },
  isTodoWriteApiName: (value: string) =>
    ['createTodo', 'updateTodo', 'completeTodo', 'deleteTodo'].includes(value),
}));

vi.mock('@/server/enterprise/services/dingtalkWorkspace/calendar', () => ({
  DingtalkCalendarService: class {
    constructor(db: unknown, userId: string) {
      calendarCtor(db, userId);
    }

    preview(input: unknown) {
      return calendarPreview(input);
    }
  },
  isCalendarWriteApiName: (value: string) =>
    ['createEvent', 'updateEvent', 'deleteEvent', 'respondEvent'].includes(value),
}));

const { getMessengerDingTalkConfig } = await import('@/config/messenger');
const {
  applyDingTalkConfirmClick,
  extractDingTalkApprovalCalls,
  forwardDingTalkWaitingHuman,
  restoreDingTalkApprovalTimers,
} = await import('./approvalConfirm');

const claimedRecord = {
  agentId: 'agt_1',
  approveOnCard: true,
  askerStaffId: 'staff_1',
  botContext: {
    applicationId: 'messenger-dingtalk',
    isOwner: true,
    platform: 'dingtalk' as const,
    platformThreadId: 'dingtalk:cid:staff_1',
    senderExternalUserId: 'staff_1',
  },
  cardContent: '模板名称：结案',
  cardTitle: '创建模板「结案」',
  conversationId: 'cid',
  conversationType: '2',
  decision: 'approved' as const,
  expiresAt: Date.now() + 60_000,
  operationId: 'op_1',
  outTrackId: 'confirm-1',
  parentMessageId: 'msg_tool',
  robotCode: 'robot',
  siblings: [],
  status: 'resuming' as const,
  threadId: 'dingtalk:cid:staff_1',
  toolCallId: 'call_1',
  topicId: 'topic_1',
  userId: 'user_1',
  webLink: 'https://chat.example.com/topic',
};

const CONFIRM_CONFIG = { clientId: 'client', clientSecret: 'secret', robotCode: 'robot' };

const topicLink = (): string =>
  'https://chat.example.com/dingtalk/sso?redirect=' + encodeURIComponent('/agent/agt_1/topic_1');

beforeEach(() => {
  vi.clearAllMocks();
  claimNotice.mockResolvedValue(true);
  save.mockResolvedValue(true);
  threadActive.mockReturnValue(false);
  handleSubscribedMessage.mockResolvedValue(undefined);
  approvalPreview.mockReset();
  todoPreview.mockReset();
  calendarPreview.mockReset();
  vi.mocked(getMessengerDingTalkConfig).mockReset();
  delete process.env.DINGTALK_CONFIRM_RESUME_SETTLE_MS;
});

describe('extractDingTalkApprovalCalls', () => {
  it('keeps approval anchors and skips askUserQuestion tool results', () => {
    const calls = extractDingTalkApprovalCalls({
      finalState: {
        pendingHumanToolMessages: [
          { kind: 'toolResult', messageId: 'q', toolCallId: 'q1' },
          { kind: 'approval', messageId: 'msg_tool', toolCallId: 'call_1' },
        ],
        pendingToolsCalling: [
          {
            apiName: 'saveTemplate',
            arguments: '{"name":"结案"}',
            id: 'call_1',
            identifier: 'lobe-dingtalk-approval',
          },
        ],
      },
      operationId: 'op_1',
    });
    expect(calls).toEqual([
      {
        apiName: 'saveTemplate',
        args: { name: '结案' },
        identifier: 'lobe-dingtalk-approval',
        parentMessageId: 'msg_tool',
        toolCallId: 'call_1',
      },
    ]);
  });
});

describe('applyDingTalkConfirmClick', () => {
  it('rejects another person without claiming or changing the card', async () => {
    load.mockResolvedValue({
      askerStaffId: 'staff_1',
      threadId: 'dingtalk:cid:staff_1',
    });
    const result = await applyDingTalkConfirmClick({
      decision: 'approve',
      outTrackId: 'confirm-1',
      userId: 'staff_2',
    });
    expect(result).toBe('not_asker');
    expect(sendMarkdown).toHaveBeenCalledWith('dingtalk:cid:staff_1', '仅提问人可操作', {
      staffId: 'staff_2',
    });
    expect(claim).not.toHaveBeenCalled();
  });

  it('sends the not-asker reply at most once per card and clicker', async () => {
    load.mockResolvedValue({
      askerStaffId: 'staff_1',
      threadId: 'dingtalk:cid:staff_1',
    });
    claimNotice.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await applyDingTalkConfirmClick({
      decision: 'approve',
      outTrackId: 'confirm-1',
      userId: 'staff_2',
    });
    await applyDingTalkConfirmClick({
      decision: 'approve',
      outTrackId: 'confirm-1',
      userId: 'staff_2',
    });
    expect(sendMarkdown).toHaveBeenCalledTimes(1);
    expect(claimNotice).toHaveBeenCalledWith('not-asker', 'confirm-1', 'staff_2');
    expect(claim).not.toHaveBeenCalled();
  });

  it('still rejects from the card when 批准 must be done on the web', async () => {
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValue(CONFIRM_CONFIG as never);
    load.mockResolvedValue({
      ...claimedRecord,
      approveOnCard: false,
      status: 'pending',
    });
    claim.mockResolvedValue({
      outcome: 'claimed',
      record: { ...claimedRecord, approveOnCard: false, decision: 'rejected', status: 'resuming' },
    });
    const result = await applyDingTalkConfirmClick({
      decision: 'reject',
      outTrackId: 'confirm-1',
      userId: 'staff_1',
    });
    expect(result).toBe('applied');
    expect(claim).toHaveBeenCalledWith('confirm-1', 'rejected');
    expect(updateCard).toHaveBeenCalledWith(expect.anything(), 'confirm-1', {
      status: 'reject',
      statusText: '已拒绝',
    });
  });

  it('does not approve from the card when the summary was shortened', async () => {
    load.mockResolvedValue({
      ...claimedRecord,
      approveOnCard: false,
      status: 'pending',
    });
    const result = await applyDingTalkConfirmClick({
      decision: 'approve',
      outTrackId: 'confirm-1',
      userId: 'staff_1',
    });
    expect(result).toBe('web_only');
    expect(claim).not.toHaveBeenCalled();
    expect(claimNotice).toHaveBeenCalledWith('web-only', 'confirm-1', 'staff_1');
    expect(sendMarkdown).toHaveBeenCalledWith(
      'dingtalk:cid:staff_1',
      expect.stringContaining('内容较长，完整内容请在网页端确认：'),
      { staffId: 'staff_1' },
    );
  });

  it('does not mark the card decided when the parked run is still active', async () => {
    process.env.DINGTALK_CONFIRM_RESUME_SETTLE_MS = '0';
    threadActive.mockReturnValue(true);
    load.mockResolvedValue({ ...claimedRecord, status: 'pending' });
    claim.mockResolvedValue({ outcome: 'claimed', record: claimedRecord });
    const result = await applyDingTalkConfirmClick({
      decision: 'approve',
      outTrackId: 'confirm-1',
      userId: 'staff_1',
    });
    expect(result).toBe('deferred');
    expect(handleSubscribedMessage).not.toHaveBeenCalled();
    expect(revert).toHaveBeenCalledWith(claimedRecord);
    expect(finalize).not.toHaveBeenCalled();
  });

  it('retries a skipped resume once the thread is idle, then finalizes', async () => {
    let calls = 0;
    handleSubscribedMessage.mockImplementation(async (...args: unknown[]) => {
      calls += 1;
      const opts = args[2] as { onSkippedActive?: () => Promise<void> } | undefined;
      if (calls === 1) await opts?.onSkippedActive?.();
    });
    load.mockResolvedValue({ ...claimedRecord, status: 'pending' });
    claim.mockResolvedValue({ outcome: 'claimed', record: claimedRecord });
    const result = await applyDingTalkConfirmClick({
      decision: 'approve',
      outTrackId: 'confirm-1',
      userId: 'staff_1',
    });
    expect(result).toBe('applied');
    expect(handleSubscribedMessage).toHaveBeenCalledTimes(2);
    expect(finalize).toHaveBeenCalled();
    expect(revert).not.toHaveBeenCalled();
  });

  it('does nothing when the card was already claimed', async () => {
    load.mockResolvedValue({ askerStaffId: 'staff_1', threadId: 'dingtalk:cid:staff_1' });
    claim.mockResolvedValue({ outcome: 'stale' });
    const result = await applyDingTalkConfirmClick({
      decision: 'reject',
      outTrackId: 'confirm-1',
      userId: 'staff_1',
    });
    expect(result).toBe('stale');
  });
});

describe('restoreDingTalkApprovalTimers', () => {
  const key = 'messenger:dingtalk:pending-approval:confirm-1';

  it('returns a crashed resuming card to pending while the tool is still waiting', async () => {
    scan.mockResolvedValueOnce(['0', [key]]);
    load.mockResolvedValue({ ...claimedRecord, decision: 'approved', status: 'resuming' });
    findMessagePlugin.mockResolvedValue({
      intervention: { kind: 'approval', status: 'pending' },
    });
    await restoreDingTalkApprovalTimers();
    expect(revert).toHaveBeenCalled();
    expect(handleSubscribedMessage).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });

  it('finalizes a resuming card when the tool row is already resolved', async () => {
    scan.mockResolvedValueOnce(['0', [key]]);
    load.mockResolvedValue({ ...claimedRecord, decision: 'approved', status: 'resuming' });
    findMessagePlugin.mockResolvedValue({
      intervention: { kind: 'approval', status: 'approved' },
    });
    await restoreDingTalkApprovalTimers();
    expect(finalize).toHaveBeenCalled();
    expect(revert).not.toHaveBeenCalled();
    expect(handleSubscribedMessage).not.toHaveBeenCalled();
  });

  it('rejects an overdue resuming card with 超时未确认', async () => {
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValue(CONFIRM_CONFIG as never);
    scan.mockResolvedValueOnce(['0', [key]]);
    load.mockResolvedValue({
      ...claimedRecord,
      decision: 'approved',
      expiresAt: Date.now() - 1000,
      status: 'resuming',
    });
    findMessagePlugin.mockResolvedValue({
      intervention: { kind: 'approval', status: 'pending' },
    });
    await restoreDingTalkApprovalTimers();
    expect(handleSubscribedMessage).toHaveBeenCalled();
    const opts = handleSubscribedMessage.mock.calls[0]?.[2] as {
      resumeApproval?: { decision?: string; rejectionReason?: string };
    };
    expect(opts.resumeApproval).toEqual(
      expect.objectContaining({
        decision: 'rejected_continue',
        rejectionReason: '超时未确认',
      }),
    );
    expect(updateCard).toHaveBeenCalledWith(expect.anything(), 'confirm-1', {
      status: 'reject',
      statusText: '已失效（超时未确认）',
    });
  });
});

describe('forwardDingTalkWaitingHuman preview', () => {
  const approveArgs = {
    processInstanceId: 'proc-inst-999',
    remark: '同意结案',
    taskId: '99887766',
  };

  const sendWaiting = (tool: {
    apiName: string;
    args: Record<string, unknown>;
    identifier: string;
  }) =>
    forwardDingTalkWaitingHuman(
      'dingtalk:cid:staff_1',
      {
        finalState: {
          pendingHumanToolMessages: [
            { kind: 'approval', messageId: 'msg_tool', toolCallId: 'call_1' },
          ],
          pendingToolsCalling: [
            {
              apiName: tool.apiName,
              arguments: JSON.stringify(tool.args),
              id: 'call_1',
              identifier: tool.identifier,
            },
          ],
        },
        operationId: 'op_1',
        topicId: 'topic_1',
      },
      { agentId: 'agt_1', userId: 'user_1' },
    );

  const sentCard = () =>
    (
      sendCard.mock.calls[0]?.[1] as {
        card: {
          allowApprove?: boolean;
          content: string;
          note?: string;
          status: string;
          statusText?: string;
          title: string;
        };
      }
    ).card;

  const savedRecord = () => save.mock.calls[0]?.[0] as Record<string, unknown>;

  beforeEach(() => {
    vi.mocked(getMessengerDingTalkConfig).mockResolvedValue(CONFIRM_CONFIG as never);
  });

  it('shows the resolved approveTask name, stores it, and does not preview again on click', async () => {
    approvalPreview.mockResolvedValue({
      actingAs: { deptPath: '财务部', name: '陈柠' },
      danger: false,
      lines: [
        { label: '审批单', value: '胡永静提交的付款审批单' },
        { label: '结果', value: '同意' },
        { label: '意见', value: '同意结案' },
      ],
      title: '同意「胡永静提交的付款审批单」',
      warnings: [],
    });

    await sendWaiting({
      apiName: 'approveTask',
      args: approveArgs,
      identifier: 'lobe-dingtalk-approval',
    });

    expect(approvalPreview).toHaveBeenCalledTimes(1);
    expect(approvalPreview).toHaveBeenCalledWith({ apiName: 'approveTask', args: approveArgs });
    expect(approvalCtor).toHaveBeenCalledWith({}, 'user_1');
    expect(todoPreview).not.toHaveBeenCalled();
    expect(calendarPreview).not.toHaveBeenCalled();
    const card = sentCard();
    expect(card.title).toBe('同意「胡永静提交的付款审批单」');
    expect(card.allowApprove).toBe(true);
    expect(card.status).toBe('');
    expect(card.statusText).toBe('待确认');
    expect(card.note).toBe('仅发起人可操作');
    expect(card.content).toBe(
      ['审批单：胡永静提交的付款审批单', '结果：同意', '意见：同意结案'].join('\n'),
    );
    expect(card.content).not.toContain('99887766');
    expect(card.content).not.toContain('proc-inst-999');

    const saved = savedRecord();
    expect(saved.cardContent).toBe(card.content);
    expect(saved.cardTitle).toBe(card.title);
    load.mockResolvedValue({ ...saved, status: 'pending' });
    claim.mockResolvedValue({
      outcome: 'claimed',
      record: { ...saved, decision: 'approved', status: 'resuming' },
    });
    const result = await applyDingTalkConfirmClick({
      decision: 'approve',
      outTrackId: String(saved.outTrackId),
      userId: 'staff_1',
    });
    expect(result).toBe('applied');
    expect(approvalPreview).toHaveBeenCalledTimes(1);
    expect(updateCard).toHaveBeenCalledWith(expect.anything(), saved.outTrackId, {
      status: 'agree',
      statusText: '已批准，执行中…',
    });
  });

  it('disables 批准 when the preview throws and keeps the web link', async () => {
    approvalPreview.mockRejectedValue(
      Object.assign(new Error('not found'), { code: 'DINGTALK_NOT_FOUND' }),
    );
    await sendWaiting({
      apiName: 'approveTask',
      args: approveArgs,
      identifier: 'lobe-dingtalk-approval',
    });

    const note = `无法解析操作对象（DINGTALK_NOT_FOUND），请到网页端确认：${topicLink()}`;
    const card = sentCard();
    expect(card.allowApprove).toBe(false);
    expect(card.status).toBe('');
    expect(card.statusText).toBe('请到网页端确认');
    expect(card.note).toBe(note);
    expect(card.content).toBe('无法解析操作对象（DINGTALK_NOT_FOUND）');
    expect(card.title).toBe('同意审批');
    expect(card.content).not.toContain('99887766');
    expect(card.note).not.toContain('99887766');
    const saved = savedRecord();
    expect(saved.approveOnCard).toBe(false);
    expect(saved.cardContent).toBe('无法解析操作对象（DINGTALK_NOT_FOUND）');

    load.mockResolvedValue(saved);
    const result = await applyDingTalkConfirmClick({
      decision: 'approve',
      outTrackId: String(saved.outTrackId),
      userId: 'staff_1',
    });
    expect(result).toBe('web_only');
    expect(claim).not.toHaveBeenCalled();
    expect(approvalPreview).toHaveBeenCalledTimes(1);
  });

  it('does not put an upstream message on the card when the failure has no code', async () => {
    approvalPreview.mockRejectedValue(new Error('upstream PROC-secret staff:abc'));
    await sendWaiting({
      apiName: 'approveTask',
      args: approveArgs,
      identifier: 'lobe-dingtalk-approval',
    });
    const card = sentCard();
    expect(card.allowApprove).toBe(false);
    expect(card.status).toBe('');
    expect(card.statusText).toBe('请到网页端确认');
    expect(card.note).toContain('无法解析操作对象（UNKNOWN）');
    expect(card.note).toContain(topicLink());
    expect(card.content).not.toContain('PROC-secret');
    expect(card.note).not.toContain('PROC-secret');
    expect(card.content).not.toContain('staff:abc');
    expect(card.note).not.toContain('staff:abc');
    expect(approvalPreview).toHaveBeenCalledTimes(1);
  });

  it('appends saveTemplate field details the preview dropped', async () => {
    approvalPreview.mockResolvedValue({
      danger: false,
      lines: [
        { label: '模板名称', value: '项目结案申请' },
        { label: '操作', value: '创建' },
        { label: '控件', value: '结果' },
      ],
      title: '创建模板「项目结案申请」',
      warnings: [],
    });
    await sendWaiting({
      apiName: 'saveTemplate',
      args: {
        fields: [
          {
            componentType: 'DDSelectField',
            defaultValue: '通过',
            label: '结果',
            options: ['通过', '驳回'],
            required: true,
          },
        ],
        name: '项目结案申请',
        processCode: 'PROC-9',
      },
      identifier: 'lobe-dingtalk-approval',
    });
    const card = sentCard();
    expect(card.title).toBe('创建模板「项目结案申请」');
    expect(card.content).toContain('选项：通过、驳回');
    expect(card.content).toContain('默认：通过');
    expect(card.content).toContain('- 结果（DDSelectField，必填）');
    expect(card.content).not.toContain('PROC-9');
    expect(approvalPreview).toHaveBeenCalledTimes(1);
  });

  it('resolves a calendar write through the calendar preview', async () => {
    calendarPreview.mockResolvedValue({
      danger: true,
      lines: [{ label: '日程', value: '周会' }],
      title: '删除日程',
      warnings: ['仅组织者可以更新或删除日程'],
    });
    await sendWaiting({
      apiName: 'deleteEvent',
      args: { eventId: 'evt-1' },
      identifier: 'lobe-dingtalk-workspace',
    });
    expect(calendarPreview).toHaveBeenCalledTimes(1);
    expect(calendarCtor).toHaveBeenCalledWith({}, 'user_1');
    expect(todoPreview).not.toHaveBeenCalled();
    expect(approvalPreview).not.toHaveBeenCalled();
    const card = sentCard();
    expect(card.title).toBe('删除日程');
    expect(card.content.startsWith('⚠️ 高风险操作\n日程：周会')).toBe(true);
    expect(card.content).toContain('⚠️ 仅组织者可以更新或删除日程');
    expect(card.content).not.toContain('evt-1');
  });

  it('does not approve a workspace call the preview cannot describe', async () => {
    await sendWaiting({
      apiName: 'listTodos',
      args: { taskId: 'task-secret' },
      identifier: 'lobe-dingtalk-workspace',
    });
    expect(todoPreview).not.toHaveBeenCalled();
    expect(calendarPreview).not.toHaveBeenCalled();
    const card = sentCard();
    expect(card.allowApprove).toBe(false);
    expect(card.status).toBe('');
    expect(card.note).toContain('无法解析操作对象（DINGTALK_INVALID）');
    expect(card.content).not.toContain('task-secret');
    expect(card.note).not.toContain('task-secret');
  });

  it('resolves a workspace todo through the todo preview once', async () => {
    todoPreview.mockResolvedValue({
      actingAs: { deptPath: '', name: '陈柠' },
      danger: false,
      lines: [{ label: '标题', value: '对账' }],
      title: '创建待办',
      warnings: ['仅能查看和编辑通过本应用创建的待办'],
    });
    await sendWaiting({
      apiName: 'createTodo',
      args: { subject: '对账', taskId: 'task-secret' },
      identifier: 'lobe-dingtalk-workspace',
    });
    expect(todoPreview).toHaveBeenCalledTimes(1);
    expect(todoCtor).toHaveBeenCalledWith({}, 'user_1');
    expect(approvalPreview).not.toHaveBeenCalled();
    expect(calendarPreview).not.toHaveBeenCalled();
    const card = sentCard();
    expect(card.title).toBe('创建待办');
    expect(card.content).toContain('标题：对账');
    expect(card.content).toContain('⚠️ 仅能查看和编辑通过本应用创建的待办');
    expect(card.content).not.toContain('task-secret');
  });

  it('keeps both buttons when the summary does not fit and puts the web line in note', async () => {
    await sendWaiting({
      apiName: 'approveTask',
      args: { comment: '甲'.repeat(2000) },
      identifier: 'lobe-local-system',
    });
    const card = sentCard();
    expect(card.allowApprove).toBe(false);
    expect(card.status).toBe('');
    expect(card.statusText).toBe('请到网页端确认');
    expect(card.note).toContain('内容较长，完整内容请在网页端确认：');
    expect(card.note).toContain(topicLink());
    expect(card.content).not.toContain('内容较长，完整内容请在网页端确认：');
    expect([...card.content].length).toBeLessThanOrEqual(900);
    expect(savedRecord().approveOnCard).toBe(false);
  });

  it('keeps the generic summary for tools that are not DingTalk writes', async () => {
    await sendWaiting({
      apiName: 'approveTask',
      args: { comment: '同意结案', taskId: '99887766', title: '付款单' },
      identifier: 'lobe-local-system',
    });
    expect(approvalPreview).not.toHaveBeenCalled();
    expect(todoPreview).not.toHaveBeenCalled();
    expect(calendarPreview).not.toHaveBeenCalled();
    expect(approvalCtor).not.toHaveBeenCalled();
    const card = sentCard();
    expect(card.content).toContain('付款单');
    expect(card.content).toContain('同意结案');
    expect(card.content).not.toContain('99887766');
  });

  it('does not call a preview when the card cannot be sent', async () => {
    await forwardDingTalkWaitingHuman(
      'dingtalk:onlycid',
      {
        finalState: {
          pendingHumanToolMessages: [
            { kind: 'approval', messageId: 'msg_tool', toolCallId: 'call_1' },
          ],
          pendingToolsCalling: [
            {
              apiName: 'approveTask',
              arguments: JSON.stringify(approveArgs),
              id: 'call_1',
              identifier: 'lobe-dingtalk-approval',
            },
          ],
        },
        operationId: 'op_1',
        topicId: 'topic_1',
      },
      { agentId: 'agt_1', userId: 'user_1' },
    );
    expect(approvalPreview).not.toHaveBeenCalled();
    expect(sendCard).not.toHaveBeenCalled();
    expect(rejectPlugin).toHaveBeenCalled();
  });
});
