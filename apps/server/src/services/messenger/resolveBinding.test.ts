// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockList = vi.fn();
const mockFindById = vi.fn();

vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkModel: vi.fn().mockImplementation(() => ({
    list: mockList,
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: { findById: (...args: unknown[]) => mockFindById(...args) },
}));

const { resolveMessengerPlatformBindings } = await import('./resolveBinding');

beforeEach(() => {
  mockList.mockResolvedValue([]);
  mockFindById.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('resolveMessengerPlatformBindings', () => {
  it('returns unlinked bindings when there is no calling user', async () => {
    await expect(
      resolveMessengerPlatformBindings({} as any, null, ['dingtalk', 'slack']),
    ).resolves.toEqual({
      dingtalk: { linked: false, platformUsername: null },
      slack: { linked: false, platformUsername: null },
    });
    expect(mockList).not.toHaveBeenCalled();
  });

  it('marks a platform linked when a messenger_account_links row exists', async () => {
    mockList.mockResolvedValueOnce([
      { platform: 'dingtalk', platformUsername: 'Alice' },
      { platform: 'slack', platformUsername: null },
    ]);

    await expect(
      resolveMessengerPlatformBindings({} as any, 'user_1', ['dingtalk', 'slack']),
    ).resolves.toEqual({
      dingtalk: { linked: true, platformUsername: 'Alice' },
      slack: { linked: true, platformUsername: null },
    });
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it('treats a DingTalk identity-email user as linked without a link row', async () => {
    mockFindById.mockResolvedValueOnce({ email: 'staff_9@dingtalk.jiefakj.com' });

    await expect(
      resolveMessengerPlatformBindings({} as any, 'user_1', ['dingtalk']),
    ).resolves.toEqual({
      dingtalk: { linked: true, platformUsername: null },
    });
  });

  it('does not treat a break-glass admin mailbox as a DingTalk identity', async () => {
    mockFindById.mockResolvedValueOnce({ email: 'admin@jiefakj.com' });

    await expect(
      resolveMessengerPlatformBindings({} as any, 'user_1', ['dingtalk']),
    ).resolves.toEqual({
      dingtalk: { linked: false, platformUsername: null },
    });
  });

  it('does not apply the DingTalk email convention to other platforms', async () => {
    mockFindById.mockResolvedValueOnce({ email: 'staff_9@dingtalk.jiefakj.com' });

    await expect(resolveMessengerPlatformBindings({} as any, 'user_1', ['slack'])).resolves.toEqual(
      {
        slack: { linked: false, platformUsername: null },
      },
    );
  });
});
