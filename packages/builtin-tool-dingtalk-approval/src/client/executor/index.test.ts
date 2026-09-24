/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchDirectory = vi.fn().mockResolvedValue({
  ambiguous: false,
  departments: [],
  users: [],
});
const approveTask = vi.fn();
const createApprovalRule = vi.fn();
const saveTemplate = vi.fn();

vi.mock('@/services/dingtalkApproval', () => ({
  dingtalkApprovalService: {
    addApprover: vi.fn(),
    approveTask,
    commentApproval: vi.fn(),
    createApprovalRule,
    deleteApprovalRule: vi.fn(),
    deleteTemplate: vi.fn(),
    getApprovalDetail: vi.fn(),
    getTemplateSchema: vi.fn(),
    listApprovalRules: vi.fn().mockResolvedValue([]),
    listMyApplications: vi.fn().mockResolvedValue([]),
    listPendingApprovals: vi.fn().mockResolvedValue([]),
    listTemplates: vi.fn().mockResolvedValue([]),
    refuseTask: vi.fn(),
    returnTask: vi.fn(),
    saveTemplate,
    searchDirectory,
    submitApproval: vi.fn(),
    transferTask: vi.fn(),
    updateApprovalRule: vi.fn(),
    withdrawApplication: vi.fn(),
  },
}));

const { dingtalkApprovalExecutor } = await import('./index');

describe('dingtalkApprovalExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchDirectory.mockResolvedValue({
      ambiguous: false,
      departments: [],
      users: [],
    });
  });

  it('passes { q, kind } to dingtalkApprovalService.searchDirectory', async () => {
    await dingtalkApprovalExecutor.searchDirectory({ kind: 'user', q: '安环' });
    expect(searchDirectory).toHaveBeenCalledWith({ kind: 'user', q: '安环' });
  });

  it('forwards approveTask ids', async () => {
    approveTask.mockResolvedValueOnce({ result: true });
    await dingtalkApprovalExecutor.approveTask({
      processInstanceId: 'pi-1',
      remark: 'ok',
      taskId: 't-1',
    });
    expect(approveTask).toHaveBeenCalledWith({
      processInstanceId: 'pi-1',
      remark: 'ok',
      taskId: 't-1',
    });
  });

  it('forwards createApprovalRule params and topicId from context', async () => {
    createApprovalRule.mockResolvedValueOnce({ id: 'rule-1' });
    await dingtalkApprovalExecutor.createApprovalRule(
      {
        action: 'agree',
        conditions: { match: 'all' },
        name: '自动同意请假',
        processCode: 'PROC',
        processName: '请假',
      },
      { topicId: 'topic-1' } as any,
    );
    expect(createApprovalRule).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'agree',
        name: '自动同意请假',
        processCode: 'PROC',
        topicId: 'topic-1',
      }),
    );
  });

  it('forwards saveTemplate format, unit, and bizAlias', async () => {
    saveTemplate.mockResolvedValueOnce({ notes: [], processCode: 'PROC' });
    const params = {
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
    };
    await dingtalkApprovalExecutor.saveTemplate(params);
    expect(saveTemplate).toHaveBeenCalledWith(params);
  });

  it('implements every API of the toolset, the batch writes included', () => {
    const apiNames = dingtalkApprovalExecutor.getApiNames();
    const executor = dingtalkApprovalExecutor as unknown as Record<string, unknown>;

    expect(apiNames).toEqual(expect.arrayContaining(['approveTasks', 'refuseTasks']));
    for (const apiName of apiNames) {
      expect(typeof executor[apiName], apiName).toBe('function');
    }
  });
});
