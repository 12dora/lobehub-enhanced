// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListTemplates = vi.fn();
const mockGetTemplateSchema = vi.fn();
const mockListPending = vi.fn();
const mockListInitiated = vi.fn();
const mockGetInstance = vi.fn();
const mockSearchDirectory = vi.fn();
const mockCreateInstance = vi.fn();
const mockExecuteTask = vi.fn();
const mockRedirectTask = vi.fn();
const mockAddComment = vi.fn();
const mockTerminateInstance = vi.fn();
const mockRevertTask = vi.fn();
const mockAppendTask = vi.fn();
const mockSaveTemplate = vi.fn();
const mockDeleteTemplate = vi.fn();
const mockPreview = vi.fn();

const mockRuleList = vi.fn();
const mockRuleCreate = vi.fn();
const mockRuleUpdate = vi.fn();
const mockRuleRemove = vi.fn();

class DingtalkWorkspaceError extends Error {
  readonly code: string;
  readonly candidates?: unknown;
  constructor(code: string, extras?: { candidates?: unknown }) {
    super(`upstream ${code}`);
    this.name = 'DingtalkWorkspaceError';
    this.code = code;
    this.candidates = extras?.candidates;
  }
}

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

vi.mock('@/server/enterprise/services/dingtalkWorkspace/errors', () => ({
  DingtalkWorkspaceError,
}));

vi.mock('@/server/enterprise/services/dingtalkWorkspace/approval', () => ({
  DingtalkApprovalService: vi.fn(() => ({
    addComment: mockAddComment,
    appendTask: mockAppendTask,
    createInstance: mockCreateInstance,
    deleteTemplate: mockDeleteTemplate,
    executeTask: mockExecuteTask,
    getInstance: mockGetInstance,
    getTemplateSchema: mockGetTemplateSchema,
    listInitiated: mockListInitiated,
    listPending: mockListPending,
    listTemplates: mockListTemplates,
    preview: mockPreview,
    redirectTask: mockRedirectTask,
    revertTask: mockRevertTask,
    saveTemplate: mockSaveTemplate,
    terminateInstance: mockTerminateInstance,
  })),
}));

vi.mock('@/server/enterprise/services/dingtalkWorkspace/approvalRules', () => ({
  DingtalkApprovalRuleService: vi.fn(() => ({
    create: mockRuleCreate,
    list: mockRuleList,
    remove: mockRuleRemove,
    update: mockRuleUpdate,
  })),
}));

vi.mock('@/server/enterprise/services/reminder', () => ({
  ReminderService: vi.fn(() => ({
    searchDirectory: mockSearchDirectory,
  })),
}));

const { dingtalkApprovalRouter } = await import('../dingtalkApproval');

const createCaller = () =>
  dingtalkApprovalRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);

describe('dingtalkApprovalRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates read/write approval APIs to DingtalkApprovalService', async () => {
    mockListTemplates.mockResolvedValueOnce([]);
    mockGetTemplateSchema.mockResolvedValueOnce({ fields: [] });
    mockListPending.mockResolvedValueOnce({ items: [], truncated: false });
    mockListInitiated.mockResolvedValueOnce([]);
    mockGetInstance.mockResolvedValueOnce({ processInstanceId: 'pi-1' });
    mockSearchDirectory.mockResolvedValueOnce({ users: [] });
    mockCreateInstance.mockResolvedValueOnce({ instanceId: 'pi-1' });
    mockExecuteTask.mockResolvedValueOnce({ result: true });
    mockPreview.mockResolvedValueOnce({ danger: false, lines: [], title: 't', warnings: [] });

    const caller = createCaller();
    await caller.listTemplates({ q: '请假' });
    await caller.getTemplateSchema({ processCode: 'PROC' });
    await caller.listPendingApprovals({ limit: 10 });
    await caller.listMyApplications({ status: 'RUNNING' });
    await caller.getApprovalDetail({ processInstanceId: 'pi-1' });
    await caller.searchDirectory({ q: '胡玉琴' });
    await caller.submitApproval({
      formValues: [{ label: '事由', value: '出差' }],
      processCode: 'PROC',
    });
    await caller.approveTask({ processInstanceId: 'pi-1', taskId: 't-1' });
    await caller.preview({ apiName: 'approveTask', args: { taskId: 't-1' } });

    expect(mockListTemplates).toHaveBeenCalledWith({ q: '请假' });
    expect(mockGetTemplateSchema).toHaveBeenCalledWith('PROC');
    expect(mockListPending).toHaveBeenCalledWith({ limit: 10 });
    expect(mockListInitiated).toHaveBeenCalledWith({ status: 'RUNNING' });
    expect(mockGetInstance).toHaveBeenCalledWith('pi-1');
    expect(mockSearchDirectory).toHaveBeenCalledWith('胡玉琴', undefined);
    expect(mockCreateInstance).toHaveBeenCalledWith({
      formValues: [{ label: '事由', value: '出差' }],
      processCode: 'PROC',
      targetSelectActioners: undefined,
    });
    expect(mockExecuteTask).toHaveBeenCalledWith({
      processInstanceId: 'pi-1',
      result: 'agree',
      taskId: 't-1',
    });
    expect(mockPreview).toHaveBeenCalledWith({ apiName: 'approveTask', args: { taskId: 't-1' } });
  });

  it('delegates rule APIs to DingtalkApprovalRuleService', async () => {
    mockRuleList.mockResolvedValueOnce([]);
    mockRuleCreate.mockResolvedValueOnce({ id: 'rule-1' });
    mockRuleUpdate.mockResolvedValueOnce({ id: 'rule-1' });
    mockRuleRemove.mockResolvedValueOnce({ success: true });

    const caller = createCaller();
    await caller.listApprovalRules({ includeDisabled: true });
    await caller.createApprovalRule({
      action: 'agree',
      conditions: { match: 'all' },
      name: '自动同意',
      processCode: 'PROC',
      processName: '请假',
    });
    await caller.updateApprovalRule({ enabled: false, id: 'rule-1' });
    await caller.deleteApprovalRule({ id: 'rule-1' });

    expect(mockRuleList).toHaveBeenCalledWith({ includeDisabled: true });
    await caller.listApprovalRules();
    expect(mockRuleList).toHaveBeenLastCalledWith({ includeDisabled: false });
    expect(mockRuleCreate).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agree', name: '自动同意', processCode: 'PROC' }),
    );
    expect(mockRuleCreate.mock.calls[0][0]).not.toHaveProperty('processName');
    expect(mockRuleUpdate).toHaveBeenCalledWith('rule-1', { enabled: false });
    expect(mockRuleRemove).toHaveBeenCalledWith('rule-1');
  });

  it('maps DingtalkWorkspaceError to a TRPC error carrying the stable code, never upstream text', async () => {
    mockExecuteTask.mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_NOT_TASK_OWNER'));

    await expect(
      createCaller().approveTask({ processInstanceId: 'pi-1', taskId: 't-1' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'DINGTALK_NOT_TASK_OWNER',
    });
  });

  it('attaches ambiguous candidates on DINGTALK_AMBIGUOUS without leaking upstream text', async () => {
    const candidates = [
      { deptPath: '安环部', name: '胡玉琴A', staffId: 's1' },
      { deptPath: '财务部', name: '胡玉琴A', staffId: 's2' },
    ];
    mockCreateInstance.mockRejectedValueOnce(
      new DingtalkWorkspaceError('DINGTALK_AMBIGUOUS', { candidates }),
    );

    await expect(
      createCaller().submitApproval({
        formValues: [{ label: '事由', value: '出差' }],
        processCode: 'PROC',
      }),
    ).rejects.toMatchObject({
      cause: { data: { candidates, code: 'DINGTALK_AMBIGUOUS' } },
      code: 'BAD_REQUEST',
      message: 'DINGTALK_AMBIGUOUS',
    });
  });

  it('maps unknown failures to DINGTALK_UNAVAILABLE', async () => {
    mockListTemplates.mockRejectedValueOnce(new Error('ECONNRESET token=abc'));

    await expect(createCaller().listTemplates()).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'DINGTALK_UNAVAILABLE',
    });
  });

  it('maps refuseTask to executeTask result=refuse', async () => {
    mockExecuteTask.mockResolvedValueOnce({ result: true });
    await createCaller().refuseTask({
      processInstanceId: 'pi-1',
      remark: '预算不足',
      taskId: 't-1',
    });
    expect(mockExecuteTask).toHaveBeenCalledWith({
      processInstanceId: 'pi-1',
      remark: '预算不足',
      result: 'refuse',
      taskId: 't-1',
    });
  });

  it('requires returnTask.remark and forwards it to revertTask', async () => {
    await expect(
      createCaller().returnTask({
        processInstanceId: 'pi-1',
        revertAction: 'REVERT_FOR_APPROVAL',
        targetActivityId: 'sid-xxx',
        taskId: 't-1',
      } as any),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    mockRevertTask.mockResolvedValueOnce({ result: true });
    await createCaller().returnTask({
      processInstanceId: 'pi-1',
      remark: '请补充发票',
      revertAction: 'REVERT_FOR_APPROVAL',
      targetActivityId: 'sid-xxx',
      taskId: 't-1',
    });
    expect(mockRevertTask).toHaveBeenCalledWith({
      processInstanceId: 'pi-1',
      remark: '请补充发票',
      revertAction: 'REVERT_FOR_APPROVAL',
      targetActivityId: 'sid-xxx',
      taskId: 't-1',
    });
  });

  it('forwards saveTemplate format, unit, and bizAlias', async () => {
    mockSaveTemplate.mockResolvedValueOnce({ notes: [], processCode: 'PROC' });
    await createCaller().saveTemplate({
      fields: [
        {
          bizAlias: 'startDate',
          componentType: 'DDDateField',
          format: 'yyyy-MM-dd',
          label: '开始日期',
          required: true,
        },
        {
          componentType: 'MoneyField',
          label: '金额',
          unit: '元',
        },
      ],
      name: '费用报销',
    });
    expect(mockSaveTemplate).toHaveBeenCalledWith({
      description: undefined,
      fields: [
        {
          bizAlias: 'startDate',
          componentId: undefined,
          componentType: 'DDDateField',
          format: 'yyyy-MM-dd',
          label: '开始日期',
          options: undefined,
          placeholder: undefined,
          required: true,
          unit: undefined,
        },
        {
          bizAlias: undefined,
          componentId: undefined,
          componentType: 'MoneyField',
          format: undefined,
          label: '金额',
          options: undefined,
          placeholder: undefined,
          required: undefined,
          unit: '元',
        },
      ],
      name: '费用报销',
      processCode: undefined,
    });
  });
});
