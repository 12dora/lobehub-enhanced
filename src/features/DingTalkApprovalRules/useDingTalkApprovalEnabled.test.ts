import { describe, expect, it } from 'vitest';

import { readDingTalkApprovalCapability } from './useDingTalkApprovalEnabled';

describe('readDingTalkApprovalCapability', () => {
  it('is true only when the server reports the flag as true', () => {
    expect(readDingTalkApprovalCapability({ capabilities: { dingtalkApproval: true } })).toBe(true);
  });

  it('fails closed on a missing, partial or malformed payload', () => {
    // Nothing reported means there is no DingTalk approval to automate, so the
    // page must stay hidden instead of promising automation that cannot run.
    expect(readDingTalkApprovalCapability(undefined)).toBe(false);
    expect(readDingTalkApprovalCapability(null)).toBe(false);
    expect(readDingTalkApprovalCapability({})).toBe(false);
    expect(readDingTalkApprovalCapability({ capabilities: null })).toBe(false);
    expect(readDingTalkApprovalCapability({ capabilities: {} })).toBe(false);
    expect(readDingTalkApprovalCapability('enabled')).toBe(false);
  });

  it('does not accept a truthy non-boolean as an answer', () => {
    expect(readDingTalkApprovalCapability({ capabilities: { dingtalkApproval: 'true' } })).toBe(
      false,
    );
    expect(readDingTalkApprovalCapability({ capabilities: { dingtalkApproval: 1 } })).toBe(false);
  });
});
