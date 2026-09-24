// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import {
  APPROVAL_RULE_EVALUATED_TTL_MS,
  APPROVAL_RULE_REVERIFY_MS,
  fingerprintEnabledApprovalRules,
  invalidateApprovalRuleWorkerMemory,
  markOwnerScanStarted,
  ownerTaskIsRemembered,
  rememberOwnerTask,
  resetApprovalRuleWorkerMemoryForTest,
  syncOwnerTaskMemory,
} from './workerMemory';

const baseRule = {
  conditions: { match: 'all' as const },
  enabled: true,
  id: 'rule_1',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('approval rule worker memory', () => {
  beforeEach(() => {
    resetApprovalRuleWorkerMemoryForTest();
  });

  it('changes fingerprint when an enabled rule id, updatedAt, or conditions change', () => {
    const original = fingerprintEnabledApprovalRules([baseRule]);
    expect(fingerprintEnabledApprovalRules([{ ...baseRule, id: 'rule_2' }])).not.toBe(original);
    expect(
      fingerprintEnabledApprovalRules([
        { ...baseRule, updatedAt: new Date('2026-02-01T00:00:00.000Z') },
      ]),
    ).not.toBe(original);
    expect(
      fingerprintEnabledApprovalRules([
        {
          ...baseRule,
          conditions: { match: 'all', originators: { staffIds: ['staff_a'] } },
        },
      ]),
    ).not.toBe(original);
    expect(fingerprintEnabledApprovalRules([{ ...baseRule, enabled: false }])).not.toBe(original);
  });

  it('ignores disabled rules and is stable for key order in conditions', () => {
    const left = fingerprintEnabledApprovalRules([
      {
        ...baseRule,
        conditions: { fields: [], match: 'all', originators: { staffIds: ['a'] } },
      },
    ]);
    const right = fingerprintEnabledApprovalRules([
      {
        ...baseRule,
        conditions: { originators: { staffIds: ['a'] }, match: 'all', fields: [] },
      },
    ]);
    expect(left).toBe(right);
    expect(
      fingerprintEnabledApprovalRules([
        baseRule,
        { ...baseRule, enabled: false, id: 'rule_disabled' },
      ]),
    ).toBe(fingerprintEnabledApprovalRules([baseRule]));
  });

  it('drops remembered tasks when the fingerprint changes or invalidate is called', () => {
    const fingerprint = fingerprintEnabledApprovalRules([baseRule]);
    const nowMs = Date.parse('2026-03-01T00:00:00.000Z');
    rememberOwnerTask('staff_me', '99', nowMs + APPROVAL_RULE_EVALUATED_TTL_MS, fingerprint);
    expect(ownerTaskIsRemembered('staff_me', '99', nowMs, fingerprint)).toBe(true);

    const nextFingerprint = fingerprintEnabledApprovalRules([{ ...baseRule, id: 'rule_2' }]);
    expect(ownerTaskIsRemembered('staff_me', '99', nowMs, nextFingerprint)).toBe(false);
    expect(syncOwnerTaskMemory('staff_me', nextFingerprint, nowMs).rememberedCount).toBe(0);

    rememberOwnerTask('staff_me', '99', nowMs + APPROVAL_RULE_EVALUATED_TTL_MS, nextFingerprint);
    invalidateApprovalRuleWorkerMemory('staff_me');
    expect(ownerTaskIsRemembered('staff_me', '99', nowMs, nextFingerprint)).toBe(false);
  });

  it('prunes expired task ids and requires a 60 minute gap before the same-count re-verify', () => {
    const fingerprint = fingerprintEnabledApprovalRules([baseRule]);
    const nowMs = Date.parse('2026-03-01T00:00:00.000Z');
    rememberOwnerTask('staff_me', '99', nowMs + 10, fingerprint);
    markOwnerScanStarted('staff_me', fingerprint, nowMs);

    expect(syncOwnerTaskMemory('staff_me', fingerprint, nowMs + 11).rememberedCount).toBe(0);
    expect(syncOwnerTaskMemory('staff_me', fingerprint, nowMs + 11).lastReverifyAtMs).toBe(nowMs);

    rememberOwnerTask('staff_me', '99', nowMs + APPROVAL_RULE_EVALUATED_TTL_MS, fingerprint);
    const reverifyAt = nowMs + APPROVAL_RULE_REVERIFY_MS - 1;
    const synced = syncOwnerTaskMemory('staff_me', fingerprint, reverifyAt);
    expect(synced.rememberedCount).toBe(1);
    expect(reverifyAt - synced.lastReverifyAtMs < APPROVAL_RULE_REVERIFY_MS).toBe(true);
    expect(APPROVAL_RULE_REVERIFY_MS).toBe(60 * 60 * 1000);
  });
});
