// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockList = vi.fn();
const mockFindByPlatform = vi.fn();
const mockFindById = vi.fn();

vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkModel: vi.fn().mockImplementation(() => ({
    findByPlatform: mockFindByPlatform,
    list: mockList,
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: { findById: (...args: unknown[]) => mockFindById(...args) },
}));

const { resolveMessengerPlatformBindings } = await import('./resolveBinding');

beforeEach(() => {
  mockList.mockReset();
  mockFindByPlatform.mockReset();
  mockFindById.mockReset();
  mockList.mockResolvedValue([]);
  mockFindByPlatform.mockResolvedValue(undefined);
  mockFindById.mockResolvedValue(undefined);
  vi.stubEnv('DINGTALK_IDENTITY_EMAIL_DOMAIN', 'dingtalk.jiefakj.com');
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
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
    mockFindByPlatform.mockResolvedValueOnce({ platformUserId: 'staff_1' });
    mockList.mockResolvedValueOnce([
      { platform: 'dingtalk', platformUserId: 'staff_1', platformUsername: 'Alice' },
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

  it('falls back to platformUserId when the link has no username', async () => {
    mockList.mockResolvedValueOnce([
      { platform: 'slack', platformUserId: 'U123', platformUsername: null },
    ]);

    await expect(resolveMessengerPlatformBindings({} as any, 'user_1', ['slack'])).resolves.toEqual(
      {
        slack: { linked: true, platformUsername: 'U123' },
      },
    );
  });

  it('treats a DingTalk identity-email user as linked without a link row', async () => {
    mockFindById.mockResolvedValueOnce({ email: 'staff_9@dingtalk.jiefakj.com' });

    await expect(
      resolveMessengerPlatformBindings({} as any, 'user_1', ['dingtalk']),
    ).resolves.toEqual({
      dingtalk: { linked: true, platformUsername: 'staff_9' },
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

  /**
   * Push resolves via `findByPlatform('dingtalk', '')`, not `list()`. A row
   * stored under another tenant must not advertise `linked: true` while
   * delivery still returns `user_not_mapped`.
   */
  it('does not mark DingTalk linked from a list() row that push would not resolve', async () => {
    mockList.mockResolvedValueOnce([
      {
        platform: 'dingtalk',
        platformUserId: 'staff_other_tenant',
        platformUsername: 'Other',
        tenantId: 'corp_x',
      },
    ]);
    mockFindById.mockResolvedValueOnce({ email: 'admin@jiefakj.com' });

    await expect(
      resolveMessengerPlatformBindings({} as any, 'user_1', ['dingtalk']),
    ).resolves.toEqual({
      dingtalk: { linked: false, platformUsername: null },
    });
  });
});
