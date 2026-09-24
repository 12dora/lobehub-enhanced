// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const debugLog = vi.hoisted(() => vi.fn());
vi.mock('debug', () => ({
  default: () => debugLog,
}));

class DingtalkWorkspaceError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'DingtalkWorkspaceError';
    this.code = code;
  }
}

vi.mock('../errors', () => ({ DingtalkWorkspaceError }));
vi.mock('../capabilities', () => ({ getDingtalkWorkspaceCapabilities: vi.fn() }));
vi.mock('../notify', () => ({ notifyUser: vi.fn() }));
vi.mock('../identity', () => ({ resolveVerifiedDingtalkIdentity: vi.fn() }));
const mockInvalidatePendingCaches = vi.hoisted(() => vi.fn());
const mockInvalidateInstanceCache = vi.hoisted(() => vi.fn());

vi.mock('../approval/api', () => ({
  addCommentAs: vi.fn(),
  executeTaskAs: vi.fn(),
  getInstanceDetail: vi.fn(),
  listRunningInstanceIds: vi.fn(),
  redirectTaskAs: vi.fn(),
}));
vi.mock('../approval/pending', () => ({
  invalidateApprovalInstanceCache: (...args: unknown[]) => mockInvalidateInstanceCache(...args),
  invalidatePendingCaches: (...args: unknown[]) => mockInvalidatePendingCaches(...args),
}));
vi.mock('./todoCount', () => ({
  getPendingApprovalTaskCount: vi.fn(async () => 1),
  parsePendingApprovalTaskCount: vi.fn(),
}));
vi.mock('@/database/models/dingtalkApprovalRule', () => ({
  DingtalkApprovalRuleModel: {
    bumpDailyCount: vi.fn(),
    deleteRun: vi.fn(),
    disable: vi.fn(),
    listAllActiveRules: vi.fn(),
    reclaimStaleRun: vi.fn(),
    recordRun: vi.fn(),
    rollbackDailyCount: vi.fn(),
    tryRecordQuotaNotify: vi.fn(),
    updateRun: vi.fn(),
  },
  RUN_CLAIM_IN_PROGRESS: 'IN_PROGRESS',
}));
vi.mock('@/database/models/dingtalkDirectory', () => ({
  DingTalkDirectoryModel: class {
    getDepartment = vi.fn();
    getUsers = vi.fn(async () => [{ name: '王五' }]);
  },
}));
const mockAppendAudit = vi.hoisted(() => vi.fn());
vi.mock('../../platformAudit', () => ({
  PlatformAuditService: class {
    append = (...args: unknown[]) => mockAppendAudit(...args);
  },
}));

const {
  APPROVAL_RULE_INSTANCE_CAP,
  APPROVAL_RULE_PROCESS_CODE_CAP,
  APPROVAL_RULE_REVERIFY_MS,
  APPROVAL_RULE_SWEEP_INTERVAL_MS,
  APPROVAL_RULE_SWEEP_JITTER_MS,
  invalidateApprovalRuleWorkerMemory,
  nextApprovalRuleSweepDelayMs,
  runApprovalRulesCycle,
  runApprovalRulesCycleSingleFlight,
  stopDingtalkApprovalRuleWorkerForTest,
} = await import('./worker');

const rule = {
  action: 'agree' as const,
  conditions: { match: 'all' as const },
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  dailyCount: 0,
  dailyCountDate: null,
  enabled: true,
  expiresAt: null,
  id: 'rule_1',
  name: '自动同意',
  processCode: 'PROC_1',
  processName: '差旅',
  redirectToStaffId: null,
  remark: null,
  staffId: 'staff_me',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  userId: 'user_1',
};

const detail = {
  formComponentValues: [{ id: 'NumberField-1', name: '金额', value: '200' }],
  originatorDeptId: 'dept_1',
  originatorUserId: 'staff_originator',
  status: 'RUNNING',
  tasks: [{ status: 'RUNNING', taskId: 99, userId: 'staff_me' }],
  title: '差旅报销',
};

describe('runApprovalRulesCycle', () => {
  const executeTaskAs = vi.fn();
  const addCommentAs = vi.fn();
  const recordRun = vi.fn();
  const reclaimStaleRun = vi.fn();
  const tryRecordQuotaNotify = vi.fn();
  const updateRun = vi.fn();
  const deleteRun = vi.fn();
  const rollbackDailyCount = vi.fn();
  const bumpDailyCount = vi.fn();
  const notify = vi.fn();
  const disable = vi.fn();
  const writeAudit = vi.fn();

  const run = (overrides: Record<string, unknown> = {}) =>
    runApprovalRulesCycle(
      {} as never,
      {
        addCommentAs,
        bumpDailyCount,
        capabilities: async () => ({
          approval: true,
          automationTier: 'moderate',
          calendar: false,
          todo: false,
        }),
        collectOriginatorDeptIds: async () => ['dept_1'],
        deleteRun,
        disable,
        executeTaskAs,
        getInstanceDetail: async () => detail,
        getPendingTaskCount: async () => 1,
        listAllActiveRules: async () => [rule],
        listExpiredEnabled: async () => [],
        listRunningInstanceIds: async () => ['inst_1'],
        lookupOriginatorNames: async () => new Map([['staff_originator', '王五']]),
        now: new Date('2026-03-01T00:00:00.000Z'),
        notifyUser: notify,
        reclaimStaleRun,
        recordRun,
        resolveVerifiedDingtalkIdentity: async () => ({
          name: '张三',
          staffId: 'staff_me',
          unionId: 'union_me',
        }),
        rollbackDailyCount,
        transact: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
        tryRecordQuotaNotify,
        updateRun,
        writeAudit,
        ...overrides,
      } as never,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvalidateInstanceCache.mockReset();
    mockInvalidatePendingCaches.mockReset();
    stopDingtalkApprovalRuleWorkerForTest();
    rule.dailyCount = 0;
    rule.dailyCountDate = null;
    executeTaskAs.mockResolvedValue(undefined);
    addCommentAs.mockResolvedValue(undefined);
    recordRun.mockResolvedValue(true);
    reclaimStaleRun.mockResolvedValue(false);
    tryRecordQuotaNotify.mockResolvedValue(true);
    updateRun.mockResolvedValue(true);
    deleteRun.mockResolvedValue(true);
    rollbackDailyCount.mockResolvedValue(0);
    bumpDailyCount.mockResolvedValue(1);
    notify.mockResolvedValue(undefined);
    disable.mockResolvedValue(rule);
    writeAudit.mockResolvedValue(undefined);
    mockAppendAudit.mockResolvedValue(undefined);
  });

  it('skips when approval is off or the tier is off', async () => {
    await expect(
      run({
        capabilities: async () => ({
          approval: false,
          automationTier: 'moderate',
          calendar: false,
          todo: false,
        }),
      }),
    ).resolves.toMatchObject({ skippedReason: 'feature_disabled' });
    await expect(
      run({
        capabilities: async () => ({
          approval: true,
          automationTier: 'off',
          calendar: false,
          todo: false,
        }),
      }),
    ).resolves.toMatchObject({ skippedReason: 'automation_off' });
    expect(executeTaskAs).not.toHaveBeenCalled();
  });

  it('executes the first matching owner rule and notifies', async () => {
    const result = await run();
    expect(result.counts.executed).toBe(1);
    expect(recordRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorCode: 'IN_PROGRESS',
        originatorName: '王五',
        status: 'failed',
        taskId: '99',
      }),
    );
    expect(recordRun.mock.invocationCallOrder[0]!).toBeLessThan(
      executeTaskAs.mock.invocationCallOrder[0]!,
    );
    expect(executeTaskAs).toHaveBeenCalledWith(
      'staff_me',
      expect.objectContaining({ processInstanceId: 'inst_1', result: 'agree', taskId: 99 }),
    );
    expect(updateRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'succeeded', taskId: '99' }),
    );
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'agree',
        processInstanceId: 'inst_1',
        processName: '差旅',
        ruleId: 'rule_1',
        ruleName: '自动同意',
        title: '差旅报销',
        userId: 'user_1',
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      'staff_me',
      expect.objectContaining({
        lines: [expect.stringContaining('已按规则「自动同意」自动同意')],
      }),
    );
    expect(mockInvalidatePendingCaches).toHaveBeenCalledWith('user_1');
    expect(mockInvalidateInstanceCache).toHaveBeenCalledWith('inst_1');
  });

  it('stores instance title and rule name on the default rule_executed audit append', async () => {
    await run({ writeAudit: undefined });
    expect(mockAppendAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'dingtalk.approval.rule_executed',
        afterDiff: expect.objectContaining({
          processName: '差旅',
          ruleName: '自动同意',
          title: '差旅报销',
        }),
        targetId: 'inst_1',
        targetType: 'dingtalk_approval',
      }),
    );
  });

  it('skips DingTalk when the (rule, task) row is already claimed', async () => {
    recordRun.mockResolvedValue(false);
    const result = await run();
    expect(executeTaskAs).not.toHaveBeenCalled();
    expect(result.counts.skipped).toBe(1);
    expect(bumpDailyCount).not.toHaveBeenCalled();
  });

  it('uses bumpDailyCount as the cap gate and does not keep a unique row on over-cap', async () => {
    bumpDailyCount.mockResolvedValue(null);
    const result = await run();
    expect(executeTaskAs).not.toHaveBeenCalled();
    expect(recordRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorCode: 'IN_PROGRESS',
        status: 'failed',
        taskId: '99',
      }),
    );
    expect(bumpDailyCount).toHaveBeenCalledWith(expect.anything(), 'rule_1', '2026-03-01', {
      cap: 50,
    });
    expect(deleteRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ruleId: 'rule_1', taskId: '99' }),
    );
    expect(updateRun).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'skipped_quota' }),
    );
    expect(tryRecordQuotaNotify).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      'staff_me',
      expect.objectContaining({
        lines: [expect.stringContaining('今日自动处理已达上限')],
      }),
    );
    expect(result.counts.skipped).toBe(1);
  });

  it('does not notify again when the daily counter is already at the cap', async () => {
    tryRecordQuotaNotify.mockResolvedValue(false);
    const listRunningInstanceIds = vi.fn(async () => ['inst_1']);
    const getInstanceDetail = vi.fn(async () => detail);
    await run({
      getInstanceDetail,
      listAllActiveRules: async () => [{ ...rule, dailyCount: 50, dailyCountDate: '2026-03-01' }],
      listRunningInstanceIds,
    });
    expect(notify).not.toHaveBeenCalled();
    expect(executeTaskAs).not.toHaveBeenCalled();
    expect(recordRun).not.toHaveBeenCalled();
    expect(bumpDailyCount).not.toHaveBeenCalled();
    expect(listRunningInstanceIds).not.toHaveBeenCalled();
    expect(getInstanceDetail).not.toHaveBeenCalled();
  });

  it('disables the rule when the owner identity is no longer verified', async () => {
    await run({
      resolveVerifiedDingtalkIdentity: async () => ({ error: 'DINGTALK_IDENTITY_UNVERIFIED' }),
    });
    expect(disable).toHaveBeenCalledWith(expect.anything(), 'rule_1', 'identity_invalid');
    expect(notify).toHaveBeenCalledWith(
      'staff_me',
      expect.objectContaining({
        lines: [expect.stringMatching(/\[用钉钉登录\]\([^)]*\/dingtalk\/sso\?redirect=%2F\)/)],
        title: '自动审批规则已停用',
      }),
    );
    expect(executeTaskAs).not.toHaveBeenCalled();
    expect(recordRun).not.toHaveBeenCalled();
  });

  it('disables the rule when the re-resolved staffId no longer matches the snapshot', async () => {
    await run({
      resolveVerifiedDingtalkIdentity: async () => ({
        name: '张三',
        staffId: 'staff_other',
        unionId: 'union_me',
      }),
    });
    expect(disable).toHaveBeenCalledWith(expect.anything(), 'rule_1', 'identity_invalid');
    expect(executeTaskAs).not.toHaveBeenCalled();
    expect(recordRun).not.toHaveBeenCalled();
  });

  it('re-fetches the instance and skips when the task is no longer RUNNING for the actor', async () => {
    const getInstanceDetail = vi
      .fn()
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce({
        ...detail,
        tasks: [{ status: 'COMPLETED', taskId: 99, userId: 'staff_me' }],
      });
    const result = await run({ getInstanceDetail });
    expect(getInstanceDetail).toHaveBeenCalledTimes(2);
    expect(getInstanceDetail).toHaveBeenNthCalledWith(1, 'inst_1');
    expect(getInstanceDetail).toHaveBeenNthCalledWith(2, 'inst_1', { fresh: true });
    expect(executeTaskAs).not.toHaveBeenCalled();
    expect(deleteRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ruleId: 'rule_1', taskId: '99' }),
    );
    expect(rollbackDailyCount).toHaveBeenCalled();
    expect(result.counts.skipped).toBe(1);
  });

  it('stops listing processCodes on DINGTALK_RATE_LIMITED without recording a run', async () => {
    const listRunningInstanceIds = vi.fn(async () => {
      throw new DingtalkWorkspaceError('DINGTALK_RATE_LIMITED');
    });
    const result = await run({
      listAllActiveRules: async () => [rule, { ...rule, id: 'rule_2', processCode: 'PROC_2' }],
      listRunningInstanceIds,
    });
    expect(listRunningInstanceIds).toHaveBeenCalledTimes(1);
    expect(recordRun).not.toHaveBeenCalled();
    expect(result.counts.failed).toBe(0);
  });

  it('releases the claimed run and stops the cycle on DINGTALK_RATE_LIMITED', async () => {
    executeTaskAs.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_RATE_LIMITED'));
    const listRunningInstanceIds = vi
      .fn()
      .mockResolvedValueOnce(['inst_1'])
      .mockResolvedValueOnce(['inst_2']);
    const result = await run({
      listAllActiveRules: async () => [rule, { ...rule, id: 'rule_2', processCode: 'PROC_2' }],
      listRunningInstanceIds,
    });
    expect(deleteRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ruleId: 'rule_1', taskId: '99' }),
    );
    expect(rollbackDailyCount).toHaveBeenCalled();
    expect(updateRun).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'failed' }),
    );
    expect(result.counts.failed).toBe(0);
    expect(listRunningInstanceIds).toHaveBeenCalledTimes(1);
  });

  it('releases the claim on DINGTALK_UNAVAILABLE so the task is retried', async () => {
    executeTaskAs.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_UNAVAILABLE'));
    const result = await run();
    expect(deleteRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ruleId: 'rule_1', taskId: '99' }),
    );
    expect(rollbackDailyCount).toHaveBeenCalled();
    expect(updateRun).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'failed' }),
    );
    expect(result.counts.failed).toBe(0);
  });

  it('releases the claim in one transaction and syncs in-memory dailyCount', async () => {
    const liveRule = { ...rule, dailyCount: 0, dailyCountDate: null as string | null };
    let releaseTx: unknown;
    const transact = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { id: transact.mock.calls.length };
      const result = await fn(tx);
      if (deleteRun.mock.calls.some((call) => call[0] === tx)) releaseTx = tx;
      return result;
    });
    bumpDailyCount.mockResolvedValue(1);
    rollbackDailyCount.mockResolvedValue(0);
    executeTaskAs.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_UNAVAILABLE'));
    await run({ listAllActiveRules: async () => [liveRule], transact });
    expect(releaseTx).toBeDefined();
    expect(deleteRun).toHaveBeenCalledWith(
      releaseTx,
      expect.objectContaining({ ruleId: 'rule_1', taskId: '99' }),
    );
    expect(rollbackDailyCount).toHaveBeenCalledWith(releaseTx, 'rule_1', '2026-03-01');
    expect(liveRule.dailyCount).toBe(0);
    expect(liveRule.dailyCountDate).toBe('2026-03-01');
  });

  it('does not re-post a comment when reclaiming an already-remarked instance', async () => {
    recordRun.mockResolvedValue(false);
    reclaimStaleRun.mockResolvedValue(true);
    const getInstanceDetail = vi
      .fn()
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce({
        ...detail,
        operationRecords: [{ remark: '已阅', type: 'ADD_REMARK', userId: 'staff_me' }],
      });
    const result = await run({
      getInstanceDetail,
      listAllActiveRules: async () => [{ ...rule, action: 'comment' as const, remark: '已阅' }],
    });
    expect(addCommentAs).not.toHaveBeenCalled();
    expect(updateRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'succeeded', taskId: '99' }),
    );
    expect(result.counts.executed).toBe(1);
  });

  it('re-posts a comment on reclaim when no matching remark exists', async () => {
    recordRun.mockResolvedValue(false);
    reclaimStaleRun.mockResolvedValue(true);
    await run({
      listAllActiveRules: async () => [{ ...rule, action: 'comment' as const, remark: '已阅' }],
    });
    expect(addCommentAs).toHaveBeenCalledWith(
      'staff_me',
      expect.objectContaining({ processInstanceId: 'inst_1', text: '已阅' }),
    );
  });

  it('skips notify when updateRun CAS misses', async () => {
    updateRun.mockResolvedValue(false);
    const result = await run();
    expect(result.counts.executed).toBe(0);
    expect(result.counts.skipped).toBe(1);
    expect(notify).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
    expect(mockInvalidatePendingCaches).toHaveBeenCalledWith('user_1');
    expect(mockInvalidateInstanceCache).toHaveBeenCalledWith('inst_1');
  });

  it('keeps the unique row on a definitive DingTalk rejection and releases the slot', async () => {
    executeTaskAs.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_FORBIDDEN'));
    const result = await run();
    expect(deleteRun).not.toHaveBeenCalled();
    expect(updateRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorCode: 'DINGTALK_FORBIDDEN',
        status: 'failed',
        taskId: '99',
      }),
    );
    expect(rollbackDailyCount).toHaveBeenCalled();
    expect(result.counts.failed).toBe(1);
    expect(mockInvalidatePendingCaches).not.toHaveBeenCalled();
    expect(mockInvalidateInstanceCache).not.toHaveBeenCalled();
  });

  it('reclaims a stale IN_PROGRESS row without bumping the daily counter again', async () => {
    recordRun.mockResolvedValue(false);
    reclaimStaleRun.mockResolvedValue(true);
    const result = await run();
    expect(executeTaskAs).toHaveBeenCalled();
    expect(bumpDailyCount).not.toHaveBeenCalled();
    expect(result.counts.executed).toBe(1);
  });

  it('passes max 300 and caps distinct processCodes per cycle', async () => {
    const listRunningInstanceIds = vi.fn(
      async (_processCode: string, _sinceMs: number, _max?: number): Promise<string[]> => [],
    );
    const many = Array.from({ length: APPROVAL_RULE_PROCESS_CODE_CAP + 3 }, (_, index) => ({
      ...rule,
      id: `rule_${index}`,
      processCode: `PROC_${String(index).padStart(3, '0')}`,
    }));
    await run({ listAllActiveRules: async () => many, listRunningInstanceIds });
    expect(listRunningInstanceIds).toHaveBeenCalledTimes(APPROVAL_RULE_PROCESS_CODE_CAP);
    expect(listRunningInstanceIds).toHaveBeenCalledWith(
      'PROC_000',
      expect.any(Number),
      APPROVAL_RULE_INSTANCE_CAP,
    );
    expect(listRunningInstanceIds.mock.calls.map((call) => call[0])).not.toContain('PROC_050');
  });

  it('rotates leftover processCodes onto the next cycle', async () => {
    const listRunningInstanceIds = vi.fn(
      async (_processCode: string, _sinceMs: number, _max?: number): Promise<string[]> => [],
    );
    const many = Array.from({ length: APPROVAL_RULE_PROCESS_CODE_CAP + 3 }, (_, index) => ({
      ...rule,
      id: `rule_${index}`,
      processCode: `PROC_${String(index).padStart(3, '0')}`,
    }));
    await run({ listAllActiveRules: async () => many, listRunningInstanceIds });
    listRunningInstanceIds.mockClear();
    await run({ listAllActiveRules: async () => many, listRunningInstanceIds });
    const codes = listRunningInstanceIds.mock.calls.map((call) => call[0]);
    expect(codes).toContain('PROC_050');
    expect(codes).toContain('PROC_051');
    expect(codes).toContain('PROC_052');
    expect(codes).not.toContain('PROC_049');
  });

  it('drops over-expiry rules before grouping so they do not occupy processCode slots', async () => {
    const listRunningInstanceIds = vi.fn(
      async (_processCode: string, _sinceMs: number, _max?: number): Promise<string[]> => [],
    );
    const over = Array.from({ length: APPROVAL_RULE_PROCESS_CODE_CAP }, (_, index) => ({
      ...rule,
      expiresAt: null,
      id: `over_${index}`,
      processCode: `PROC_OVER_${String(index).padStart(3, '0')}`,
    }));
    const valid = {
      ...rule,
      expiresAt: new Date('2026-04-01T00:00:00.000Z'),
      id: 'valid',
      processCode: 'PROC_VALID',
    };
    await run({
      capabilities: async () => ({
        approval: true,
        automationTier: 'strict',
        calendar: false,
        todo: false,
      }),
      listAllActiveRules: async () => [...over, valid],
      listRunningInstanceIds,
    });
    expect(listRunningInstanceIds).toHaveBeenCalledTimes(1);
    expect(listRunningInstanceIds).toHaveBeenCalledWith(
      'PROC_VALID',
      expect.any(Number),
      APPROVAL_RULE_INSTANCE_CAP,
    );
  });

  it('falls back to the originator staffId when the directory has no name', async () => {
    await run({
      lookupOriginatorNames: async () => new Map(),
    });
    expect(recordRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ originatorName: 'staff_originator' }),
    );
  });

  it('does not execute strict-tier rules with no expiry or expiry past the cap', async () => {
    const far = new Date('2026-12-01T00:00:00.000Z');
    await run({
      capabilities: async () => ({
        approval: true,
        automationTier: 'strict',
        calendar: false,
        todo: false,
      }),
      listAllActiveRules: async () => [{ ...rule, expiresAt: null }],
    });
    expect(executeTaskAs).not.toHaveBeenCalled();

    await run({
      capabilities: async () => ({
        approval: true,
        automationTier: 'strict',
        calendar: false,
        todo: false,
      }),
      listAllActiveRules: async () => [{ ...rule, expiresAt: far }],
    });
    expect(executeTaskAs).not.toHaveBeenCalled();

    await run({
      capabilities: async () => ({
        approval: true,
        automationTier: 'strict',
        calendar: false,
        todo: false,
      }),
      listAllActiveRules: async () => [
        { ...rule, expiresAt: new Date('2026-04-01T00:00:00.000Z') },
      ],
    });
    expect(executeTaskAs).toHaveBeenCalledTimes(1);
  });

  it('claims a comment action before calling DingTalk', async () => {
    await run({
      listAllActiveRules: async () => [{ ...rule, action: 'comment' as const, remark: '已阅' }],
    });
    expect(recordRun.mock.invocationCallOrder[0]!).toBeLessThan(
      addCommentAs.mock.invocationCallOrder[0]!,
    );
    expect(addCommentAs).toHaveBeenCalled();
    expect(executeTaskAs).not.toHaveBeenCalled();
  });

  it('disables expired rules before scanning', async () => {
    await run({
      listAllActiveRules: async () => [],
      listExpiredEnabled: async () => [rule],
    });
    expect(disable).toHaveBeenCalledWith(expect.anything(), 'rule_1', 'expired');
  });

  it('holds a single in-process flight', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runApprovalRulesCycleSingleFlight({} as never, {
      capabilities: async () => {
        await blocked;
        return { approval: false, automationTier: 'off', calendar: false, todo: false };
      },
    });
    const second = await runApprovalRulesCycleSingleFlight({} as never, {
      capabilities: async () => ({
        approval: true,
        automationTier: 'moderate',
        calendar: false,
        todo: false,
      }),
    });
    expect(second.skippedReason).toBe('in_flight');
    release();
    await first;
  });

  it('uses a 10 minute base interval with jitter', () => {
    expect(APPROVAL_RULE_SWEEP_INTERVAL_MS).toBe(600_000);
    expect(APPROVAL_RULE_SWEEP_JITTER_MS).toBe(30_000);
    expect(APPROVAL_RULE_REVERIFY_MS).toBe(60 * 60 * 1000);
    expect(nextApprovalRuleSweepDelayMs(() => 0.5)).toBe(600_000);
    expect(nextApprovalRuleSweepDelayMs(() => 0)).toBe(570_000);
    expect(nextApprovalRuleSweepDelayMs(() => 1)).toBe(630_000);
  });

  it('logs the DingTalk call count once per cycle', async () => {
    debugLog.mockClear();
    await run({ getPendingTaskCount: async () => 0 });
    expect(debugLog).toHaveBeenCalledWith(
      'cycle %O',
      expect.objectContaining({ dingtalkCalls: 1, executed: 0 }),
    );
  });

  it('skips listing and details when the owner pending count is 0', async () => {
    const listRunningInstanceIds = vi.fn(async () => ['inst_1']);
    const getInstanceDetail = vi.fn(async (_id: string) => detail);
    const getPendingTaskCount = vi.fn(async () => 0);
    const result = await run({ getInstanceDetail, getPendingTaskCount, listRunningInstanceIds });
    expect(getPendingTaskCount).toHaveBeenCalledTimes(1);
    expect(listRunningInstanceIds).not.toHaveBeenCalled();
    expect(getInstanceDetail).not.toHaveBeenCalled();
    expect(executeTaskAs).not.toHaveBeenCalled();
    expect(result.dingtalkCalls).toBe(1);
  });

  it('reuses one pending-count call for every rule of the same owner', async () => {
    const getPendingTaskCount = vi.fn(async () => 0);
    await run({
      getPendingTaskCount,
      listAllActiveRules: async () => [rule, { ...rule, id: 'rule_2', processCode: 'PROC_2' }],
    });
    expect(getPendingTaskCount).toHaveBeenCalledTimes(1);
    expect(getPendingTaskCount).toHaveBeenCalledWith('staff_me');
  });

  it('stops fetching instance details once owner RUNNING tasks equal the pending count', async () => {
    const listRunningInstanceIds = vi.fn(async () => ['inst_1', 'inst_2', 'inst_3']);
    const getInstanceDetail = vi.fn(async (_id: string) => detail);
    await run({
      getInstanceDetail,
      getPendingTaskCount: async () => 1,
      listRunningInstanceIds,
    });
    expect(getInstanceDetail).toHaveBeenCalledTimes(2);
    expect(getInstanceDetail).toHaveBeenNthCalledWith(1, 'inst_1');
    expect(getInstanceDetail.mock.calls.map((call) => call[0])).not.toContain('inst_2');
  });

  it('skips a rescan when pending count equals already-evaluated non-matching tasks', async () => {
    const listRunningInstanceIds = vi.fn(async () => ['inst_1']);
    const getInstanceDetail = vi.fn(async (_id: string) => detail);
    const getPendingTaskCount = vi.fn(async () => 1);
    const deps = {
      getInstanceDetail,
      getPendingTaskCount,
      listAllActiveRules: async () => [
        {
          ...rule,
          conditions: { match: 'all' as const, originators: { staffIds: ['nobody'] } },
        },
      ],
      listRunningInstanceIds,
    };
    const first = await run(deps);
    expect(first.counts.executed).toBe(0);
    expect(listRunningInstanceIds).toHaveBeenCalledTimes(1);
    expect(getInstanceDetail).toHaveBeenCalledTimes(1);

    listRunningInstanceIds.mockClear();
    getInstanceDetail.mockClear();
    const second = await run(deps);
    expect(listRunningInstanceIds).not.toHaveBeenCalled();
    expect(getInstanceDetail).not.toHaveBeenCalled();
    expect(second.dingtalkCalls).toBe(1);
  });

  it('rescans after the 24 h evaluated TTL', async () => {
    const listRunningInstanceIds = vi.fn(async () => ['inst_1']);
    const getInstanceDetail = vi.fn(async (_id: string) => detail);
    const deps = {
      getInstanceDetail,
      getPendingTaskCount: async () => 1,
      listAllActiveRules: async () => [
        {
          ...rule,
          conditions: { match: 'all' as const, originators: { staffIds: ['nobody'] } },
        },
      ],
      listRunningInstanceIds,
      now: new Date('2026-03-01T00:00:00.000Z'),
    };
    await run(deps);
    listRunningInstanceIds.mockClear();
    await run({
      ...deps,
      now: new Date('2026-03-02T01:00:00.000Z'),
    });
    expect(listRunningInstanceIds).toHaveBeenCalledTimes(1);
  });

  it('rescans when enabled-rule fingerprint changes even if pending count is unchanged', async () => {
    const listRunningInstanceIds = vi.fn(async () => ['inst_1']);
    const getInstanceDetail = vi.fn(async (_id: string) => detail);
    const nonMatching = {
      ...rule,
      conditions: { match: 'all' as const, originators: { staffIds: ['nobody'] } },
    };
    await run({
      getInstanceDetail,
      getPendingTaskCount: async () => 1,
      listAllActiveRules: async () => [nonMatching],
      listRunningInstanceIds,
    });
    listRunningInstanceIds.mockClear();
    getInstanceDetail.mockClear();
    const result = await run({
      getInstanceDetail,
      getPendingTaskCount: async () => 1,
      listAllActiveRules: async () => [
        {
          ...nonMatching,
          conditions: { match: 'all' as const },
          updatedAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      ],
      listRunningInstanceIds,
    });
    expect(listRunningInstanceIds).toHaveBeenCalledTimes(1);
    expect(getInstanceDetail).toHaveBeenCalled();
    expect(result.counts.executed).toBe(1);
  });

  it('rescans after invalidateApprovalRuleWorkerMemory even when pending count is unchanged', async () => {
    const listRunningInstanceIds = vi.fn(async () => ['inst_1']);
    const getInstanceDetail = vi.fn(async (_id: string) => detail);
    const deps = {
      getInstanceDetail,
      getPendingTaskCount: async () => 1,
      listAllActiveRules: async () => [
        {
          ...rule,
          conditions: { match: 'all' as const, originators: { staffIds: ['nobody'] } },
        },
      ],
      listRunningInstanceIds,
    };
    await run(deps);
    listRunningInstanceIds.mockClear();
    getInstanceDetail.mockClear();
    invalidateApprovalRuleWorkerMemory('staff_me');
    await run(deps);
    expect(listRunningInstanceIds).toHaveBeenCalledTimes(1);
    expect(getInstanceDetail).toHaveBeenCalledTimes(1);
  });

  it('scans when pending count exceeds remembered settled tasks', async () => {
    const listRunningInstanceIds = vi.fn(async () => ['inst_1']);
    const getInstanceDetail = vi.fn(async (_id: string) => detail);
    const deps = {
      getInstanceDetail,
      listAllActiveRules: async () => [
        {
          ...rule,
          conditions: { match: 'all' as const, originators: { staffIds: ['nobody'] } },
        },
      ],
      listRunningInstanceIds,
    };
    await run({ ...deps, getPendingTaskCount: async () => 1 });
    listRunningInstanceIds.mockClear();
    getInstanceDetail.mockClear();
    await run({ ...deps, getPendingTaskCount: async () => 2 });
    expect(listRunningInstanceIds).toHaveBeenCalledTimes(1);
    expect(getInstanceDetail).toHaveBeenCalledTimes(1);
  });

  it('re-verifies at most once every 60 minutes when pending count is not higher than remembered tasks', async () => {
    const listRunningInstanceIds = vi.fn(async () => ['inst_1']);
    const getInstanceDetail = vi.fn(async (_id: string) => detail);
    const deps = {
      getInstanceDetail,
      getPendingTaskCount: async () => 1,
      listAllActiveRules: async () => [
        {
          ...rule,
          conditions: { match: 'all' as const, originators: { staffIds: ['nobody'] } },
        },
      ],
      listRunningInstanceIds,
    };
    await run({ ...deps, now: new Date('2026-03-01T00:00:00.000Z') });
    listRunningInstanceIds.mockClear();
    await run({
      ...deps,
      now: new Date('2026-03-01T00:10:00.000Z'),
    });
    expect(listRunningInstanceIds).not.toHaveBeenCalled();

    await run({
      ...deps,
      now: new Date('2026-03-01T00:30:00.000Z'),
    });
    expect(listRunningInstanceIds).not.toHaveBeenCalled();

    await run({
      ...deps,
      now: new Date(new Date('2026-03-01T00:00:00.000Z').getTime() + APPROVAL_RULE_REVERIFY_MS),
    });
    expect(listRunningInstanceIds).toHaveBeenCalledTimes(1);
  });

  it('does not rescan a successfully commented still-pending task on the next cycle', async () => {
    const listRunningInstanceIds = vi.fn(async () => ['inst_1']);
    const getInstanceDetail = vi.fn(async (_id: string) => detail);
    const deps = {
      getInstanceDetail,
      getPendingTaskCount: async () => 1,
      listAllActiveRules: async () => [{ ...rule, action: 'comment' as const, remark: '已阅' }],
      listRunningInstanceIds,
    };
    const first = await run(deps);
    expect(first.counts.executed).toBe(1);
    expect(addCommentAs).toHaveBeenCalledTimes(1);
    listRunningInstanceIds.mockClear();
    getInstanceDetail.mockClear();
    addCommentAs.mockClear();
    const second = await run(deps);
    expect(listRunningInstanceIds).not.toHaveBeenCalled();
    expect(getInstanceDetail).not.toHaveBeenCalled();
    expect(addCommentAs).not.toHaveBeenCalled();
    expect(second.dingtalkCalls).toBe(1);
  });

  it('does not rescan a quota-skipped still-pending task on the next cycle', async () => {
    bumpDailyCount.mockResolvedValue(null);
    const listRunningInstanceIds = vi.fn(async () => ['inst_1']);
    const getInstanceDetail = vi.fn(async (_id: string) => detail);
    const live = { ...rule, dailyCount: 0, dailyCountDate: null as string | null };
    const other = { ...rule, dailyCount: 0, id: 'rule_other', processCode: 'PROC_2' };
    const deps = {
      getInstanceDetail,
      getPendingTaskCount: async () => 1,
      listAllActiveRules: async () => [live, other],
      listRunningInstanceIds,
    };
    await run(deps);
    expect(listRunningInstanceIds).toHaveBeenCalledTimes(1);
    listRunningInstanceIds.mockClear();
    getInstanceDetail.mockClear();
    await run(deps);
    expect(listRunningInstanceIds).not.toHaveBeenCalled();
    expect(getInstanceDetail).not.toHaveBeenCalled();
  });

  it('does not rescan a task whose unique run is already claimed', async () => {
    recordRun.mockResolvedValue(false);
    const listRunningInstanceIds = vi.fn(async () => ['inst_1']);
    const getInstanceDetail = vi.fn(async (_id: string) => detail);
    const deps = {
      getInstanceDetail,
      getPendingTaskCount: async () => 1,
      listRunningInstanceIds,
    };
    await run(deps);
    expect(listRunningInstanceIds).toHaveBeenCalledTimes(1);
    listRunningInstanceIds.mockClear();
    getInstanceDetail.mockClear();
    await run(deps);
    expect(listRunningInstanceIds).not.toHaveBeenCalled();
    expect(getInstanceDetail).not.toHaveBeenCalled();
  });
});
