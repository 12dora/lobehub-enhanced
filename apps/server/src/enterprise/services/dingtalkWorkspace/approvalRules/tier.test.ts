// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const truncateExpiry = vi.fn();
const listRulesAtOrOverMaxExpiry = vi.fn();
const notifyUser = vi.fn();

vi.mock('@/database/models/dingtalkApprovalRule', () => ({
  DingtalkApprovalRuleModel: { listRulesAtOrOverMaxExpiry, truncateExpiry },
}));

vi.mock('../notify', () => ({
  notifyUser: (...args: unknown[]) => notifyUser(...args),
}));

const { applyAutomationTierChange, notifyAutomationTierTruncation, ruleExceedsTierMaxExpiry } =
  await import('./tier');

describe('applyAutomationTierChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    truncateExpiry.mockResolvedValue([]);
    listRulesAtOrOverMaxExpiry.mockResolvedValue([]);
    notifyUser.mockResolvedValue(undefined);
  });

  it('no-ops when the saved tier is not strict', async () => {
    await expect(applyAutomationTierChange({} as never, 'moderate', 'moderate')).resolves.toEqual({
      rows: [],
      truncated: 0,
    });
    await expect(applyAutomationTierChange({} as never, 'strict', 'off')).resolves.toEqual({
      rows: [],
      truncated: 0,
    });
    expect(truncateExpiry).not.toHaveBeenCalled();
    expect(listRulesAtOrOverMaxExpiry).not.toHaveBeenCalled();
  });

  it('truncates even when the saved tier is already strict', async () => {
    truncateExpiry.mockResolvedValue([]);
    await expect(applyAutomationTierChange({} as never, 'strict', 'strict')).resolves.toEqual({
      rows: [],
      truncated: 0,
    });
    expect(truncateExpiry).toHaveBeenCalledTimes(1);
    expect(listRulesAtOrOverMaxExpiry).toHaveBeenCalledTimes(1);
  });

  it('returns truncated rows without sending work notices', async () => {
    const rows = [
      { id: 'r1', name: '差旅', staffId: 'staff_a', userId: 'u1' },
      { id: 'r2', name: '请假', staffId: 'staff_a', userId: 'u1' },
      { id: 'r3', name: '采购', staffId: 'staff_b', userId: 'u2' },
    ];
    truncateExpiry.mockResolvedValue(rows);

    const result = await applyAutomationTierChange(
      {} as never,
      'moderate',
      'strict',
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result).toEqual({ rows, truncated: 3 });
    expect(truncateExpiry).toHaveBeenCalledTimes(1);
    expect(listRulesAtOrOverMaxExpiry).not.toHaveBeenCalled();
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('falls back to at-or-over-cap rows when truncate matches nothing', async () => {
    const atCap = [{ id: 'r1', name: '差旅', staffId: 'staff_a', userId: 'u1' }];
    listRulesAtOrOverMaxExpiry.mockResolvedValue(atCap);
    await expect(applyAutomationTierChange({} as never, 'strict', 'strict')).resolves.toEqual({
      rows: atCap,
      truncated: 0,
    });
    expect(notifyUser).not.toHaveBeenCalled();
  });
});

describe('notifyAutomationTierTruncation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifyUser.mockResolvedValue(undefined);
  });

  it('notifies each owner once', async () => {
    await notifyAutomationTierTruncation(
      [
        { id: 'r1', name: '差旅', staffId: 'staff_a', userId: 'u1' },
        { id: 'r2', name: '请假', staffId: 'staff_a', userId: 'u1' },
        { id: 'r3', name: '采购', staffId: 'staff_b', userId: 'u2' },
      ] as never,
      new Date('2026-01-01T00:00:00.000Z'),
    );
    expect(notifyUser).toHaveBeenCalledTimes(2);
    expect(notifyUser.mock.calls.map((call) => call[0]).sort()).toEqual(['staff_a', 'staff_b']);
  });

  it('no-ops on an empty row list', async () => {
    await notifyAutomationTierTruncation([]);
    expect(notifyUser).not.toHaveBeenCalled();
  });
});

describe('ruleExceedsTierMaxExpiry', () => {
  it('treats missing or over-long expiry as not executable under a max-expiry cap', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(ruleExceedsTierMaxExpiry(null, null, now)).toBe(false);
    expect(ruleExceedsTierMaxExpiry(null, 90, now)).toBe(true);
    expect(ruleExceedsTierMaxExpiry(new Date('2026-02-01T00:00:00.000Z'), 90, now)).toBe(false);
    expect(ruleExceedsTierMaxExpiry(new Date('2026-06-01T00:00:00.000Z'), 90, now)).toBe(true);
  });
});
