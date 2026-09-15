import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearDingTalkSessions, getDingTalkSession, rememberDingTalkSession } from './threadId';

describe('DingTalk session memory', () => {
  beforeEach(() => {
    clearDingTalkSessions();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearDingTalkSessions();
  });

  it('expires remembered sessions after the TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    rememberDingTalkSession({
      conversationId: 'cid_1',
      conversationType: '1',
      senderStaffId: 'staff_1',
    });
    expect(getDingTalkSession('cid_1')).toBeDefined();
    vi.advanceTimersByTime(8 * 60 * 60 * 1000 + 1);
    expect(getDingTalkSession('cid_1')).toBeUndefined();
  });
});
