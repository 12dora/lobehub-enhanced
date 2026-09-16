// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindByPlatform = vi.fn();
const mockFindById = vi.fn();

vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkModel: vi.fn().mockImplementation(() => ({
    findByPlatform: mockFindByPlatform,
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: { findById: (...args: unknown[]) => mockFindById(...args) },
}));

const { resolveDingTalkStaffId, staffIdFromDingTalkIdentityEmail } = await import('./resolveStaffId');

beforeEach(() => {
  mockFindByPlatform.mockResolvedValue(undefined);
  mockFindById.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('staffIdFromDingTalkIdentityEmail', () => {
  it('returns the local-part when the domain matches the identity convention', () => {
    expect(staffIdFromDingTalkIdentityEmail('staff_9@dingtalk.jiefakj.com')).toBe('staff_9');
  });

  it('matches the domain case-insensitively', () => {
    expect(staffIdFromDingTalkIdentityEmail('staff_9@DingTalk.JieFaKj.com')).toBe('staff_9');
  });

  it('returns null for a break-glass mailbox that is not the identity domain', () => {
    expect(staffIdFromDingTalkIdentityEmail('admin@jiefakj.com')).toBeNull();
  });

  it('returns null for empty or malformed mailboxes', () => {
    expect(staffIdFromDingTalkIdentityEmail(null)).toBeNull();
    expect(staffIdFromDingTalkIdentityEmail(undefined)).toBeNull();
    expect(staffIdFromDingTalkIdentityEmail('')).toBeNull();
    expect(staffIdFromDingTalkIdentityEmail('@dingtalk.jiefakj.com')).toBeNull();
  });

  it('honours DINGTALK_IDENTITY_EMAIL_DOMAIN', () => {
    vi.stubEnv('DINGTALK_IDENTITY_EMAIL_DOMAIN', 'im.example.com');
    expect(staffIdFromDingTalkIdentityEmail('alice@im.example.com')).toBe('alice');
    expect(staffIdFromDingTalkIdentityEmail('staff_9@dingtalk.jiefakj.com')).toBeNull();
  });
});

describe('resolveDingTalkStaffId', () => {
  it('prefers the messenger_account_links platformUserId', async () => {
    mockFindByPlatform.mockResolvedValueOnce({ platformUserId: 'staff_1' });
    await expect(resolveDingTalkStaffId({} as any, 'user_1')).resolves.toBe('staff_1');
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it('falls back to the identity-email local-part when no link exists', async () => {
    mockFindById.mockResolvedValueOnce({ email: 'staff_9@dingtalk.jiefakj.com' });
    await expect(resolveDingTalkStaffId({} as any, 'user_1')).resolves.toBe('staff_9');
  });

  it('returns null when neither a link nor the identity email is present', async () => {
    mockFindById.mockResolvedValueOnce({ email: 'admin@jiefakj.com' });
    await expect(resolveDingTalkStaffId({} as any, 'user_1')).resolves.toBeNull();
  });
});
