import { describe, expect, it, vi } from 'vitest';

import { DINGTALK_ERROR_CODES, DINGTALK_INTERNAL_TOOL_CONTENT } from './errors';
import type { IDingtalkApprovalService } from './index';
import {
  createDingtalkApprovalRuntime,
  DINGTALK_APPROVAL_CONTENT_LIMIT,
  DINGTALK_APPROVAL_STATE_ROW_LIMIT,
} from './index';

const makeService = (
  overrides: Partial<IDingtalkApprovalService> = {},
): IDingtalkApprovalService => ({
  addApprover: vi.fn(),
  approveTask: vi.fn(),
  commentApproval: vi.fn(),
  createApprovalRule: vi.fn(),
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
  saveTemplate: vi.fn(),
  searchDirectory: vi.fn().mockResolvedValue({
    ambiguous: false,
    departments: [],
    users: [],
  }),
  submitApproval: vi.fn(),
  transferTask: vi.fn(),
  updateApprovalRule: vi.fn(),
  withdrawApplication: vi.fn(),
  ...overrides,
});

class FakeDingtalkError extends Error {
  readonly code: string;
  readonly candidates?: { deptPath?: string; name: string; staffId: string }[];
  readonly hint?: string;
  readonly problems?: Array<{
    componentType: string;
    index: number;
    issue: string;
    label: string;
    suggestion: string;
  }>;
  constructor(
    code: string,
    extras?: {
      candidates?: { deptPath?: string; name: string; staffId: string }[];
      hint?: string;
      problems?: Array<{
        componentType: string;
        index: number;
        issue: string;
        label: string;
        suggestion: string;
      }>;
    },
  ) {
    super(`upstream boom ${code}`);
    this.name = 'DingtalkWorkspaceError';
    this.code = code;
    this.candidates = extras?.candidates;
    this.hint = extras?.hint;
    this.problems = extras?.problems;
  }
}

describe('DingtalkApprovalExecutionRuntime', () => {
  it('formats searchDirectory hits and asks on ambiguous names', async () => {
    const searchDirectory = vi.fn().mockResolvedValue({
      ambiguous: true,
      departments: [],
      users: [
        { deptPath: '捷发 / 安环部', leafDeptName: '安环部', name: '胡玉琴A', staffId: 's1' },
        { deptPath: '捷发 / 财务部', leafDeptName: '财务部', name: '胡玉琴A', staffId: 's2' },
      ],
    });
    const runtime = createDingtalkApprovalRuntime(makeService({ searchDirectory }));

    const result = await runtime.searchDirectory({ q: '胡玉琴A' });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ ambiguous: true, userCount: 2 });
    expect(result.content).toContain('请列出「姓名 · 部门」请用户选择');
    expect(result.content).toContain('不要猜测');
    expect(result.content).toContain('staff:s1');
    expect(result.content).not.toMatch(/\n {2}"/);
  });

  it('tells the model to copy staff tokens verbatim when the name is unique', async () => {
    const searchDirectory = vi.fn().mockResolvedValue({
      ambiguous: false,
      departments: [],
      users: [{ leafDeptName: '外贸组', name: '陈柠', staffId: '173abc' }],
    });
    const runtime = createDingtalkApprovalRuntime(makeService({ searchDirectory }));

    const result = await runtime.searchDirectory({ q: '陈柠' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('staff:<id>');
    expect(result.content).toContain('原样传入');
    expect(result.content).toContain('"staffToken":"staff:173abc"');
    expect(result.content).not.toContain('"staffId"');
  });

  it('maps DINGTALK_AMBIGUOUS to candidate labels and asks the user', async () => {
    const approveTask = vi.fn().mockRejectedValue(
      new FakeDingtalkError('DINGTALK_AMBIGUOUS', {
        candidates: [
          { deptPath: '安环部', name: '胡玉琴A', staffId: 's1' },
          { deptPath: '财务部', name: '胡玉琴A', staffId: 's2' },
        ],
      }),
    );
    const runtime = createDingtalkApprovalRuntime(makeService({ approveTask }));

    const result = await runtime.approveTask({
      processInstanceId: 'pi-1',
      taskId: 't-1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: 'DINGTALK_AMBIGUOUS' });
    expect(result.content).toContain('DINGTALK_AMBIGUOUS');
    expect(result.content).toContain('胡玉琴A · 安环部');
    expect(result.content).toContain('请列出候选「姓名 · 部门」');
    expect(result.content).toContain('不要猜测');
    expect(result.content).not.toContain('upstream boom');
  });

  it('maps DINGTALK_IDENTITY_UNVERIFIED to DingTalk sign-in guidance', async () => {
    const listPendingApprovals = vi
      .fn()
      .mockRejectedValue(new FakeDingtalkError('DINGTALK_IDENTITY_UNVERIFIED'));
    const runtime = createDingtalkApprovalRuntime(makeService({ listPendingApprovals }));

    const result = await runtime.listPendingApprovals();

    expect(result.success).toBe(false);
    expect(result.content).toContain('DINGTALK_IDENTITY_UNVERIFIED');
    expect(result.content).toContain('使用钉钉登录');
    expect(result.content).toContain('钉钉机器人');
    expect(result.content).toContain('管理员不能代为绑定');
    expect(result.content).not.toContain('upstream boom');
  });

  it('maps every contracted error code to short Chinese guidance without upstream text', async () => {
    for (const code of DINGTALK_ERROR_CODES) {
      const listTemplates = vi.fn().mockRejectedValue(new FakeDingtalkError(code));
      const runtime = createDingtalkApprovalRuntime(makeService({ listTemplates }));
      const result = await runtime.listTemplates();

      expect(result.success, code).toBe(false);
      expect(result.content, code).toContain(code);
      expect(result.content, code).not.toContain('upstream boom');
      expect(result.error, code).toMatchObject({ code });
    }
  });

  it('sanitizes unknown failures to a generic internal error', async () => {
    const submitApproval = vi.fn().mockRejectedValue(new Error('ECONNRESET sql: password=secret'));
    const runtime = createDingtalkApprovalRuntime(makeService({ submitApproval }));

    const result = await runtime.submitApproval({
      formValues: [{ label: '事由', value: '出差' }],
      processCode: 'PROC',
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain(DINGTALK_INTERNAL_TOOL_CONTENT);
    expect(result.content).not.toContain('password');
    expect(result.content).not.toContain('ECONNRESET');
    expect(result.error).toMatchObject({ code: 'DINGTALK_INTERNAL' });
  });

  it('reads TRPC-shaped errorData codes from the client', async () => {
    const refuseTask = vi.fn().mockRejectedValue({
      data: { errorData: { code: 'DINGTALK_NOT_TASK_OWNER' } },
      message: 'BAD_REQUEST',
    });
    const runtime = createDingtalkApprovalRuntime(makeService({ refuseTask }));

    const result = await runtime.refuseTask({
      processInstanceId: 'pi-1',
      remark: '预算不足',
      taskId: 't-1',
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('DINGTALK_NOT_TASK_OWNER');
    expect(result.content).toContain('不是该待办任务的处理人');
  });

  it('lists pending approvals from { rows, truncated }', async () => {
    const listPendingApprovals = vi.fn().mockResolvedValue({
      rows: [
        {
          processInstanceId: 'pi-1',
          taskId: 't-1',
          title: '请假',
        },
      ],
      truncated: true,
    });
    const runtime = createDingtalkApprovalRuntime(makeService({ listPendingApprovals }));

    const result = await runtime.listPendingApprovals({ limit: 10 });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      count: 1,
      items: [
        {
          processInstanceId: 'pi-1',
          taskId: 't-1',
          title: '请假',
        },
      ],
      truncated: true,
    });
    expect(result.state).not.toHaveProperty('incomplete');
    expect(result.content).toContain('truncated=true');
    expect(result.content).toContain('pi-1');
  });

  it('passes incomplete scan metadata on listPendingApprovals and warns the model', async () => {
    const incomplete = {
      reason: 'rate_limited' as const,
      scannedTemplates: 3,
      totalTemplates: 12,
    };
    const listPendingApprovals = vi.fn().mockResolvedValue({
      incomplete,
      rows: [],
      truncated: true,
    });
    const runtime = createDingtalkApprovalRuntime(makeService({ listPendingApprovals }));

    const result = await runtime.listPendingApprovals();
    const payload = JSON.parse(result.content.slice(result.content.indexOf('{'))) as {
      count: number;
      incomplete?: typeof incomplete;
    };

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      count: 0,
      incomplete,
      items: [],
      truncated: true,
    });
    expect(payload).toMatchObject({ count: 0, incomplete });
    expect(result.content).toContain(
      '结果可能不完整:仅扫描了 3/12 个审批模板(钉钉接口限流),请稍后重试或指定审批模板。',
    );
    expect(result.content).not.toContain('没有待审批');
  });

  it('passes incomplete scan metadata on listMyApplications with a time-budget note', async () => {
    const incomplete = {
      reason: 'time_budget' as const,
      scannedTemplates: 4,
      totalTemplates: 20,
    };
    const listMyApplications = vi.fn().mockResolvedValue({
      incomplete,
      rows: [
        {
          processInstanceId: 'pi-2',
          title: '差旅报销',
        },
      ],
      truncated: true,
    });
    const runtime = createDingtalkApprovalRuntime(makeService({ listMyApplications }));

    const result = await runtime.listMyApplications();
    const payload = JSON.parse(result.content.slice(result.content.indexOf('{'))) as {
      incomplete?: typeof incomplete;
    };

    expect(result.state).toMatchObject({
      count: 1,
      incomplete,
      truncated: true,
    });
    expect(payload.incomplete).toEqual(incomplete);
    expect(result.content).toContain(
      '结果可能不完整:仅扫描了 4/20 个审批模板(超时),请稍后重试或指定审批模板。',
    );
  });

  it('maps incomplete cap reason and ignores malformed incomplete objects', async () => {
    const listPendingApprovals = vi.fn().mockResolvedValue({
      incomplete: { reason: 'cap', scannedTemplates: 8, totalTemplates: 30 },
      rows: [{ processInstanceId: 'pi-1', title: '请假' }],
      truncated: true,
    });
    const listMyApplications = vi.fn().mockResolvedValue({
      incomplete: { reason: 'unknown', scannedTemplates: 1, totalTemplates: 2 },
      rows: [],
      truncated: false,
    });
    const runtime = createDingtalkApprovalRuntime(
      makeService({ listMyApplications, listPendingApprovals }),
    );

    const pending = await runtime.listPendingApprovals();
    expect(pending.state).toMatchObject({
      incomplete: { reason: 'cap', scannedTemplates: 8, totalTemplates: 30 },
    });
    expect(pending.content).toContain('仅扫描了 8/30 个审批模板(扫描上限)');

    const applications = await runtime.listMyApplications();
    expect(applications.state).not.toHaveProperty('incomplete');
    expect(applications.content).not.toContain('结果可能不完整');
  });

  it('puts compact rows on listMyApplications and listApprovalRules state', async () => {
    const listMyApplications = vi.fn().mockResolvedValue({
      rows: [
        {
          createdAt: '2026-09-20T10:00:00+08:00',
          originatorName: '李四',
          processInstanceId: 'pi-2',
          processName: '费用报销',
          title: '差旅报销',
        },
      ],
      truncated: false,
    });
    const listApprovalRules = vi.fn().mockResolvedValue([
      {
        action: 'agree',
        enabled: true,
        expiresAt: '2026-12-01T00:00:00.000Z',
        id: 'r1',
        name: '小额报销自动同意',
        processName: '费用报销',
      },
    ]);
    const runtime = createDingtalkApprovalRuntime(
      makeService({ listApprovalRules, listMyApplications }),
    );

    const applications = await runtime.listMyApplications();
    expect(applications.state).toMatchObject({
      count: 1,
      items: [
        {
          createdAt: '2026-09-20T10:00:00+08:00',
          originatorName: '李四',
          processInstanceId: 'pi-2',
          processName: '费用报销',
          title: '差旅报销',
        },
      ],
    });

    const rules = await runtime.listApprovalRules();
    expect(rules.state).toMatchObject({
      count: 1,
      items: [
        {
          actionLabel: '同意',
          enabled: true,
          expiresAt: '2026-12-01T00:00:00.000Z',
          id: 'r1',
          name: '小额报销自动同意',
          processName: '费用报销',
        },
      ],
    });
  });

  it('puts schema fields and detail lines on read state for Render', async () => {
    const getTemplateSchema = vi.fn().mockResolvedValue({
      fields: [
        {
          bizAlias: 'startDate',
          componentId: 'DDDateField-1',
          componentType: 'DDDateField',
          format: 'yyyy-MM-dd',
          label: '开始日期',
          required: true,
        },
        {
          componentType: 'MoneyField',
          label: '金额',
          required: false,
          unit: '元',
        },
      ],
      name: '请假',
      processCode: 'PROC',
    });
    const getApprovalDetail = vi.fn().mockResolvedValue({
      processInstanceId: 'pi-1',
      status: 'RUNNING',
      summary: [{ label: '金额', value: '1200' }],
      tasks: [{ showName: '张三', status: 'RUNNING', userId: 'u1' }],
      title: '差旅报销',
    });
    const runtime = createDingtalkApprovalRuntime(
      makeService({ getApprovalDetail, getTemplateSchema }),
    );

    const schema = await runtime.getTemplateSchema({ processCode: 'PROC' });
    expect(schema.state).toMatchObject({
      fields: [
        {
          bizAlias: 'startDate',
          componentId: 'DDDateField-1',
          componentType: 'DDDateField',
          format: 'yyyy-MM-dd',
          label: '开始日期',
          required: true,
        },
        { componentType: 'MoneyField', label: '金额', required: false, unit: '元' },
      ],
      processCode: 'PROC',
    });
    const schemaJson = JSON.parse(schema.content) as {
      fields: Array<{ bizAlias?: string; format?: string; unit?: string }>;
    };
    expect(schemaJson.fields[0]).toMatchObject({
      bizAlias: 'startDate',
      format: 'yyyy-MM-dd',
    });
    expect(schemaJson.fields[1]).toMatchObject({ unit: '元' });

    const detail = await runtime.getApprovalDetail({ processInstanceId: 'pi-1' });
    expect(detail.state).toMatchObject({
      lines: [
        { label: '状态', value: '审批中' },
        { label: '当前处理人', value: '张三' },
        { label: '金额', value: '1200' },
      ],
      processInstanceId: 'pi-1',
      title: '差旅报销',
    });
  });

  it('rewrites instance people to staffToken + name and drops raw userIds', async () => {
    const getApprovalDetail = vi.fn().mockResolvedValue({
      ccUserIds: ['cc-1'],
      ccUsers: [{ name: '王五', userId: 'cc-1' }],
      operationRecords: [
        {
          ccUserIds: ['cc-2'],
          ccUsers: [{ name: '孙七', userId: 'cc-2' }],
          name: '李四',
          result: 'AGREE',
          type: 'EXECUTE_TASK',
          userId: 'u2',
        },
      ],
      originatorName: '赵六',
      originatorUserId: '173abc',
      processInstanceId: 'pi-1',
      status: 'RUNNING',
      tasks: [
        { name: '张三', status: 'RUNNING', taskId: 't-1', userId: 'u1' },
        { status: 'COMPLETED', taskId: 't-0', userId: 'u2' },
      ],
      title: '差旅报销',
    });
    const runtime = createDingtalkApprovalRuntime(makeService({ getApprovalDetail }));

    const result = await runtime.getApprovalDetail({ processInstanceId: 'pi-1' });
    const payload = JSON.parse(result.content) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(payload.originator).toEqual({ name: '赵六', staffToken: 'staff:173abc' });
    expect(payload.cc).toEqual([{ name: '王五', staffToken: 'staff:cc-1' }]);
    expect(payload.tasks).toEqual([
      { name: '张三', staffToken: 'staff:u1', status: 'RUNNING', taskId: 't-1' },
      { staffToken: 'staff:u2', status: 'COMPLETED', taskId: 't-0' },
    ]);
    expect(payload.operationRecords).toEqual([
      {
        cc: [{ name: '孙七', staffToken: 'staff:cc-2' }],
        name: '李四',
        result: 'AGREE',
        staffToken: 'staff:u2',
        type: 'EXECUTE_TASK',
      },
    ]);
    expect(result.content).not.toContain('"userId"');
    expect(result.content).not.toContain('"originatorUserId"');
    expect(result.content).not.toContain('"ccUserIds"');
    expect(result.content).not.toMatch(/"173abc"/);
  });

  it('caps list rows at 50 and truncates oversized read content as valid JSON', async () => {
    const rows = Array.from({ length: DINGTALK_APPROVAL_STATE_ROW_LIMIT + 10 }, (_, index) => ({
      processInstanceId: `pi-${index}`,
      taskId: `t-${index}`,
      title: `请假 ${index}`,
    }));
    const listPendingApprovals = vi.fn().mockResolvedValue({ rows, truncated: false });
    const getApprovalDetail = vi.fn().mockResolvedValue({
      formComponentValues: [{ name: '说明', value: 'x'.repeat(DINGTALK_APPROVAL_CONTENT_LIMIT) }],
      processInstanceId: 'pi-huge',
      title: '超长表单',
    });
    const runtime = createDingtalkApprovalRuntime(
      makeService({ getApprovalDetail, listPendingApprovals }),
    );

    const listed = await runtime.listPendingApprovals();
    expect(listed.state).toMatchObject({
      count: rows.length,
      truncated: true,
    });
    expect((listed.state as { items: unknown[] }).items).toHaveLength(
      DINGTALK_APPROVAL_STATE_ROW_LIMIT,
    );
    expect(() => JSON.parse(listed.content)).not.toThrow();

    const detail = await runtime.getApprovalDetail({ processInstanceId: 'pi-huge' });
    const payload = JSON.parse(detail.content) as {
      formComponentValues?: Array<{ value?: string }>;
      processInstanceId?: string;
      truncated?: boolean;
    };
    expect(payload.truncated).toBe(true);
    expect(payload.processInstanceId).toBe('pi-huge');
    expect(detail.content.length).toBeLessThanOrEqual(DINGTALK_APPROVAL_CONTENT_LIMIT);
    expect(detail.state).toMatchObject({ truncated: true, title: '超长表单' });
    if (payload.formComponentValues?.[0]?.value) {
      expect(payload.formComponentValues[0].value.length).toBeLessThan(
        DINGTALK_APPROVAL_CONTENT_LIMIT,
      );
    }
  });

  it('last-resort truncation keeps processInstanceId and valid JSON', async () => {
    const tasks = Array.from({ length: 80 }, (_, index) => ({
      remark: `r${index}-${'y'.repeat(400)}`,
      status: 'RUNNING',
      taskId: `t-${index}`,
      userId: `user-${index}`,
      userName: `处理人${index}-${'名'.repeat(80)}`,
    }));
    const getApprovalDetail = vi.fn().mockResolvedValue({
      formComponentValues: Array.from({ length: 40 }, (_, index) => ({
        name: `字段${index}`,
        value: 'z'.repeat(800),
      })),
      operationRecords: tasks,
      originatorUserId: 'origin-1',
      processInstanceId: 'pi-last',
      tasks,
      title: '超大审批单',
    });
    const runtime = createDingtalkApprovalRuntime(makeService({ getApprovalDetail }));

    const result = await runtime.getApprovalDetail({ processInstanceId: 'pi-last' });
    const payload = JSON.parse(result.content) as {
      processInstanceId?: string;
      truncated?: boolean;
      userId?: unknown;
    };
    expect(payload.truncated).toBe(true);
    expect(payload.processInstanceId).toBe('pi-last');
    expect(result.content).not.toContain('"userId"');
    expect(result.content.length).toBeLessThanOrEqual(DINGTALK_APPROVAL_CONTENT_LIMIT);
  });

  it('passes saveTemplate processCode, fields, adminUrl and remaining steps through content and state', async () => {
    const saveTemplate = vi.fn().mockResolvedValue({
      adminUrl: 'https://aflow.dingtalk.com/dingtalk/web/query/oaDesigner?processCode=PROC-1',
      created: true,
      fields: [
        { componentType: 'TextField', label: '借用工具', required: true },
        { componentType: 'TextareaField', label: '借用事由', required: false },
      ],
      name: '工具借用审批',
      notes: ['请在后台配置由发起人自选审批人'],
      processCode: 'PROC-1',
    });
    const runtime = createDingtalkApprovalRuntime(makeService({ saveTemplate }));

    const result = await runtime.saveTemplate({
      fields: [{ componentType: 'TextField', label: '借用工具', required: true }],
      name: '工具借用审批',
    });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      adminUrl: 'https://aflow.dingtalk.com/dingtalk/web/query/oaDesigner?processCode=PROC-1',
      created: true,
      name: '工具借用审批',
      processCode: 'PROC-1',
      success: true,
    });
    expect(result.content).toContain(
      '[前往钉钉后台配置审批流程](https://aflow.dingtalk.com/dingtalk/web/query/oaDesigner?processCode=PROC-1)',
    );
    expect(result.content).toContain('流程设计');
    expect(result.content).toContain('可见范围');
    expect(result.content).toContain('权威结果');
    expect(result.content).toContain('listTemplates');
    expect(result.content).not.toContain('upstream');
  });

  it('includes DINGTALK_INVALID hint so the model can retry once', async () => {
    const saveTemplate = vi
      .fn()
      .mockRejectedValue(
        new FakeDingtalkError('DINGTALK_INVALID', { hint: 'DDDateField props.unit' }),
      );
    const runtime = createDingtalkApprovalRuntime(makeService({ saveTemplate }));

    const result = await runtime.saveTemplate({
      fields: [{ componentType: 'DDDateField', label: '借用日期', required: true }],
      name: '工具借用审批',
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('DINGTALK_INVALID');
    expect(result.content).toContain('DDDateField props.unit');
    expect(result.content).toContain('重试一次');
    expect(result.content).not.toContain('upstream boom');
    expect(result.error).toMatchObject({
      code: 'DINGTALK_INVALID',
      hint: 'DDDateField props.unit',
    });
  });

  it('lists every saveTemplate form problem in one Chinese DINGTALK_INVALID', async () => {
    const problems = [
      {
        componentType: 'SeqNumberField',
        index: 0,
        issue: 'unsupported',
        label: '流水号',
        suggestion: 'remove: DingTalk generates it',
      },
      {
        componentType: 'DDSelectField',
        index: 1,
        issue: 'options',
        label: '转租类型',
        suggestion: 'provide at least 2 options',
      },
    ];
    const saveTemplate = vi
      .fn()
      .mockRejectedValue(
        new FakeDingtalkError('DINGTALK_INVALID', { hint: 'SeqNumberField', problems }),
      );
    const runtime = createDingtalkApprovalRuntime(makeService({ saveTemplate }));

    const result = await runtime.saveTemplate({
      fields: [
        { componentType: 'SeqNumberField', label: '流水号' },
        { componentType: 'DDSelectField', label: '转租类型' },
      ],
      name: '设备转租审批',
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('DINGTALK_INVALID');
    expect(result.content).toContain('一次性修正以下全部问题');
    expect(result.content).toContain('[0] 流水号（SeqNumberField）');
    expect(result.content).toContain('请删除该控件，钉钉会自动生成流水号');
    expect(result.content).toContain('[1] 转租类型（DDSelectField）');
    expect(result.content).toContain('请提供至少 2 个选项');
    expect(result.content).not.toContain('只修正该字段');
    expect(result.content).not.toContain('upstream boom');
    expect(result.error).toMatchObject({
      code: 'DINGTALK_INVALID',
      hint: 'SeqNumberField',
      problems,
    });
  });

  it('reads saveTemplate problems from TRPC cause.data', async () => {
    const saveTemplate = vi.fn().mockRejectedValue({
      cause: {
        data: {
          code: 'DINGTALK_INVALID',
          hint: 'SeqNumberField',
          problems: [
            {
              componentType: 'SeqNumberField',
              index: 0,
              issue: 'unsupported',
              label: '流水号',
              suggestion: 'remove: DingTalk generates it',
            },
          ],
        },
      },
    });
    const runtime = createDingtalkApprovalRuntime(makeService({ saveTemplate }));
    const result = await runtime.saveTemplate({
      fields: [{ componentType: 'SeqNumberField', label: '流水号' }],
      name: '设备转租审批',
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('请删除该控件，钉钉会自动生成流水号');
    expect(result.error).toMatchObject({
      code: 'DINGTALK_INVALID',
      problems: [expect.objectContaining({ componentType: 'SeqNumberField', index: 0 })],
    });
  });

  it('returns compact success JSON for writes', async () => {
    const approveTask = vi.fn().mockResolvedValue({ result: true });
    const runtime = createDingtalkApprovalRuntime(makeService({ approveTask }));

    const result = await runtime.approveTask({ processInstanceId: 'pi-1', taskId: 't-1' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('已同意该审批任务');
    expect(result.state).toMatchObject({ success: true, taskId: 't-1' });
  });
});
