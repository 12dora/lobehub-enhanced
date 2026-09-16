import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isDingTalkPushAvailable,
  readDingTalkBinding,
  useDingTalkPushAvailable,
} from './useDingTalkPushAvailable';

const swrState = vi.hoisted(() => ({
  data: undefined as unknown,
  error: undefined as unknown,
  isLoading: false,
  mutate: vi.fn(),
}));

vi.mock('swr', () => ({
  default: () => swrState,
}));

vi.mock('@/services/messenger', () => ({
  messengerService: { availablePlatforms: vi.fn() },
}));

describe('isDingTalkPushAvailable', () => {
  it('accepts a dingtalk platform that advertises push', () => {
    expect(
      isDingTalkPushAvailable([
        { capabilities: { chat: true, push: false }, id: 'slack' },
        { capabilities: { chat: true, push: true }, id: 'dingtalk' },
      ]),
    ).toBe(true);
  });

  it('rejects a chat-only dingtalk connector', () => {
    expect(isDingTalkPushAvailable([{ capabilities: { chat: true, push: false }, id: 'dingtalk' }])) //
      .toBe(false);
  });

  /** An older payload predates `capabilities`; treat the unknown as "no push". */
  it('rejects a payload without capabilities', () => {
    expect(isDingTalkPushAvailable([{ id: 'dingtalk' }])).toBe(false);
  });

  it('rejects when the platform is absent or the payload is not a list', () => {
    expect(isDingTalkPushAvailable([{ capabilities: { push: true }, id: 'telegram' }])).toBe(false);
    expect(isDingTalkPushAvailable(undefined)).toBe(false);
    expect(isDingTalkPushAvailable(null)).toBe(false);
  });
});

describe('readDingTalkBinding', () => {
  it('reports the linked account and its DingTalk name', () => {
    expect(
      readDingTalkBinding([
        {
          binding: { linked: true, platformUsername: '张三' },
          capabilities: { push: true },
          id: 'dingtalk',
        },
      ]),
    ).toEqual({ linked: true, platformUsername: '张三' });
  });

  it('reports an account the server says has no DingTalk identity', () => {
    expect(
      readDingTalkBinding([
        { binding: { linked: false }, capabilities: { push: true }, id: 'dingtalk' },
      ]),
    ).toEqual({ linked: false, platformUsername: undefined });
  });

  /** A1 always sends both keys; `platformUsername: null` is the unlinked wire and a linked account with no display name. */
  it('treats an explicit null username as no name, not as unlinked', () => {
    expect(
      readDingTalkBinding([
        {
          binding: { linked: true, platformUsername: null },
          capabilities: { push: true },
          id: 'dingtalk',
        },
      ]),
    ).toEqual({ linked: true, platformUsername: undefined });
    expect(
      readDingTalkBinding([
        {
          binding: { linked: false, platformUsername: null },
          capabilities: { push: true },
          id: 'dingtalk',
        },
      ]),
    ).toEqual({ linked: false, platformUsername: undefined });
  });

  /**
   * `binding` is additive: an older server omits it, and that unknown must stay unknown
   * rather than collapsing into "not linked", which would block every user.
   */
  it('leaves `linked` unknown when the payload predates `binding`', () => {
    expect(readDingTalkBinding([{ capabilities: { push: true }, id: 'dingtalk' }])).toEqual({});
    expect(
      readDingTalkBinding([{ binding: null, capabilities: { push: true }, id: 'dingtalk' }]),
    ).toEqual({});
    expect(readDingTalkBinding(undefined)).toEqual({});
  });

  it('ignores an empty username so the UI does not name a blank account', () => {
    expect(
      readDingTalkBinding([
        {
          binding: { linked: true, platformUsername: '' },
          capabilities: { push: true },
          id: 'dingtalk',
        },
      ]),
    ).toEqual({ linked: true, platformUsername: undefined });
  });

  it('does not read the binding of a different platform', () => {
    expect(
      readDingTalkBinding([
        { binding: { linked: true, platformUsername: 'slack-user' }, id: 'slack' },
      ]),
    ).toEqual({});
  });
});

describe('useDingTalkPushAvailable', () => {
  beforeEach(() => {
    swrState.data = undefined;
    swrState.error = undefined;
    swrState.isLoading = false;
    swrState.mutate.mockReset();
  });

  const dingtalk = (extra: Record<string, unknown> = {}) => [
    { capabilities: { chat: true, push: true }, id: 'dingtalk', ...extra },
  ];

  it('names the bound account once push is deliverable', () => {
    swrState.data = dingtalk({ binding: { linked: true, platformUsername: 'ZHANG SAN' } });

    const { result } = renderHook(() => useDingTalkPushAvailable());

    expect(result.current.status).toBe('available');
    expect(result.current.available).toBe(true);
    expect(result.current.platformUsername).toBe('ZHANG SAN');
  });

  /** The connector is healthy, but every push for this user is dropped as `user_not_mapped`. */
  it('blocks a user the connector cannot deliver to', () => {
    swrState.data = dingtalk({ binding: { linked: false } });

    const { result } = renderHook(() => useDingTalkPushAvailable());

    expect(result.current.status).toBe('unlinked');
    expect(result.current.available).toBe(false);
    expect(result.current.platformUsername).toBeUndefined();
  });

  it('stays available when the payload carries no binding at all', () => {
    swrState.data = dingtalk();

    const { result } = renderHook(() => useDingTalkPushAvailable());

    expect(result.current.status).toBe('available');
    expect(result.current.available).toBe(true);
    expect(result.current.platformUsername).toBeUndefined();
  });

  /**
   * A1 always sends both keys. `{ linked: true, platformUsername: null }` is a
   * linked account with no display name (legacy A1 email path, or a link row
   * with neither username nor userId). Must stay `available` and must not
   * surface a blank `dingtalkLinkedAs`.
   */
  it('stays available on the A1 linked wire with a null username and does not name a blank account', () => {
    swrState.data = dingtalk({ binding: { linked: true, platformUsername: null } });

    const { result } = renderHook(() => useDingTalkPushAvailable());

    expect(result.current.status).toBe('available');
    expect(result.current.available).toBe(true);
    expect(result.current.platformUsername).toBeUndefined();
  });

  it('blocks on the A1 unlinked wire `{ linked: false, platformUsername: null }`', () => {
    swrState.data = dingtalk({ binding: { linked: false, platformUsername: null } });

    const { result } = renderHook(() => useDingTalkPushAvailable());

    expect(result.current.status).toBe('unlinked');
    expect(result.current.available).toBe(false);
    expect(result.current.platformUsername).toBeUndefined();
  });

  it('reports the missing connector before the missing mapping', () => {
    swrState.data = [{ binding: { linked: false }, capabilities: { push: false }, id: 'dingtalk' }];

    expect(renderHook(() => useDingTalkPushAvailable()).result.current.status).toBe('unavailable');
  });

  /** In-flight and failed lookups are not diagnoses; they must not read as `unlinked`. */
  it('prefers loading and error over either diagnosis', () => {
    swrState.isLoading = true;
    swrState.data = dingtalk({ binding: { linked: false } });
    expect(renderHook(() => useDingTalkPushAvailable()).result.current.status).toBe('loading');

    swrState.isLoading = false;
    swrState.error = new Error('offline');
    expect(renderHook(() => useDingTalkPushAvailable()).result.current.status).toBe('error');
  });

  it('retries through the SWR mutate', () => {
    const { result } = renderHook(() => useDingTalkPushAvailable());

    result.current.retry();

    expect(swrState.mutate).toHaveBeenCalledTimes(1);
  });
});
