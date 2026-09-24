// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cancelLogin: vi.fn(),
  checkStatus: vi.fn(),
  getLoginJob: vi.fn(),
  getStatus: vi.fn(),
  revoke: vi.fn(),
  startLogin: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => ({}),
}));

vi.mock('@/server/enterprise/services/dingtalkPersonal/service', () => ({
  DingtalkPersonalService: class {
    cancelLogin = mocks.cancelLogin;
    checkStatus = mocks.checkStatus;
    getLoginJob = mocks.getLoginJob;
    getStatus = mocks.getStatus;
    revoke = mocks.revoke;
    startLogin = mocks.startLogin;
  },
}));

vi.mock('./dingtalkPersonalTool', () => ({
  dingtalkPersonalToolProcedures: {},
}));

const { dingtalkPersonalRouter } = await import('./dingtalkPersonal');
const { DingtalkPersonalError } =
  await import('@/server/enterprise/services/dingtalkPersonal/errors');

const TOKEN = `router-${'t'.repeat(32)}`;

describe('dingtalkPersonal router errors', () => {
  const caller = dingtalkPersonalRouter.createCaller({ userId: 'user-a' } as never);

  beforeEach(() => {
    mocks.getStatus.mockReset();
    mocks.checkStatus.mockReset();
    mocks.startLogin.mockReset();
    mocks.getLoginJob.mockReset();
    mocks.cancelLogin.mockReset();
    mocks.revoke.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('returns the service status', async () => {
    mocks.getStatus.mockResolvedValue({ state: 'disabled' });
    await expect(caller.getStatus()).resolves.toEqual({ state: 'disabled' });
  });

  it.each([
    ['DINGTALK_PERSONAL_DISABLED', 'FORBIDDEN'],
    ['DINGTALK_PERSONAL_FEATURE_DISABLED', 'FORBIDDEN'],
    ['DINGTALK_IDENTITY_UNBOUND', 'PRECONDITION_FAILED'],
    ['DINGTALK_IDENTITY_UNVERIFIED', 'PRECONDITION_FAILED'],
    ['DINGTALK_IDENTITY_INACTIVE', 'PRECONDITION_FAILED'],
    ['DINGTALK_PERSONAL_CORP_ID_MISSING', 'PRECONDITION_FAILED'],
    ['DINGTALK_PERSONAL_LOGIN_NOT_FOUND', 'NOT_FOUND'],
    ['DINGTALK_PERSONAL_REVOKE_FAILED', 'INTERNAL_SERVER_ERROR'],
    ['DINGTALK_PERSONAL_RATE_LIMITED', 'TOO_MANY_REQUESTS'],
    ['DINGTALK_PERSONAL_BROKER_UNAVAILABLE', 'INTERNAL_SERVER_ERROR'],
    ['DINGTALK_PERSONAL_TIMEOUT', 'INTERNAL_SERVER_ERROR'],
    ['DINGTALK_PERSONAL_UNAUTHORIZED', 'BAD_REQUEST'],
    ['DINGTALK_PERSONAL_INTERNAL', 'INTERNAL_SERVER_ERROR'],
  ] as const)('maps %s to %s', async (code, trpcCode) => {
    mocks.getStatus.mockRejectedValue(new DingtalkPersonalError(code));
    await expect(caller.getStatus()).rejects.toMatchObject({
      cause: { data: { code } },
      code: trpcCode,
      message: code,
    });
  });

  it('keeps feature details on the trpc cause', async () => {
    mocks.getStatus.mockRejectedValue(
      new DingtalkPersonalError('DINGTALK_PERSONAL_FEATURE_DISABLED', { feature: 'todo' }),
    );
    await expect(caller.getStatus()).rejects.toMatchObject({
      cause: { data: { code: 'DINGTALK_PERSONAL_FEATURE_DISABLED', details: { feature: 'todo' } } },
      code: 'FORBIDDEN',
      message: 'DINGTALK_PERSONAL_FEATURE_DISABLED',
    });
  });

  it('does not leak an unexpected error message or a broker token', async () => {
    mocks.getStatus.mockRejectedValue(new Error(`boom ${TOKEN}`));
    try {
      await caller.getStatus();
      throw new Error('expected trpc error');
    } catch (error) {
      const blob = `${error instanceof Error ? error.message : ''} ${JSON.stringify(error)}`;
      expect(blob).not.toContain(TOKEN);
      expect(blob).toContain('DINGTALK_PERSONAL_INTERNAL');
    }
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(TOKEN);
  });
});
