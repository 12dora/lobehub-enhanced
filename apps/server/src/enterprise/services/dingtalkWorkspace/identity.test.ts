// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindById = vi.hoisted(() => vi.fn());
const mockFindByPlatform = vi.hoisted(() => vi.fn());
const mockGetUsers = vi.hoisted(() => vi.fn());
const mockSelect = vi.hoisted(() => vi.fn());
const mockRequest = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/user', () => ({
  UserModel: { findById: mockFindById },
}));

vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkModel: class {
    findByPlatform = mockFindByPlatform;
  },
}));

vi.mock('@/database/models/dingtalkDirectory', () => ({
  DingTalkDirectoryModel: class {
    getUsers = mockGetUsers;
  },
}));

vi.mock('./client', () => ({
  dingtalkWorkspaceRequest: (...args: unknown[]) => mockRequest(...args),
}));

vi.mock('@/server/services/messenger/platforms/dingtalk/resolveStaffId', () => ({
  staffIdFromDingTalkIdentityEmail: (email: string | null) => {
    if (!email) return null;
    const at = email.indexOf('@');
    if (at <= 0) return null;
    if (!email.slice(at + 1).includes('dingtalk')) return null;
    return email.slice(0, at);
  },
}));

const {
  requireVerifiedDingtalkIdentity,
  resolveVerifiedDingtalkIdentity,
  isDingtalkApprovalAdmin,
  resetDingtalkIdentityCacheForTest,
} = await import('./identity');
const { DingtalkWorkspaceError } = await import('./errors');

const directoryUser = {
  active: true,
  deptPath: '捷发 / 研发',
  name: 'Ada',
  staffId: 'staff-1',
  unionId: 'union-1',
};

const createDb = () => {
  const emptyRows = (): Promise<unknown[]> => Promise.resolve([]);
  const chain = {
    from: () => chain,
    limit: emptyRows,
    where: () => Object.assign(emptyRows(), { limit: emptyRows }),
  };
  mockSelect.mockImplementation(() => chain);
  return {
    select: mockSelect,
  } as never;
};

describe('resolveVerifiedDingtalkIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDingtalkIdentityCacheForTest();
    mockFindByPlatform.mockResolvedValue(undefined);
    mockGetUsers.mockResolvedValue([]);
    mockRequest.mockReset();
  });

  it('returns UNBOUND when the user has no DingTalk identity', async () => {
    mockFindById.mockResolvedValue({
      id: 'user-1',
      email: 'ada@example.test',
      dingtalkUserId: null,
    });
    const result = await resolveVerifiedDingtalkIdentity(createDb(), 'user-1');
    expect(result).toEqual({ error: 'DINGTALK_IDENTITY_UNBOUND' });
  });

  it('treats a manual bind or identity-email as UNVERIFIED', async () => {
    mockFindById.mockResolvedValue({
      dingtalkUserId: null,
      email: 'staff-9@dingtalk.example.test',
      id: 'user-1',
    });
    mockFindByPlatform.mockResolvedValue({
      platformUserId: 'staff-9',
      source: 'manual',
    });
    const result = await resolveVerifiedDingtalkIdentity(createDb(), 'user-1');
    expect(result).toEqual({ error: 'DINGTALK_IDENTITY_UNVERIFIED' });
  });

  it('trusts users.dingtalk_user_id when the directory row is active', async () => {
    mockFindById.mockResolvedValue({
      dingtalkUserId: 'staff-1',
      email: 'ada@example.test',
      id: 'user-1',
    });
    mockGetUsers.mockResolvedValue([directoryUser]);
    const result = await resolveVerifiedDingtalkIdentity(createDb(), 'user-1');
    expect(result).toEqual({ name: 'Ada', staffId: 'staff-1', unionId: 'union-1' });
  });

  it('trusts a robot auto-link (source !== manual)', async () => {
    mockFindById.mockResolvedValue({
      dingtalkUserId: null,
      email: 'ada@example.test',
      id: 'user-1',
    });
    mockFindByPlatform.mockResolvedValue({
      platformUserId: 'staff-1',
      source: 'auto',
    });
    mockGetUsers.mockResolvedValue([directoryUser]);
    const result = await resolveVerifiedDingtalkIdentity(createDb(), 'user-1');
    expect(result).toEqual({ name: 'Ada', staffId: 'staff-1', unionId: 'union-1' });
  });

  it('returns UNVERIFIED when trusted sources disagree', async () => {
    mockFindById.mockResolvedValue({
      dingtalkUserId: 'staff-1',
      email: 'ada@example.test',
      id: 'user-1',
    });
    mockFindByPlatform.mockResolvedValue({
      platformUserId: 'staff-2',
      source: 'auto',
    });
    mockGetUsers.mockImplementation(async (ids: string[]) => {
      if (ids[0] === 'staff-1') return [{ ...directoryUser }];
      return [{ ...directoryUser, staffId: 'staff-2', unionId: 'union-2' }];
    });
    const result = await resolveVerifiedDingtalkIdentity(createDb(), 'user-1');
    expect(result).toEqual({ error: 'DINGTALK_IDENTITY_UNVERIFIED' });
  });

  it('returns INACTIVE when the directory row is not active', async () => {
    mockFindById.mockResolvedValue({
      dingtalkUserId: 'staff-1',
      email: 'ada@example.test',
      id: 'user-1',
    });
    mockGetUsers.mockResolvedValue([{ ...directoryUser, active: false }]);
    const result = await resolveVerifiedDingtalkIdentity(createDb(), 'user-1');
    expect(result).toEqual({ error: 'DINGTALK_IDENTITY_INACTIVE' });
  });

  it('requireVerifiedDingtalkIdentity throws the matching workspace error', async () => {
    mockFindById.mockResolvedValue({ dingtalkUserId: null, email: null, id: 'user-1' });
    await expect(requireVerifiedDingtalkIdentity(createDb(), 'user-1')).rejects.toBeInstanceOf(
      DingtalkWorkspaceError,
    );
  });
});

describe('isDingtalkApprovalAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDingtalkIdentityCacheForTest();
  });

  it('is true only when the managements templates call succeeds', async () => {
    mockRequest.mockResolvedValueOnce({ result: [] });
    await expect(isDingtalkApprovalAdmin('staff-1')).resolves.toBe(true);
    mockRequest.mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_FORBIDDEN'));
    resetDingtalkIdentityCacheForTest();
    await expect(isDingtalkApprovalAdmin('staff-2')).resolves.toBe(false);
  });

  it('caches success and FORBIDDEN but not UNAVAILABLE', async () => {
    mockRequest.mockResolvedValueOnce({ result: [] });
    await expect(isDingtalkApprovalAdmin('staff-1')).resolves.toBe(true);
    await expect(isDingtalkApprovalAdmin('staff-1')).resolves.toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(1);

    resetDingtalkIdentityCacheForTest();
    mockRequest.mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_FORBIDDEN'));
    await expect(isDingtalkApprovalAdmin('staff-2')).resolves.toBe(false);
    await expect(isDingtalkApprovalAdmin('staff-2')).resolves.toBe(false);
    expect(mockRequest).toHaveBeenCalledTimes(2);

    resetDingtalkIdentityCacheForTest();
    mockRequest.mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_UNAVAILABLE'));
    mockRequest.mockResolvedValueOnce({ result: [] });
    await expect(isDingtalkApprovalAdmin('staff-3')).resolves.toBe(false);
    await expect(isDingtalkApprovalAdmin('staff-3')).resolves.toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(4);

    resetDingtalkIdentityCacheForTest();
    mockRequest.mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_RATE_LIMITED'));
    mockRequest.mockResolvedValueOnce({ result: [] });
    await expect(isDingtalkApprovalAdmin('staff-4')).resolves.toBe(false);
    await expect(isDingtalkApprovalAdmin('staff-4')).resolves.toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(6);
  });
});
