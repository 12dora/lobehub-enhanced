import { describe, expect, it } from 'vitest';

import { APPROVAL_AUTOMATION_TIERS } from './approvalRule';

describe('APPROVAL_AUTOMATION_TIERS', () => {
  it('pins off / strict / moderate / relaxed limits', () => {
    expect(APPROVAL_AUTOMATION_TIERS.off).toMatchObject({
      executable: false,
      expiryRequired: false,
      perRuleDailyCap: null,
    });
    expect(APPROVAL_AUTOMATION_TIERS.strict).toEqual({
      defaultExpiryDays: 30,
      executable: true,
      expiryRequired: true,
      maxExpiryDays: 90,
      perRuleDailyCap: 20,
    });
    expect(APPROVAL_AUTOMATION_TIERS.moderate.perRuleDailyCap).toBe(50);
    expect(APPROVAL_AUTOMATION_TIERS.moderate.expiryRequired).toBe(false);
    expect(APPROVAL_AUTOMATION_TIERS.relaxed.perRuleDailyCap).toBeNull();
    expect(APPROVAL_AUTOMATION_TIERS.relaxed.executable).toBe(true);
  });
});
