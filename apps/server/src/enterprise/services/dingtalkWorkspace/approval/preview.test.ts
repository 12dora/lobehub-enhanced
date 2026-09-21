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

vi.mock('../errors', () => ({ DingtalkWorkspaceError }));
vi.mock('../directory', () => ({
  resolveStaff: (...args: unknown[]) => mockResolveStaff(...args),
}));
vi.mock('../approvalRules', () => ({
  DingtalkApprovalRuleService: class {
    previewRule = (...args: unknown[]) => mockPreviewRule(...args);
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
      originatorUserId: 'me',
      processInstanceId: 'inst-1',
      status: 'RUNNING',
      tasks: [{ status: 'RUNNING', taskId: 't-1', userId: 'me' }],
      title: '出差申请',
    });
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
    const preview = await buildApprovalPreview(ctx, 'deleteApprovalRule', { id: 'rule-1' });
    expect(mockPreviewRule).not.toHaveBeenCalled();
    expect(preview.actingAs).toEqual({ deptPath: '产品部', name: '张三' });
    expect(preview.danger).toBe(true);
    expect(preview.lines[0]?.value).toBe('rule-1');
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
});
