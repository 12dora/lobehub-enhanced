import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearDingTalkCards,
  clearDingTalkSessions,
  getDingTalkCard,
  getDingTalkSession,
  rememberDingTalkCard,
  rememberDingTalkSession,
} from './threadId';

describe('DingTalk session memory', () => {
  beforeEach(() => {
    clearDingTalkSessions();
    clearDingTalkCards();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearDingTalkSessions();
    clearDingTalkCards();
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

  it('refuses to remember cards without conversationId and askerStaffId', () => {
    rememberDingTalkCard('out_empty', {
      askerStaffId: '',
      conversationId: 'cid_1',
    });
    rememberDingTalkCard('out_empty_cid', {
      askerStaffId: 'staff_1',
      conversationId: '',
    });
    expect(getDingTalkCard('out_empty')).toBeUndefined();
    expect(getDingTalkCard('out_empty_cid')).toBeUndefined();
  });
});
