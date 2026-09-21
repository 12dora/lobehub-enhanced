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

const assertDingtalkFeature = vi.fn();
const getDingtalkWorkspaceCapabilities = vi.fn();
const requireVerifiedDingtalkIdentity = vi.fn();
const resolveStaff = vi.fn();
const listTemplates = vi.fn();
const getTemplateSchema = vi.fn();
const create = vi.fn();
const update = vi.fn();
const findById = vi.fn();
const list = vi.fn();
const listRuns = vi.fn();
const remove = vi.fn();
const countActive = vi.fn();
const getUsers = vi.fn();
const selectWhere = vi.fn();

class DingtalkApprovalRuleEnableBlockedError extends Error {
  readonly blocked: 'expired' | 'forbidden';
  constructor(blocked: 'expired' | 'forbidden') {
    super('Approval rule cannot be enabled');
    this.name = 'DingtalkApprovalRuleEnableBlockedError';
    this.blocked = blocked;
  }
}

vi.mock('../errors', () => ({ DingtalkWorkspaceError }));
vi.mock('../capabilities', () => ({
  assertDingtalkFeature: (...args: unknown[]) => assertDingtalkFeature(...args),
  getDingtalkWorkspaceCapabilities: (...args: unknown[]) =>
    getDingtalkWorkspaceCapabilities(...args),
}));
vi.mock('../identity', () => ({
  requireVerifiedDingtalkIdentity: (...args: unknown[]) => requireVerifiedDingtalkIdentity(...args),
}));
vi.mock('../directory', () => ({
  resolveStaff: (...args: unknown[]) => resolveStaff(...args),
}));
vi.mock('../approval', () => ({
  DingtalkApprovalService: class {
    getTemplateSchema = getTemplateSchema;
    listTemplates = listTemplates;
  },
}));
vi.mock('@/database/models/dingtalkDirectory', () => ({
  DingTalkDirectoryModel: class {
    getUsers = getUsers;
  },
}));
vi.mock('@/database/models/dingtalkApprovalRule', () => ({
  DingtalkApprovalRuleEnableBlockedError,
  DingtalkApprovalRuleModel: class {
    countActive = countActive;
    create = create;
    delete = remove;
    findById = findById;
    list = list;
    listRuns = listRuns;
    update = update;
  },
}));

const { DingtalkApprovalRuleService } = await import('./service');

const identity = { name: '张三', staffId: 'staff_me', unionId: 'union_me' };
const schema = {
  fields: [
    { componentId: 'NumberField-1', componentType: 'NumberField', label: '金额' },
    { componentId: 'TextField-1', componentType: 'TextField', label: '事由' },
  ],
  name: '差旅报销',
  processCode: 'PROC_1',
};

describe('DingtalkApprovalRuleService', () => {
  const mockDb = {
    select: () => ({
      from: () => ({
        where: selectWhere,
      }),
    }),
  };
  const service = new DingtalkApprovalRuleService(mockDb as never, 'user_1');

  beforeEach(() => {
    vi.clearAllMocks();
    assertDingtalkFeature.mockResolvedValue(undefined);
    getDingtalkWorkspaceCapabilities.mockResolvedValue({
      approval: true,
      automationTier: 'moderate',
      calendar: false,
      todo: false,
    });
    requireVerifiedDingtalkIdentity.mockResolvedValue(identity);
    listTemplates.mockResolvedValue([{ name: '差旅报销', processCode: 'PROC_1' }]);
    getTemplateSchema.mockResolvedValue(schema);
    countActive.mockResolvedValue(0);
    create.mockImplementation(async (input: unknown) => ({ id: 'rule_1', ...(input as object) }));
    getUsers.mockResolvedValue([
      { deptPath: '捷发 / 安环部', name: '张三', staffId: 'staff_originator' },
    ]);
    selectWhere.mockResolvedValue([{ deptId: 'dept_1', name: '研发部' }]);
    resolveStaff.mockResolvedValue({
      deptPath: '捷发 / 财务',
      name: '李四',
      staffId: 'staff_other',
    });
  });

  it('rejects create when automation is off', async () => {
    getDingtalkWorkspaceCapabilities.mockResolvedValue({
      approval: true,
      automationTier: 'off',
      calendar: false,
      todo: false,
    });
    await expect(
      service.create({
        action: 'agree',
        conditions: { match: 'all' },
        name: '自动同意',
        processCode: 'PROC_1',
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_AUTOMATION_OFF' });
  });

  it('rejects a 21st active rule', async () => {
    countActive.mockResolvedValue(20);
    await expect(
      service.create({
        action: 'agree',
        conditions: { match: 'all' },
        name: '自动同意',
        processCode: 'PROC_1',
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_RULE_LIMIT' });
  });

  it('rejects numeric ops on text fields and missing templates', async () => {
    await expect(
      service.create({
        action: 'agree',
        conditions: {
          fields: [
            {
              componentId: 'TextField-1',
              label: '事由',
              op: 'gt',
              value: 1,
            },
          ],
          match: 'all',
        },
        name: '坏规则',
        processCode: 'PROC_1',
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_INVALID' });

    listTemplates.mockResolvedValue([]);
    await expect(
      service.create({
        action: 'agree',
        conditions: { match: 'all' },
        name: '自动同意',
        processCode: 'PROC_MISSING',
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_NOT_FOUND' });
  });

  it('requires a remark for refuse and a non-self redirect target', async () => {
    await expect(
      service.create({
        action: 'refuse',
        conditions: { match: 'all' },
        name: '自动拒绝',
        processCode: 'PROC_1',
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_INVALID' });

    resolveStaff.mockResolvedValue({ name: '张三', staffId: 'staff_me' });
    await expect(
      service.create({
        action: 'redirect',
        conditions: { match: 'all' },
        name: '转给自己',
        processCode: 'PROC_1',
        redirectToStaffToken: 'staff:staff_me',
      }),
    ).rejects.toMatchObject({ code: 'DINGTALK_INVALID' });
  });

  it('creates a rule with a resolved redirect target', async () => {
    const created = await service.create({
      action: 'redirect',
      conditions: {
        fields: [{ componentId: 'NumberField-1', label: '金额', op: 'gte', value: 100 }],
        match: 'all',
      },
      name: '转交财务',
      processCode: 'PROC_1',
      redirectToStaffToken: 'staff:staff_other',
      remark: '请财务处理',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'redirect',
        processName: '差旅报销',
        redirectToName: '李四',
        redirectToStaffId: 'staff_other',
        staffId: 'staff_me',
      }),
    );
    expect(created.id).toBe('rule_1');
  });

  it('strict tier defaults expiry to 30 days and rejects refuse without remark in preview', async () => {
    getDingtalkWorkspaceCapabilities.mockResolvedValue({
      approval: true,
      automationTier: 'strict',
      calendar: false,
      todo: false,
    });
    const preview = await service.previewRule({
      action: 'agree',
      conditions: { match: 'all' },
      name: '严格同意',
      processCode: 'PROC_1',
    });
    expect(preview.danger).toBe(false);
    expect(preview.lines.some((line) => line.label === '有效期' && line.value !== '永久')).toBe(
      true,
    );
    expect(preview.actingAs.name).toBe('张三');
  });

  it('attaches dailyCap and originatorLabels on list and get', async () => {
    const stored = {
      action: 'agree' as const,
      conditions: {
        match: 'all' as const,
        originators: { deptIds: ['dept_1'], staffIds: ['staff_originator'] },
      },
      dailyCount: 3,
      enabled: true,
      id: 'rule_1',
      name: '自动同意',
      processCode: 'PROC_1',
      processName: '差旅',
      staffId: 'staff_me',
      userId: 'user_1',
    };
    list.mockResolvedValue([stored]);
    findById.mockResolvedValue(stored);

    const listed = await service.list();
    expect(listed[0]).toMatchObject({
      dailyCap: 50,
      originatorLabels: { dept_1: '研发部', staff_originator: '张三' },
    });

    getDingtalkWorkspaceCapabilities.mockResolvedValue({
      approval: true,
      automationTier: 'strict',
      calendar: false,
      todo: false,
    });
    const got = await service.get('rule_1');
    expect(got.dailyCap).toBe(20);
    expect(got.originatorLabels).toEqual({ dept_1: '研发部', staff_originator: '张三' });
  });

  it('lets the owner re-enable a user-paused rule', async () => {
    findById.mockResolvedValue({
      action: 'agree',
      conditions: { match: 'all' },
      disabledReason: 'user',
      enabled: false,
      expiresAt: null,
      id: 'rule_1',
      name: '自动同意',
      processCode: 'PROC_1',
      remark: null,
      redirectToStaffId: null,
    });
    update.mockResolvedValue({ enabled: true, id: 'rule_1' });
    await expect(service.setEnabled('rule_1', true)).resolves.toMatchObject({ enabled: true });
    expect(update).toHaveBeenCalledWith('rule_1', { enabled: true });
  });

  it('refuses to re-enable admin, identity, or tier-stopped rules', async () => {
    for (const reason of ['admin', 'identity_invalid', 'tier_off'] as const) {
      findById.mockResolvedValue({
        action: 'agree',
        conditions: { match: 'all' },
        disabledReason: reason,
        enabled: false,
        expiresAt: null,
        id: 'rule_1',
        name: '自动同意',
        processCode: 'PROC_1',
      });
      await expect(service.setEnabled('rule_1', true)).rejects.toMatchObject({
        code: 'DINGTALK_FORBIDDEN',
      });
      await expect(service.update('rule_1', { enabled: true })).rejects.toMatchObject({
        code: 'DINGTALK_FORBIDDEN',
      });
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses to re-enable an expired rule', async () => {
    findById.mockResolvedValue({
      action: 'agree',
      conditions: { match: 'all' },
      disabledReason: 'expired',
      enabled: false,
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      id: 'rule_1',
      name: '自动同意',
      processCode: 'PROC_1',
    });
    await expect(service.setEnabled('rule_1', true)).rejects.toMatchObject({
      code: 'DINGTALK_INVALID',
    });

    findById.mockResolvedValue({
      action: 'agree',
      conditions: { match: 'all' },
      disabledReason: 'user',
      enabled: false,
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      id: 'rule_1',
      name: '自动同意',
      processCode: 'PROC_1',
    });
    await expect(service.update('rule_1', { enabled: true })).rejects.toMatchObject({
      code: 'DINGTALK_INVALID',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('maps a concurrent enable CAS miss to forbidden or invalid', async () => {
    findById.mockResolvedValue({
      action: 'agree',
      conditions: { match: 'all' },
      disabledReason: 'user',
      enabled: false,
      expiresAt: null,
      id: 'rule_1',
      name: '自动同意',
      processCode: 'PROC_1',
      remark: null,
      redirectToStaffId: null,
    });
    update.mockRejectedValueOnce(new DingtalkApprovalRuleEnableBlockedError('forbidden'));
    await expect(service.setEnabled('rule_1', true)).rejects.toMatchObject({
      code: 'DINGTALK_FORBIDDEN',
    });

    update.mockRejectedValueOnce(new DingtalkApprovalRuleEnableBlockedError('expired'));
    await expect(service.setEnabled('rule_1', true)).rejects.toMatchObject({
      code: 'DINGTALK_INVALID',
    });
  });
});
