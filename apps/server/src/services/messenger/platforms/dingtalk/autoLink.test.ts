// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnsureDingTalkUser = vi.fn();
const mockGetBuiltinAgent = vi.fn();
const mockUpsertForPlatform = vi.fn();
const sendDmText = vi.fn();

vi.mock('./provision', () => ({
  ensureDingTalkUser: (...args: unknown[]) => mockEnsureDingTalkUser(...args),
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

const { tryAutoLinkDingTalk } = await import('./autoLink');
const { DINGTALK_UNKNOWN_USER_REPLY } = await import('./const');

const serverDB = {} as any;
const binder = { sendDmText } as any;

beforeEach(() => {
  mockEnsureDingTalkUser.mockResolvedValue({
    email: 'staff_1@dingtalk.jiefakj.com',
    id: 'user_1',
  });
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
});

describe('tryAutoLinkDingTalk', () => {
  it('upserts a link when the user already exists (no provision create)', async () => {
    const link = await tryAutoLinkDingTalk({
      binder,
      chatId: 'cid_1',
      senderNick: 'Alice',
      senderStaffId: 'staff_1',
      serverDB,
    });

    expect(link?.platformUserId).toBe('staff_1');
    expect(mockEnsureDingTalkUser).toHaveBeenCalledWith(serverDB, {
      senderNick: 'Alice',
      staffId: 'staff_1',
    });
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

  it('creates the messenger link after JIT provision succeeds', async () => {
    mockEnsureDingTalkUser.mockResolvedValueOnce({
      email: 'unknown_staff@dingtalk.jiefakj.com',
      id: 'user_new',
    });

    const link = await tryAutoLinkDingTalk({
      binder,
      chatId: 'cid_1',
      senderNick: 'Alice',
      senderStaffId: 'unknown_staff',
      serverDB,
    });

    expect(link?.userId ?? link).toBeTruthy();
    expect(mockUpsertForPlatform).toHaveBeenCalled();
    expect(sendDmText).not.toHaveBeenCalled();
  });

  it('replies the fixed sentence when provisioning fails', async () => {
    mockEnsureDingTalkUser.mockResolvedValueOnce(null);

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

  it('treats an empty staffId as unknown and still sends the login sentence', async () => {
    const link = await tryAutoLinkDingTalk({
      binder,
      chatId: 'cid_1',
      senderStaffId: '   ',
      serverDB,
    });

    expect(link).toBeNull();
    expect(sendDmText).toHaveBeenCalledWith('cid_1', DINGTALK_UNKNOWN_USER_REPLY);
    expect(mockEnsureDingTalkUser).not.toHaveBeenCalled();
    expect(mockUpsertForPlatform).not.toHaveBeenCalled();
  });

  it('logs send failures of the unknown-user reply at error level', async () => {
    mockEnsureDingTalkUser.mockResolvedValueOnce(null);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sendDmText.mockRejectedValueOnce(new Error('webhook expired'));

    const link = await tryAutoLinkDingTalk({
      binder,
      chatId: 'cid_1',
      senderStaffId: 'unknown_staff',
      serverDB,
    });

    expect(link).toBeNull();
    expect(error).toHaveBeenCalledWith(
      'tryAutoLinkDingTalk: failed to send unknown-user reply',
      expect.any(Error),
    );
    error.mockRestore();
  });
});
