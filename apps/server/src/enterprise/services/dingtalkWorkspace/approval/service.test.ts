// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ErrorsModule from '../errors';

class DingtalkWorkspaceError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'DingtalkWorkspaceError';
    this.code = code;
  }
}

const mockAssertFeature = vi.fn();
const mockRequireIdentity = vi.fn();
const mockIsAdmin = vi.fn();
const mockResolveStaff = vi.fn();
const mockGetSchema = vi.fn();
const mockGetDetail = vi.fn();
const mockExecute = vi.fn();
const mockRedirect = vi.fn();
const mockComment = vi.fn();
const mockStart = vi.fn();
const mockForecast = vi.fn();
const mockTerminate = vi.fn();
const mockSaveForm = vi.fn();
const mockDeleteForm = vi.fn();
const mockAppendAudit = vi.fn();
const mockListPending = vi.fn();
const mockLoadTemplates = vi.fn();
const mockInvalidate = vi.fn();
const mockInvalidateInstance = vi.fn();
const mockRevert = vi.fn();
const mockAppend = vi.fn();
const mockGetUsers = vi.fn();

vi.mock('../errors', async () => {
  const actual = await vi.importActual<typeof ErrorsModule>('../errors');
  return {
    DingtalkWorkspaceError,
    sanitizeDingtalkApplyUrl: actual.sanitizeDingtalkApplyUrl,
  };
});
vi.mock('../capabilities', () => ({
  assertDingtalkFeature: (...args: unknown[]) => mockAssertFeature(...args),
}));
vi.mock('../identity', () => ({
  isDingtalkApprovalAdmin: (...args: unknown[]) => mockIsAdmin(...args),
  requireVerifiedDingtalkIdentity: (...args: unknown[]) => mockRequireIdentity(...args),
}));
vi.mock('../directory', () => ({
  resolveStaff: (...args: unknown[]) => mockResolveStaff(...args),
}));
vi.mock('@/database/models/dingtalkDirectory', () => ({
  DingTalkDirectoryModel: class {
    getUsers = (...args: unknown[]) => mockGetUsers(...args);
  },
}));
vi.mock('../../platformAudit', () => ({
  PlatformAuditService: class {
    append = (...args: unknown[]) => mockAppendAudit(...args);
  },
}));
vi.mock('./api', () => ({
  addCommentAs: (...args: unknown[]) => mockComment(...args),
  appendTaskAs: (...args: unknown[]) => mockAppend(...args),
  deleteFormTemplate: (...args: unknown[]) => mockDeleteForm(...args),
  executeTaskAs: (...args: unknown[]) => mockExecute(...args),
  forecastProcess: (...args: unknown[]) => mockForecast(...args),
  getFormSchema: (...args: unknown[]) => mockGetSchema(...args),
  getInstanceDetail: (...args: unknown[]) => mockGetDetail(...args),
  redirectTaskAs: (...args: unknown[]) => mockRedirect(...args),
  revertTaskAs: (...args: unknown[]) => mockRevert(...args),
  saveFormTemplate: (...args: unknown[]) => mockSaveForm(...args),
  startProcessInstance: (...args: unknown[]) => mockStart(...args),
  terminateProcessInstance: (...args: unknown[]) => mockTerminate(...args),
}));
vi.mock('./pending', () => ({
  invalidateApprovalListCache: (...args: unknown[]) => mockInvalidate(...args),
  invalidateApprovalInstanceCache: (...args: unknown[]) => mockInvalidateInstance(...args),
  invalidatePendingCaches: (...args: unknown[]) => mockInvalidate(...args),
  listInitiatedApprovals: vi.fn(),
  listPendingApprovals: (...args: unknown[]) => mockListPending(...args),
  loadVisibleTemplatesCached: (...args: unknown[]) => mockLoadTemplates(...args),
}));
vi.mock('../approvalRules', () => ({
  DingtalkApprovalRuleService: class {
    previewRule = vi.fn();
  },
}));

const { DingtalkApprovalService } = await import('./service');

const identity = { name: '张三', staffId: 'me', unionId: 'u-me' };
const runningDetail = {
  ccUserIds: [],
  formComponentValues: [{ name: '事由', value: '出差' }],
  originatorUserId: 'other',
  processInstanceId: 'inst-1',
  status: 'RUNNING',
  tasks: [{ status: 'RUNNING', taskId: 't-1', userId: 'me' }],
  title: '出差申请',
};

describe('DingtalkApprovalService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertFeature.mockResolvedValue(undefined);
    mockRequireIdentity.mockResolvedValue(identity);
    mockIsAdmin.mockResolvedValue(true);
    mockLoadTemplates.mockResolvedValue([{ name: '出差', processCode: 'PROC-1' }]);
    mockAppendAudit.mockResolvedValue(undefined);
    mockExecute.mockResolvedValue({ result: true });
    mockRedirect.mockResolvedValue({ result: true });
    mockComment.mockResolvedValue({ result: true });
    mockStart.mockResolvedValue({ instanceId: 'inst-new' });
    mockForecast.mockResolvedValue({ workflowActivityRules: [] });
    mockRevert.mockResolvedValue({ result: true });
    mockAppend.mockResolvedValue({ result: true });
    mockResolveStaff.mockResolvedValue({ deptPath: 'A', name: '李四', staffId: 'staff-2' });
    mockGetUsers.mockResolvedValue([]);
    mockGetSchema.mockResolvedValue({
      fields: [
        { componentId: 'TextField-1', componentType: 'TextField', label: '事由', required: true },
      ],
      name: '出差',
      processCode: 'PROC-1',
    });
  });

  it('asserts the approval feature and verified identity on every call', async () => {
    mockListPending.mockResolvedValue({ rows: [], truncated: false });
    const service = new DingtalkApprovalService({} as never, 'user-1');
    await service.listPending();
    expect(mockAssertFeature).toHaveBeenCalledWith('approval');
    expect(mockRequireIdentity).toHaveBeenCalled();
  });

  it('bypasses the visible-template cache when listPending is refreshed', async () => {
    mockListPending.mockResolvedValue({ rows: [], truncated: false });
    const service = new DingtalkApprovalService({} as never, 'user-1');
    await service.listPending({ limit: 10 });
    expect(mockLoadTemplates).toHaveBeenCalledWith('user-1', 'me', 5 * 60_000, false);
    await service.listPending({ refresh: true });
    expect(mockLoadTemplates).toHaveBeenLastCalledWith('user-1', 'me', 5 * 60_000, true);
    expect(mockListPending).toHaveBeenLastCalledWith(
      expect.objectContaining({ refresh: true, staffId: 'me', userId: 'user-1' }),
    );
  });

  it('refuses executeTask when the caller is not the running handler', async () => {
    mockGetDetail.mockResolvedValueOnce({
      ...runningDetail,
      tasks: [{ status: 'RUNNING', taskId: 't-1', userId: 'someone-else' }],
    });
    const service = new DingtalkApprovalService({} as never, 'user-1');
    await expect(
      service.executeTask({ processInstanceId: 'inst-1', result: 'agree', taskId: 't-1' }),
    ).rejects.toMatchObject({ code: 'DINGTALK_NOT_TASK_OWNER' });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('executes agree after re-fetching ownership and writes audit without form payload', async () => {
    mockGetDetail.mockResolvedValueOnce(runningDetail);
    const service = new DingtalkApprovalService({} as never, 'user-1');
    await service.executeTask({ processInstanceId: 'inst-1', result: 'agree', taskId: 't-1' });
    expect(mockGetDetail).toHaveBeenCalledWith('inst-1', { fresh: true });
    expect(mockExecute).toHaveBeenCalledWith('me', {
      processInstanceId: 'inst-1',
      remark: undefined,
      result: 'agree',
      taskId: 't-1',
    });
    expect(mockAppendAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'dingtalk.approval.agree',
        actorUserId: 'user-1',
        afterDiff: { title: '出差申请' },
        targetId: 'inst-1',
        targetType: 'dingtalk_approval',
      }),
    );
  });

  it('approve batch reuses execute, shares the remark, and invalidates once', async () => {
    mockGetDetail.mockImplementation(async (processInstanceId: string) => ({
      ...runningDetail,
      processInstanceId,
      tasks: [
        {
          status: 'RUNNING',
          taskId: processInstanceId === 'inst-2' ? 't-2' : 't-1',
          userId: 'me',
        },
      ],
      title: processInstanceId === 'inst-2' ? '报销' : '出差申请',
    }));
    const service = new DingtalkApprovalService({} as never, 'user-1');
    const result = await service.executeTasks({
      remark: '同意',
      result: 'agree',
      tasks: [
        { processInstanceId: 'inst-1', taskId: 't-1' },
        { processInstanceId: 'inst-2', taskId: 't-2' },
      ],
    });
    expect(result.items).toEqual([
      { id: 't-1', ok: true, title: '出差申请' },
      { id: 't-2', ok: true, title: '报销' },
    ]);
    expect(mockExecute).toHaveBeenNthCalledWith(1, 'me', {
      processInstanceId: 'inst-1',
      remark: '同意',
      result: 'agree',
      taskId: 't-1',
    });
    expect(mockExecute).toHaveBeenNthCalledWith(2, 'me', {
      processInstanceId: 'inst-2',
      remark: '同意',
      result: 'agree',
      taskId: 't-2',
    });
    expect(mockGetDetail.mock.invocationCallOrder[0]).toBeLessThan(
      mockExecute.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mockExecute.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetDetail.mock.invocationCallOrder[1] ?? 0,
    );
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
    expect(mockInvalidate).toHaveBeenCalledWith('user-1');
  });

  it('stops an approval batch on rate limit and marks the rest 未执行', async () => {
    mockGetDetail.mockResolvedValue({
      ...runningDetail,
      tasks: [
        { status: 'RUNNING', taskId: 't-1', userId: 'me' },
        { status: 'RUNNING', taskId: 't-2', userId: 'me' },
        { status: 'RUNNING', taskId: 't-3', userId: 'me' },
      ],
    });
    mockExecute
      .mockResolvedValueOnce({ result: true })
      .mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_RATE_LIMITED'));
    const service = new DingtalkApprovalService({} as never, 'user-1');
    const result = await service.executeTasks({
      result: 'agree',
      tasks: [
        { processInstanceId: 'inst-1', taskId: 't-1' },
        { processInstanceId: 'inst-1', taskId: 't-2' },
        { processInstanceId: 'inst-1', taskId: 't-3' },
      ],
    });
    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(result.items[1]?.errorCode).toBe('DINGTALK_RATE_LIMITED');
    expect(result.items[2]?.skipped).toBe(true);
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
    expect(mockInvalidateInstance).toHaveBeenCalledTimes(1);
    expect(mockInvalidateInstance).toHaveBeenCalledWith('inst-1');
  });

  it('continues an approval batch when one task is not owned', async () => {
    mockGetDetail
      .mockResolvedValueOnce(runningDetail)
      .mockResolvedValueOnce({
        ...runningDetail,
        tasks: [{ status: 'RUNNING', taskId: 't-2', userId: 'someone-else' }],
      })
      .mockResolvedValueOnce({
        ...runningDetail,
        tasks: [{ status: 'RUNNING', taskId: 't-3', userId: 'me' }],
        title: '采购',
      });
    const service = new DingtalkApprovalService({} as never, 'user-1');
    const result = await service.executeTasks({
      result: 'agree',
      tasks: [
        { processInstanceId: 'inst-1', taskId: 't-1' },
        { processInstanceId: 'inst-1', taskId: 't-2' },
        { processInstanceId: 'inst-1', taskId: 't-3' },
      ],
    });
    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(result.items[1]?.errorCode).toBe('DINGTALK_NOT_TASK_OWNER');
    expect(result.items[1]?.title).toBe('出差申请');
    expect(result.items[2]?.ok).toBe(true);
    expect(result.items[2]?.title).toBe('采购');
  });

  it('rejects a refuse batch without a shared remark before any execute', async () => {
    const service = new DingtalkApprovalService({} as never, 'user-1');
    await expect(
      service.executeTasks({
        remark: '  ',
        result: 'refuse',
        tasks: [{ processInstanceId: 'inst-1', taskId: 't-1' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION', message: '拒绝审批必须填写意见。' });
    await expect(
      service.executeTasks({
        result: 'agree',
        tasks: [
          { processInstanceId: 'inst-1', taskId: 't-1' },
          { processInstanceId: 'inst-1', taskId: 't-1' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(mockGetDetail).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it('stops an approval batch after two consecutive unavailable responses', async () => {
    mockGetDetail
      .mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_UNAVAILABLE'))
      .mockResolvedValueOnce({
        ...runningDetail,
        tasks: [{ status: 'RUNNING', taskId: 't-2', userId: 'me' }],
      });
    const service = new DingtalkApprovalService({} as never, 'user-1');
    const once = await service.executeTasks({
      result: 'agree',
      tasks: [
        { processInstanceId: 'inst-1', taskId: 't-1' },
        { processInstanceId: 'inst-1', taskId: 't-2' },
      ],
    });
    expect(once.items[0]?.errorCode).toBe('DINGTALK_UNAVAILABLE');
    expect(once.items[0]?.title).toBeUndefined();
    expect(once.items[1]?.ok).toBe(true);

    mockGetDetail.mockReset();
    mockExecute.mockReset();
    mockExecute.mockResolvedValue({ result: true });
    mockGetDetail.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_UNAVAILABLE'));
    const stopped = await service.executeTasks({
      result: 'agree',
      tasks: [
        { processInstanceId: 'inst-1', taskId: 't-1' },
        { processInstanceId: 'inst-1', taskId: 't-2' },
        { processInstanceId: 'inst-1', taskId: 't-3' },
      ],
    });
    expect(mockGetDetail).toHaveBeenCalledTimes(2);
    expect(mockExecute).not.toHaveBeenCalled();
    expect(stopped.items[0]?.errorCode).toBe('DINGTALK_UNAVAILABLE');
    expect(stopped.items[1]?.errorCode).toBe('DINGTALK_UNAVAILABLE');
    expect(stopped.items[2]?.skipped).toBe(true);
  });

  it('keeps the loaded instance title and a sanitized apply link on a failed approval item', async () => {
    const applyUrl = 'https://open-dev.dingtalk.com/appscope/apply?content=abc';
    const forbidden = new DingtalkWorkspaceError('DINGTALK_FORBIDDEN');
    Object.assign(forbidden, { applyUrl });
    mockGetDetail.mockResolvedValue(runningDetail);
    mockExecute.mockRejectedValueOnce(forbidden);
    const service = new DingtalkApprovalService({} as never, 'user-1');
    const result = await service.executeTasks({
      result: 'agree',
      tasks: [
        { processInstanceId: 'inst-1', taskId: 't-1' },
        { processInstanceId: 'inst-1', taskId: 't-2' },
      ],
    });
    expect(result.items[0]).toMatchObject({
      applyUrl,
      errorCode: 'DINGTALK_FORBIDDEN',
      id: 't-1',
      ok: false,
      title: '出差申请',
    });
    expect(result.items[1]?.skipped).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('drops a non-open-dev apply link and logs only unexpected approval batch errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetDetail.mockResolvedValue({
      ...runningDetail,
      tasks: [
        { status: 'RUNNING', taskId: 't-1', userId: 'me' },
        { status: 'RUNNING', taskId: 't-2', userId: 'me' },
      ],
    });
    const phish = new DingtalkWorkspaceError('DINGTALK_NOT_FOUND');
    Object.assign(phish, { applyUrl: 'https://evil.example/phish' });
    mockExecute.mockRejectedValueOnce(phish).mockRejectedValueOnce(new Error('socket hang up'));
    const service = new DingtalkApprovalService({} as never, 'user-1');
    try {
      const result = await service.executeTasks({
        result: 'agree',
        tasks: [
          { processInstanceId: 'inst-1', taskId: 't-1' },
          { processInstanceId: 'inst-1', taskId: 't-2' },
        ],
      });
      expect(result.items[0]?.applyUrl).toBeUndefined();
      expect(result.items[0]?.title).toBe('出差申请');
      expect(result.items[1]?.errorCode).toBe('DINGTALK_INTERNAL');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('[dingtalk.approval] batch item failed', {
        code: 'DINGTALK_INTERNAL',
        errorClass: 'Error',
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('attaches directory display names on getInstance', async () => {
    mockGetUsers.mockResolvedValueOnce([
      { name: '张三', staffId: 'me' },
      { name: '李四', staffId: 'other' },
      { name: '王五', staffId: 'cc-1' },
    ]);
    mockGetDetail.mockResolvedValueOnce({
      ...runningDetail,
      ccUserIds: ['cc-1'],
      operationRecords: [{ type: 'EXECUTE_TASK_NORMAL', userId: 'me' }],
      originatorUserId: 'other',
    });
    const service = new DingtalkApprovalService({} as never, 'user-1');
    const detail = await service.getInstance('inst-1');
    expect(mockGetUsers).toHaveBeenCalledTimes(1);
    expect(detail.originatorName).toBe('李四');
    expect(detail.tasks[0]?.name).toBe('张三');
    expect(detail.operationRecords[0]?.name).toBe('张三');
    expect(detail.ccUsers).toEqual([{ name: '王五', userId: 'cc-1' }]);
    expect(detail.summary).toEqual([{ label: '事由', value: '出差' }]);
  });

  it('forbids getInstance for outsiders', async () => {
    mockGetDetail.mockResolvedValueOnce({
      ...runningDetail,
      ccUserIds: [],
      originatorUserId: 'other',
      tasks: [{ status: 'COMPLETED', taskId: 't-9', userId: 'other' }],
    });
    const service = new DingtalkApprovalService({} as never, 'user-1');
    await expect(service.getInstance('inst-1')).rejects.toMatchObject({
      code: 'DINGTALK_FORBIDDEN',
    });
  });

  it('creates an instance as the verified caller and audits the instance id', async () => {
    const service = new DingtalkApprovalService({} as never, 'user-1');
    await service.createInstance({
      formValues: [{ label: '事由', value: '北京出差' }],
      processCode: 'PROC-1',
    });
    expect(mockStart).toHaveBeenCalledWith(
      expect.objectContaining({
        originatorUserId: 'me',
        processCode: 'PROC-1',
      }),
    );
    expect(mockAppendAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'dingtalk.approval.create',
        afterDiff: { title: '出差' },
        targetId: 'inst-new',
        targetType: 'dingtalk_approval',
      }),
    );
  });

  it('audits deleteTemplate with the cached template name, never the processCode', async () => {
    mockDeleteForm.mockResolvedValueOnce(undefined);
    const service = new DingtalkApprovalService({} as never, 'user-1');
    await service.deleteTemplate({ processCode: 'PROC-1' });
    expect(mockLoadTemplates).toHaveBeenCalled();
    expect(mockDeleteForm).toHaveBeenCalledWith('PROC-1');
    expect(mockAppendAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'dingtalk.approval.delete_template',
        afterDiff: { name: '出差', title: '出差' },
        targetId: 'PROC-1',
        targetType: 'dingtalk_approval',
      }),
    );
  });

  it('omits deleteTemplate audit title when the cached list has no matching name', async () => {
    mockLoadTemplates.mockResolvedValueOnce([]);
    mockDeleteForm.mockResolvedValueOnce(undefined);
    const service = new DingtalkApprovalService({} as never, 'user-1');
    await service.deleteTemplate({ processCode: 'PROC-MISSING' });
    expect(mockDeleteForm).toHaveBeenCalledWith('PROC-MISSING');
    expect(mockAppendAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'dingtalk.approval.delete_template',
        afterDiff: null,
        targetId: 'PROC-MISSING',
      }),
    );
  });

  it('requires approval admin to save a template', async () => {
    mockIsAdmin.mockResolvedValueOnce(false);
    const service = new DingtalkApprovalService({} as never, 'user-1');
    await expect(
      service.saveTemplate({
        fields: [{ componentType: 'TextField', label: '事由' }],
        name: '新模板',
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_NOT_APPROVAL_ADMIN' });
  });

  it('threads format, unit and bizAlias into DingTalk form component props', async () => {
    mockSaveForm.mockResolvedValueOnce({ processCode: 'PROC-NEW' });
    const service = new DingtalkApprovalService({} as never, 'user-1');
    const result = await service.saveTemplate({
      fields: [
        {
          bizAlias: 'start_date',
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
      name: '新模板',
    });
    expect(mockSaveForm).toHaveBeenCalledWith(
      expect.objectContaining({
        formComponents: [
          {
            componentType: 'DDDateField',
            props: expect.objectContaining({
              bizAlias: 'start_date',
              format: 'yyyy-MM-dd',
              label: '开始日期',
              required: true,
              unit: '天',
            }),
          },
          {
            componentType: 'MoneyField',
            props: expect.objectContaining({
              label: '金额',
              unit: '元',
              upper: '0',
            }),
          },
        ],
        name: '新模板',
      }),
    );
    expect(result).toMatchObject({
      adminUrl:
        'https://aflow.dingtalk.com/dingtalk/web/query/oaDesigner?from=oaAdminHomeWeb&processCode=PROC-NEW',
      created: true,
      name: '新模板',
      processCode: 'PROC-NEW',
    });
    expect(result.fields).toEqual([
      { componentType: 'DDDateField', label: '开始日期', required: true },
      { componentType: 'MoneyField', label: '金额', required: false },
    ]);
    expect(result.notes).toEqual([
      '审批流程、可见范围和模板管理员无法通过接口配置。请登录钉钉管理后台打开该模板，在「流程设计」中设置后发布。',
    ]);
  });

  it('rejects unsupported component types before calling DingTalk', async () => {
    const service = new DingtalkApprovalService({} as never, 'user-1');
    await expect(
      service.saveTemplate({
        fields: [{ componentType: 'UnknownWidget', label: 'x' }],
        name: '新模板',
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_INVALID', hint: 'UnknownWidget' });
    expect(mockSaveForm).not.toHaveBeenCalled();
  });

  it('lists every saveTemplate problem before calling DingTalk', async () => {
    const service = new DingtalkApprovalService({} as never, 'user-1');
    await expect(
      service.saveTemplate({
        fields: [
          { componentType: 'SeqNumberField', label: '流水号' },
          { componentType: 'DDSelectField', label: '转租类型' },
          { componentType: 'TextField', label: '事由' },
          { componentType: 'TextField', label: '事由' },
        ],
        name: '设备转租审批',
      }),
    ).rejects.toMatchObject({
      code: 'DINGTALK_INVALID',
      hint: 'SeqNumberField',
      problems: [
        expect.objectContaining({
          componentType: 'SeqNumberField',
          index: 0,
          issue: 'unsupported',
          suggestion: 'remove: DingTalk generates it',
        }),
        expect.objectContaining({
          componentType: 'DDSelectField',
          index: 1,
          issue: 'options',
        }),
        expect.objectContaining({
          index: 3,
          issue: 'duplicate',
          label: '事由',
        }),
      ],
    });
    expect(mockSaveForm).not.toHaveBeenCalled();
  });

  it('encodes select options and date-range labels before save', async () => {
    mockSaveForm.mockResolvedValueOnce({ processCode: 'PROC-NEW' });
    const service = new DingtalkApprovalService({} as never, 'user-1');
    await service.saveTemplate({
      fields: [
        { componentType: 'DDSelectField', label: '类型', options: ['A', 'B'] },
        { componentType: 'DDDateRangeField', label: ['开始时间', '结束时间'] },
      ],
      name: '新模板',
    });
    expect(mockSaveForm).toHaveBeenCalledWith(
      expect.objectContaining({
        formComponents: [
          expect.objectContaining({
            componentType: 'DDSelectField',
            props: expect.objectContaining({
              options: [
                { key: 'option_0', value: 'A' },
                { key: 'option_1', value: 'B' },
              ],
            }),
          }),
          expect.objectContaining({
            componentType: 'DDDateRangeField',
            props: expect.objectContaining({
              format: 'yyyy-MM-dd',
              label: '["开始时间","结束时间"]',
              unit: '天',
            }),
          }),
        ],
      }),
    );
  });

  it('terminates only as originator', async () => {
    mockGetDetail.mockResolvedValueOnce({ ...runningDetail, originatorUserId: 'other' });
    const service = new DingtalkApprovalService({} as never, 'user-1');
    await expect(service.terminateInstance({ processInstanceId: 'inst-1' })).rejects.toMatchObject({
      code: 'DINGTALK_NOT_ORIGINATOR',
    });
  });

  it('invalidates pending caches after successful writes', async () => {
    const service = new DingtalkApprovalService({} as never, 'user-1');

    await service.createInstance({
      formValues: [{ label: '事由', value: '北京出差' }],
      processCode: 'PROC-1',
    });
    expect(mockInvalidate).toHaveBeenCalledWith('user-1');
    mockInvalidate.mockClear();

    mockGetDetail.mockResolvedValue(runningDetail);
    await service.executeTask({ processInstanceId: 'inst-1', result: 'agree', taskId: 't-1' });
    expect(mockInvalidate).toHaveBeenCalledWith('user-1');
    mockInvalidate.mockClear();

    await service.redirectTask({
      processInstanceId: 'inst-1',
      taskId: 't-1',
      toStaffToken: 'staff:staff-2',
    });
    expect(mockInvalidate).toHaveBeenCalledWith('user-1');
    mockInvalidate.mockClear();

    mockGetDetail.mockResolvedValue({
      ...runningDetail,
      originatorUserId: 'me',
      status: 'RUNNING',
    });
    await service.terminateInstance({ processInstanceId: 'inst-1' });
    expect(mockInvalidate).toHaveBeenCalledWith('user-1');
    mockInvalidate.mockClear();

    mockGetDetail.mockResolvedValue(runningDetail);
    await service.revertTask({
      processInstanceId: 'inst-1',
      revertAction: 'REVERT_FOR_RESUBMIT',
      targetActivityId: 'act-1',
      taskId: 't-1',
    });
    expect(mockInvalidate).toHaveBeenCalledWith('user-1');
    mockInvalidate.mockClear();

    await service.appendTask({
      appenderStaffTokens: ['staff:staff-2'],
      processInstanceId: 'inst-1',
      taskId: 't-1',
      type: 'after',
    });
    expect(mockInvalidate).toHaveBeenCalledWith('user-1');
  });

  it('does not invalidate pending caches when a write is rejected', async () => {
    mockGetDetail.mockResolvedValueOnce({
      ...runningDetail,
      tasks: [{ status: 'RUNNING', taskId: 't-1', userId: 'someone-else' }],
    });
    const service = new DingtalkApprovalService({} as never, 'user-1');
    await expect(
      service.executeTask({ processInstanceId: 'inst-1', result: 'agree', taskId: 't-1' }),
    ).rejects.toMatchObject({ code: 'DINGTALK_NOT_TASK_OWNER' });
    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});
