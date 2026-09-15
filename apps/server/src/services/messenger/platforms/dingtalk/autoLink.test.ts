// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindByEmail = vi.fn();
const mockFindFirst = vi.fn();
const mockGetBuiltinAgent = vi.fn();
const mockUpsertForPlatform = vi.fn();
const sendDmText = vi.fn();

vi.mock('@/database/models/user', () => ({
  UserModel: { findByEmail: (...args: unknown[]) => mockFindByEmail(...args) },
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    getBuiltinAgent: mockGetBuiltinAgent,
  })),
}));

vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkModel: vi.fn().mockImplementation(() => ({
    upsertForPlatform: mockUpsertForPlatform,
  })),
}));

vi.mock('@/database/schemas', () => ({
  users: { email: 'users.email' },
}));

const { tryAutoLinkDingTalk } = await import('./autoLink');
const { DINGTALK_UNKNOWN_USER_REPLY } = await import('./const');

const serverDB = { query: { users: { findFirst: mockFindFirst } } } as any;
const binder = { sendDmText } as any;

beforeEach(() => {
  mockFindByEmail.mockResolvedValue(undefined);
  mockFindFirst.mockResolvedValue(undefined);
  mockGetBuiltinAgent.mockResolvedValue({ id: 'agt_inbox' });
  mockUpsertForPlatform.mockResolvedValue({
    activeAgentId: 'agt_inbox',
    platform: 'dingtalk',
    platformUserId: 'staff_1',
    userId: 'user_1',
  });
  sendDmText.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.DINGTALK_IDENTITY_EMAIL_DOMAIN;
});

describe('tryAutoLinkDingTalk', () => {
  it('upserts a link when the identity email matches', async () => {
    mockFindByEmail.mockResolvedValueOnce({ id: 'user_1', email: 'staff_1@dingtalk.jiefakj.com' });

    const link = await tryAutoLinkDingTalk({
      binder,
      chatId: 'cid_1',
      senderNick: 'Alice',
      senderStaffId: 'staff_1',
      serverDB,
    });

    expect(link?.platformUserId).toBe('staff_1');
    expect(mockUpsertForPlatform).toHaveBeenCalledWith(
      expect.objectContaining({
        activeAgentId: 'agt_inbox',
        platform: 'dingtalk',
        platformUserId: 'staff_1',
        platformUsername: 'Alice',
        tenantId: '',
        workspaceId: null,
      }),
    );
    expect(sendDmText).not.toHaveBeenCalled();
  });

  it('matches the identity email case-insensitively', async () => {
    mockFindByEmail.mockResolvedValueOnce(undefined);
    mockFindFirst.mockResolvedValueOnce({ id: 'user_1', email: 'STAFF_1@DingTalk.Jiefakj.COM' });

    const link = await tryAutoLinkDingTalk({
      binder,
      chatId: 'cid_1',
      senderStaffId: 'staff_1',
      serverDB,
    });

    expect(link?.userId ?? link).toBeTruthy();
    expect(mockFindFirst).toHaveBeenCalled();
    expect(mockUpsertForPlatform).toHaveBeenCalled();
  });

  it('replies the fixed sentence when the staffId is unknown', async () => {
    const link = await tryAutoLinkDingTalk({
      binder,
      chatId: 'cid_1',
      senderStaffId: 'unknown_staff',
      serverDB,
    });

    expect(link).toBeNull();
    expect(sendDmText).toHaveBeenCalledWith('cid_1', DINGTALK_UNKNOWN_USER_REPLY);
    expect(mockUpsertForPlatform).not.toHaveBeenCalled();
  });
});
