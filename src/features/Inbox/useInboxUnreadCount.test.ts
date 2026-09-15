import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { inboxKeys } from '@/libs/swr/keys';

import {
  INBOX_UNREAD_COUNT_DEDUPING_INTERVAL,
  INBOX_UNREAD_COUNT_REFRESH_INTERVAL,
  useInboxUnreadCount,
} from './useInboxUnreadCount';

const mocks = vi.hoisted(() => ({
  state: {
    isSignedIn: false,
  },
  useClientPollingSWR: vi.fn(() => ({ data: undefined })),
}));

vi.mock('@/libs/swr', () => ({
  useClientPollingSWR: mocks.useClientPollingSWR,
}));

vi.mock('@/services/notification', () => ({
  notificationService: {
    getUnreadCount: vi.fn(),
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { isSignedIn: boolean }) => boolean) =>
    selector({ isSignedIn: mocks.state.isSignedIn }),
}));

vi.mock('@/store/user/selectors', () => ({
  authSelectors: {
    isLogin: (state: { isSignedIn: boolean }) => state.isSignedIn,
  },
}));

beforeEach(() => {
  mocks.state.isSignedIn = false;
  mocks.useClientPollingSWR.mockClear();
  mocks.useClientPollingSWR.mockReturnValue({ data: undefined });
});

describe('useInboxUnreadCount', () => {
  it('does not request unread count before login', () => {
    const { result } = renderHook(() => useInboxUnreadCount());

    expect(result.current.enabled).toBe(false);
    expect(mocks.useClientPollingSWR).toHaveBeenCalledWith(null, expect.any(Function), {
      dedupingInterval: INBOX_UNREAD_COUNT_DEDUPING_INTERVAL,
      refreshInterval: INBOX_UNREAD_COUNT_REFRESH_INTERVAL,
    });
  });

  /**
   * Task reminders land in this inbox for everyone, so the bell must not depend on
   * `enableBusinessFeatures` any more — the hook no longer reads the server config at all.
   */
  it('requests unread count for any signed-in user, without the business feature flag', () => {
    mocks.state.isSignedIn = true;

    const { result } = renderHook(() => useInboxUnreadCount());

    expect(result.current.enabled).toBe(true);
    expect(mocks.useClientPollingSWR).toHaveBeenCalledWith(
      inboxKeys.unreadCount(),
      expect.any(Function),
      {
        dedupingInterval: INBOX_UNREAD_COUNT_DEDUPING_INTERVAL,
        refreshInterval: INBOX_UNREAD_COUNT_REFRESH_INTERVAL,
      },
    );
  });

  it('polls unread count once per minute while deduping repeated requests', () => {
    expect(INBOX_UNREAD_COUNT_REFRESH_INTERVAL).toBe(60_000);
    expect(INBOX_UNREAD_COUNT_DEDUPING_INTERVAL).toBe(30_000);
    expect(INBOX_UNREAD_COUNT_REFRESH_INTERVAL).toBeGreaterThan(
      INBOX_UNREAD_COUNT_DEDUPING_INTERVAL,
    );
  });
});
