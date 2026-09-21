// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListTemplates = vi.fn();
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
    listInitiated: vi.fn(),
    listPending: vi.fn(),
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
});
