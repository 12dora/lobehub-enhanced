// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListTemplates = vi.fn();
const mockListPending = vi.fn();
const mockListInitiated = vi.fn();
const mockExecuteTask = vi.fn();
const mockRuleCreate = vi.fn();
const mockRuleList = vi.fn();
const mockSaveTemplate = vi.fn();
const mockSearchDirectory = vi.fn();

vi.mock('@/server/enterprise/services/dingtalkWorkspace/approval', () => ({
  DingtalkApprovalService: vi.fn(() => ({
    addComment: vi.fn(),
    appendTask: vi.fn(),
    createInstance: vi.fn(),
    deleteTemplate: vi.fn(),
    executeTask: mockExecuteTask,
    getInstance: vi.fn(),
    getTemplateSchema: vi.fn(),
    listInitiated: mockListInitiated,
    listPending: mockListPending,
    listTemplates: mockListTemplates,
    redirectTask: vi.fn(),
    revertTask: vi.fn(),
    saveTemplate: mockSaveTemplate,
    terminateInstance: vi.fn(),
  })),
}));

vi.mock('@/server/enterprise/services/dingtalkWorkspace/approvalRules', () => ({
  DingtalkApprovalRuleService: vi.fn(() => ({
    create: mockRuleCreate,
    list: mockRuleList,
    remove: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock('@/server/enterprise/services/reminder', () => ({
  ReminderService: vi.fn(() => ({
    searchDirectory: mockSearchDirectory,
  })),
}));

const { dingtalkApprovalRuntime } = await import('../dingtalkApproval');

describe('dingtalkApprovalRuntime.factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListTemplates.mockResolvedValue([]);
    mockExecuteTask.mockResolvedValue({ result: true });
    mockRuleCreate.mockResolvedValue({ id: 'rule-1' });
    mockSearchDirectory.mockResolvedValue({ ambiguous: false, departments: [], users: [] });
  });

  it('uses a DingTalk SSO link when the chat is DingTalk', async () => {
    mockListTemplates.mockRejectedValueOnce(
      Object.assign(new Error('DINGTALK_IDENTITY_UNBOUND'), { code: 'DINGTALK_IDENTITY_UNBOUND' }),
    );
    const runtime = await dingtalkApprovalRuntime.factory({
      botPlatform: 'dingtalk',
      serverDB: {},
      userId: 'user-1',
    } as any);
    const result = await runtime.listTemplates();
    expect(result.content).toContain('[用钉钉登录](');
    expect(result.content).toContain('/dingtalk/sso?redirect=%2F');
    expect(result.content).not.toMatch(/\]\(<http/);
  });

  it('requires userId and serverDB', async () => {
    await expect(dingtalkApprovalRuntime.factory({} as any)).rejects.toThrow(
      'userId and serverDB are required',
    );
  });

  it('wires approval and rule services into the execution runtime', async () => {
    const runtime = await dingtalkApprovalRuntime.factory({
      serverDB: {},
      topicId: 'topic-1',
      userId: 'user-1',
    } as any);

    expect(dingtalkApprovalRuntime.identifier).toBe('lobe-dingtalk-approval');

    mockListTemplates.mockResolvedValueOnce([{ processCode: 'PROC', name: '请假' }]);
    const listed = await runtime.listTemplates({ q: '请假' });
    expect(listed.success).toBe(true);
    expect(mockListTemplates).toHaveBeenCalledWith({ q: '请假' });

    await runtime.approveTask({ processInstanceId: 'pi-1', taskId: 't-1' });
    expect(mockExecuteTask).toHaveBeenCalledWith({
      processInstanceId: 'pi-1',
      result: 'agree',
      taskId: 't-1',
    });

    await runtime.createApprovalRule({
      action: 'agree',
      conditions: { match: 'all' },
      name: '自动同意',
      processCode: 'PROC',
      processName: '请假',
    });
    expect(mockRuleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        createdByTopicId: 'topic-1',
        name: '自动同意',
      }),
    );
  });

  it('passes incomplete scan metadata through listPendingApprovals and listMyApplications', async () => {
    const incomplete = {
      reason: 'time_budget' as const,
      scannedTemplates: 4,
      totalTemplates: 20,
    };
    mockListPending.mockResolvedValueOnce({ incomplete, rows: [], truncated: true });
    mockListInitiated.mockResolvedValueOnce({ incomplete, rows: [], truncated: true });

    const runtime = await dingtalkApprovalRuntime.factory({
      serverDB: {},
      userId: 'user-1',
    } as any);

    const pending = await runtime.listPendingApprovals();
    expect(pending.state).toMatchObject({ incomplete, truncated: true });
    expect(pending.content).toContain('结果可能不完整:仅扫描了 4/20 个审批模板(超时)');

    const initiated = await runtime.listMyApplications();
    expect(initiated.state).toMatchObject({ incomplete, truncated: true });
    expect(initiated.content).toContain('结果可能不完整:仅扫描了 4/20 个审批模板(超时)');
  });

  it('forwards saveTemplate format, unit, and bizAlias', async () => {
    mockSaveTemplate.mockResolvedValueOnce({ notes: [], processCode: 'PROC' });
    const runtime = await dingtalkApprovalRuntime.factory({
      serverDB: {},
      userId: 'user-1',
    } as any);

    await runtime.saveTemplate({
      fields: [
        {
          bizAlias: 'startDate',
          componentType: 'DDDateField',
          format: 'yyyy-MM-dd',
          label: '开始日期',
          required: true,
        },
        { componentType: 'MoneyField', label: '金额', unit: '元' },
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

  it('forwards saveTemplate table columns', async () => {
    mockSaveTemplate.mockResolvedValueOnce({ notes: [], processCode: 'PROC' });
    const runtime = await dingtalkApprovalRuntime.factory({
      serverDB: {},
      userId: 'user-1',
    } as any);

    await runtime.saveTemplate({
      fields: [
        {
          children: [{ componentType: 'TextField', label: '名称' }],
          componentType: 'TableField',
          label: '明细',
        },
      ],
      name: '项目结案申请',
    });

    expect(mockSaveTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: [
          expect.objectContaining({
            children: [expect.objectContaining({ componentType: 'TextField', label: '名称' })],
            componentType: 'TableField',
            label: '明细',
          }),
        ],
      }),
    );
  });
});
