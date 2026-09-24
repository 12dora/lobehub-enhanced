// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

class DingtalkWorkspaceError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'DingtalkWorkspaceError';
    this.code = code;
  }
}

const mockGetSchema = vi.fn();
const mockGetDetail = vi.fn();
const mockResolveStaff = vi.fn();
const mockPreviewRule = vi.fn();
const mockGetRule = vi.fn();
const mockListTemplates = vi.fn();

vi.mock('../errors', () => ({ DingtalkWorkspaceError }));
vi.mock('../directory', () => ({
  resolveStaff: (...args: unknown[]) => mockResolveStaff(...args),
}));
vi.mock('../approvalRules', () => ({
  DingtalkApprovalRuleService: class {
    get = (...args: unknown[]) => mockGetRule(...args);
    previewRule = (...args: unknown[]) => mockPreviewRule(...args);
  },
}));
vi.mock('./service', () => ({
  DingtalkApprovalService: class {
    listTemplates = (...args: unknown[]) => mockListTemplates(...args);
  },
}));
vi.mock('./api', () => ({
  getFormSchema: (...args: unknown[]) => mockGetSchema(...args),
  getInstanceDetail: (...args: unknown[]) => mockGetDetail(...args),
}));

const { buildApprovalPreview } = await import('./preview');

const ctx = {
  db: {} as never,
  identity: { name: '张三', staffId: 'me', unionId: 'u' },
  userId: 'user-1',
};

describe('buildApprovalPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveStaff.mockResolvedValue({
      deptPath: '产品部',
      name: '张三',
      staffId: 'me',
    });
    mockGetSchema.mockResolvedValue({
      fields: [
        { componentId: 'TextField-1', componentType: 'TextField', label: '事由', required: true },
      ],
      name: '出差',
      processCode: 'PROC-1',
    });
    mockGetDetail.mockResolvedValue({
      ccUserIds: [],
      formComponentValues: [],
      operationRecords: [],
      originatorName: '张三',
      originatorUserId: 'me',
      processInstanceId: 'inst-1',
      status: 'RUNNING',
      tasks: [{ status: 'RUNNING', taskId: 't-1', userId: 'me' }],
      title: '出差申请',
    });
    mockListTemplates.mockResolvedValue([{ name: '出差', processCode: 'PROC-1' }]);
    mockGetRule.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_NOT_FOUND'));
  });

  it('marks refuse as danger and includes the instance title', async () => {
    const preview = await buildApprovalPreview(ctx, 'refuseTask', {
      processInstanceId: 'inst-1',
      remark: '预算不足',
      taskId: 't-1',
    });
    expect(preview.danger).toBe(true);
    expect(preview.actingAs).toEqual({ deptPath: '产品部', name: '张三' });
    expect(preview.lines.some((line) => line.value.includes('出差申请'))).toBe(true);
  });

  it('delegates rule APIs to DingtalkApprovalRuleService.previewRule', async () => {
    mockPreviewRule.mockResolvedValueOnce({
      actingAs: { deptPath: '产品部', name: '张三' },
      danger: true,
      lines: [{ label: '动作', value: '拒绝' }],
      title: '规则',
      warnings: [],
    });
    const preview = await buildApprovalPreview(ctx, 'createApprovalRule', {
      action: 'refuse',
      conditions: { fields: [], match: 'all' },
      name: '自动拒绝',
      processCode: 'PROC-1',
    });
    expect(mockPreviewRule).toHaveBeenCalled();
    expect(preview.actingAs).toEqual({ deptPath: '产品部', name: '张三' });
    expect(preview.danger).toBe(true);
    expect(preview.title).toBe('规则');
  });

  it('marks deleteApprovalRule as danger without calling previewRule', async () => {
    mockGetRule.mockResolvedValueOnce({
      action: 'refuse',
      conditions: { fields: [], match: 'all' },
      enabled: true,
      id: 'rule-1',
      name: '自动拒绝出差',
      processName: '出差',
      redirectToName: null,
    });
    const preview = await buildApprovalPreview(ctx, 'deleteApprovalRule', { id: 'rule-1' });
    expect(mockPreviewRule).not.toHaveBeenCalled();
    expect(mockGetRule).toHaveBeenCalledWith('rule-1');
    expect(preview.actingAs).toEqual({ deptPath: '产品部', name: '张三' });
    expect(preview.danger).toBe(true);
    expect(preview.title).toBe('删除规则「自动拒绝出差」');
    expect(preview.lines).toEqual([
      { label: '规则名称', value: '自动拒绝出差' },
      { label: '审批模板', value: '出差' },
      { label: '条件摘要', value: '全部待办' },
      { label: '动作', value: '拒绝' },
    ]);
    expect(JSON.stringify(preview)).not.toContain('rule-1');
  });

  it('throws DINGTALK_NOT_FOUND when deleting an unknown rule', async () => {
    await expect(
      buildApprovalPreview(ctx, 'deleteApprovalRule', { id: 'missing' }),
    ).rejects.toMatchObject({ code: 'DINGTALK_NOT_FOUND' });
  });

  it('shows updateApprovalRule diffs in Chinese without raw action ids', async () => {
    mockGetRule.mockResolvedValueOnce({
      action: 'agree',
      conditions: { fields: [], match: 'all' },
      enabled: true,
      id: 'rule-1',
      name: '自动同意',
      processCode: 'PROC-1',
      processName: '出差',
      redirectToName: '李四',
    });
    mockResolveStaff.mockImplementation(async (_db, token: string) => {
      if (String(token).includes('wang')) {
        return { deptPath: '财务部', name: '王五', staffId: 'staff-wang' };
      }
      return { deptPath: '产品部', name: '张三', staffId: 'me' };
    });
    const preview = await buildApprovalPreview(ctx, 'updateApprovalRule', {
      action: 'redirect',
      enabled: false,
      id: 'rule-1',
      name: '转交财务',
      redirectToStaffToken: 'staff:staff-wang',
    });
    expect(mockPreviewRule).not.toHaveBeenCalled();
    expect(preview.title).toBe('更新规则「转交财务」');
    expect(preview.danger).toBe(true);
    expect(preview.lines).toEqual([
      { label: '规则名称', value: '自动同意 → 转交财务' },
      { label: '动作', value: '同意 → 转交给 王五' },
      { label: '状态', value: '启用 → 停用' },
    ]);
    expect(JSON.stringify(preview.lines)).not.toContain('agree');
    expect(JSON.stringify(preview.lines)).not.toContain('redirect');
  });

  it('resolves deleteTemplate title from the cached visible list', async () => {
    mockListTemplates.mockResolvedValueOnce([
      { name: '设备转租审批', processCode: 'PROC-84322A73-E989-4C4E-B178-C4BA2EE5ECBB' },
    ]);
    const preview = await buildApprovalPreview(ctx, 'deleteTemplate', {
      processCode: 'PROC-84322A73-E989-4C4E-B178-C4BA2EE5ECBB',
    });
    expect(preview.title).toBe('删除模板「设备转租审批」');
    expect(preview.danger).toBe(true);
    expect(preview.lines).toEqual([{ label: '模板名称', value: '设备转租审批' }]);
    expect(preview.title).not.toContain('PROC-');
    expect(mockGetSchema).not.toHaveBeenCalled();
  });

  it('falls back to schema name and field count when the template is not cached', async () => {
    mockListTemplates.mockResolvedValueOnce([]);
    mockGetSchema.mockResolvedValueOnce({
      fields: [
        { componentId: 'a', componentType: 'TextField', label: '事由', required: true },
        { componentId: 'b', componentType: 'NumberField', label: '金额', required: false },
      ],
      name: '费用报销',
      processCode: 'PROC-X',
    });
    const preview = await buildApprovalPreview(ctx, 'deleteTemplate', { processCode: 'PROC-X' });
    expect(preview.title).toBe('删除模板「费用报销」');
    expect(preview.lines).toEqual([
      { label: '模板名称', value: '费用报销' },
      { label: '字段数', value: '2' },
    ]);
  });

  it('throws DINGTALK_NOT_FOUND instead of previewing an unknown processCode', async () => {
    mockListTemplates.mockResolvedValueOnce([]);
    mockGetSchema.mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_NOT_FOUND'));
    await expect(
      buildApprovalPreview(ctx, 'deleteTemplate', {
        processCode: 'PROC-84322A73-E989-4C4E-B178-C4BA2EE5ECBB',
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_NOT_FOUND' });
  });

  it('resolves revert target activity names and never prints the activity id', async () => {
    mockGetDetail.mockResolvedValueOnce({
      ccUserIds: [],
      formComponentValues: [],
      operationRecords: [],
      originatorUserId: 'me',
      processInstanceId: 'inst-1',
      status: 'RUNNING',
      tasks: [
        {
          activityId: 'sid-approver',
          activityName: '主管审批',
          status: 'RUNNING',
          taskId: 't-1',
          userId: 'me',
        },
      ],
      title: '出差申请',
    });
    const preview = await buildApprovalPreview(ctx, 'returnTask', {
      processInstanceId: 'inst-1',
      revertAction: 'REVERT_FOR_APPROVAL',
      targetActivityId: 'sid-approver',
      taskId: 't-1',
    });
    expect(preview.lines).toEqual(
      expect.arrayContaining([
        { label: '审批单', value: '出差申请' },
        { label: '退回至', value: '主管审批' },
      ]),
    );
    expect(JSON.stringify(preview.lines)).not.toContain('sid-approver');
  });

  it('falls back to 指定节点 when the revert activity name is unknown', async () => {
    const preview = await buildApprovalPreview(ctx, 'returnTask', {
      processInstanceId: 'inst-1',
      revertAction: 'REVERT_FOR_APPROVAL',
      targetActivityId: 'sid-unknown',
      taskId: 't-1',
    });
    expect(preview.lines).toEqual(expect.arrayContaining([{ label: '退回至', value: '指定节点' }]));
    expect(JSON.stringify(preview.lines)).not.toContain('sid-unknown');
  });

  it('does not fall back 审批单 to the processInstanceId', async () => {
    mockGetDetail.mockResolvedValueOnce({
      ccUserIds: [],
      formComponentValues: [],
      operationRecords: [],
      originatorName: '李四',
      originatorUserId: 'me',
      processInstanceId: 'inst-secret',
      processName: '请假',
      status: 'RUNNING',
      tasks: [{ status: 'RUNNING', taskId: 't-1', userId: 'me' }],
      title: '',
    });
    const preview = await buildApprovalPreview(ctx, 'approveTask', {
      processInstanceId: 'inst-secret',
      taskId: 't-1',
    });
    expect(preview.lines).toEqual(
      expect.arrayContaining([{ label: '审批单', value: '请假 · 李四' }]),
    );
    expect(preview.title).toBe('同意「请假 · 李四」');
    expect(JSON.stringify(preview)).not.toContain('inst-secret');
  });

  it('throws the same validation error create would throw for a suite template', async () => {
    mockGetSchema.mockResolvedValueOnce({
      bizType: 'hrm.leave',
      fields: [
        { componentId: 'TextField-1', componentType: 'TextField', label: '事由', required: true },
      ],
      name: '请假',
      processCode: 'PROC-LEAVE',
    });
    await expect(
      buildApprovalPreview(ctx, 'submitApproval', {
        formValues: [{ label: '事由', value: 'x' }],
        processCode: 'PROC-LEAVE',
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_INVALID' });
  });

  it('lists a detail table by name and column labels', async () => {
    const preview = await buildApprovalPreview(ctx, 'saveTemplate', {
      fields: [
        { componentType: 'TextField', label: '项目名称' },
        {
          children: [
            { componentType: 'TextField', label: '交付物' },
            { componentType: 'TextField', label: '接收人' },
          ],
          componentType: 'TableField',
          label: '交付物及移交清单',
        },
      ],
      name: '项目结案申请',
    });
    const controls = preview.lines.find((line) => line.label === '控件');
    expect(controls?.value).toContain('项目名称');
    expect(controls?.value).toContain('交付物及移交清单（交付物、接收人）');
    expect(preview.warnings?.[0]).toContain('https://oa.dingtalk.com/');
    expect(preview.warnings?.[0]).not.toMatch(/\]\(/);
  });

  it('forbids comment preview when the caller cannot view the instance', async () => {
    mockGetDetail.mockResolvedValueOnce({
      ccUserIds: [],
      formComponentValues: [],
      originatorUserId: 'other',
      processInstanceId: 'inst-x',
      status: 'RUNNING',
      tasks: [{ status: 'COMPLETED', taskId: 't-9', userId: 'other' }],
      title: '机密',
    });
    await expect(
      buildApprovalPreview(ctx, 'commentApproval', {
        processInstanceId: 'inst-x',
        text: 'x',
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_FORBIDDEN' });
  });

  it('preview(approveTasks) numbers each subject and shows the shared remark', async () => {
    mockGetDetail.mockImplementation(async (processInstanceId: string) => ({
      ccUserIds: [],
      formComponentValues: [],
      operationRecords: [],
      originatorUserId: 'me',
      processInstanceId,
      status: 'RUNNING',
      tasks: [
        {
          status: 'RUNNING',
          taskId: processInstanceId === 'inst-2' ? 't-2' : 't-1',
          userId: 'me',
        },
      ],
      title: processInstanceId === 'inst-2' ? '报销' : '出差申请',
    }));
    const preview = await buildApprovalPreview(ctx, 'approveTasks', {
      remark: '请尽快',
      tasks: [
        { processInstanceId: 'inst-1', taskId: 't-1' },
        { processInstanceId: 'inst-2', taskId: 't-2' },
      ],
    });
    expect(preview.danger).toBe(false);
    expect(preview.title).toBe('同意 2 项审批');
    expect(preview.lines).toEqual([
      { label: '审批单', value: '1. 出差申请' },
      { label: '审批单', value: '2. 报销' },
      { label: '意见', value: '请尽快' },
    ]);
    expect(preview.warnings).toEqual([]);
    expect(JSON.stringify(preview)).not.toContain('inst-1');
  });

  it('preview(refuseTasks) is dangerous and fails like a single refuse when anything is unresolved', async () => {
    const preview = await buildApprovalPreview(ctx, 'refuseTasks', {
      remark: '预算不足',
      tasks: [{ processInstanceId: 'inst-1', taskId: 't-1' }],
    });
    expect(preview.danger).toBe(true);
    expect(preview.title).toBe('拒绝 1 项审批');
    expect(preview.lines).toEqual([
      { label: '审批单', value: '1. 出差申请' },
      { label: '意见', value: '预算不足' },
    ]);
    expect(preview.warnings).toEqual(['拒绝后该审批单将结束。']);

    mockGetDetail.mockClear();
    await expect(
      buildApprovalPreview(ctx, 'refuseTasks', {
        tasks: [{ processInstanceId: 'inst-1', taskId: 't-1' }],
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_INVALID' });
    expect(mockGetDetail).not.toHaveBeenCalled();

    mockGetDetail.mockResolvedValueOnce({
      ccUserIds: [],
      formComponentValues: [],
      operationRecords: [],
      originatorUserId: 'me',
      processInstanceId: 'inst-1',
      status: 'RUNNING',
      tasks: [{ status: 'RUNNING', taskId: 't-1', userId: 'someone-else' }],
      title: '出差申请',
    });
    await expect(
      buildApprovalPreview(ctx, 'approveTasks', {
        tasks: [{ processInstanceId: 'inst-1', taskId: 't-1' }],
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_NOT_TASK_OWNER' });
  });
});
