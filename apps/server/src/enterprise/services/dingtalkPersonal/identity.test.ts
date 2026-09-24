// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireIdentity = vi.hoisted(() => vi.fn());
const getSso = vi.hoisted(() => vi.fn());

vi.mock('@/server/enterprise/services/dingtalkWorkspace/identity', () => ({
  requireVerifiedDingtalkIdentity: (...args: unknown[]) => requireIdentity(...args),
}));

vi.mock('@/server/services/messenger/platforms/dingtalk/sso', () => ({
  getDingTalkSsoConfig: (...args: unknown[]) => getSso(...args),
}));

const { DingtalkWorkspaceError } =
  await import('@/server/enterprise/services/dingtalkWorkspace/errors');
const { requireDingtalkPersonalSubject, resolveDingtalkPersonalSubject } =
  await import('./identity');
const { DingtalkPersonalError } = await import('./errors');

const db = {} as never;

describe('dingtalk personal identity', () => {
  beforeEach(() => {
    requireIdentity.mockReset();
    getSso.mockReset();
    requireIdentity.mockResolvedValue({ name: '甲', staffId: 'staff1', unionId: 'union-1' });
    getSso.mockResolvedValue({ corpId: 'dingcorp', enabled: true });
  });

  it('builds the broker profile from the verified staff id and connector corp id', async () => {
    await expect(resolveDingtalkPersonalSubject(db, 'user-a')).resolves.toEqual({
      corpId: 'dingcorp',
      ok: true,
      profile: 'dingcorp:staff1',
      staffId: 'staff1',
      userName: '甲',
    });
    expect(requireIdentity).toHaveBeenCalledWith(db, 'user-a');
  });

  it('maps missing corp id, including a disabled SSO config', async () => {
    getSso.mockResolvedValueOnce({ corpId: null, enabled: true });
    await expect(resolveDingtalkPersonalSubject(db, 'user-a')).resolves.toEqual({
      code: 'DINGTALK_PERSONAL_CORP_ID_MISSING',
      ok: false,
    });

    getSso.mockResolvedValueOnce({ corpId: '   ', enabled: true });
    await expect(resolveDingtalkPersonalSubject(db, 'user-a')).resolves.toEqual({
      code: 'DINGTALK_PERSONAL_CORP_ID_MISSING',
      ok: false,
    });

    getSso.mockResolvedValueOnce({ enabled: false });
    await expect(resolveDingtalkPersonalSubject(db, 'user-a')).resolves.toEqual({
      code: 'DINGTALK_PERSONAL_CORP_ID_MISSING',
      ok: false,
    });
  });

  it.each([
    'DINGTALK_IDENTITY_UNBOUND',
    'DINGTALK_IDENTITY_UNVERIFIED',
    'DINGTALK_IDENTITY_INACTIVE',
  ])('maps %s from the workspace identity check', async (code) => {
    requireIdentity.mockRejectedValue(
      new DingtalkWorkspaceError(code as 'DINGTALK_IDENTITY_UNBOUND'),
    );
    await expect(resolveDingtalkPersonalSubject(db, 'user-a')).resolves.toEqual({
      code,
      ok: false,
    });
    await expect(requireDingtalkPersonalSubject(db, 'user-a')).rejects.toBeInstanceOf(
      DingtalkPersonalError,
    );
    await expect(requireDingtalkPersonalSubject(db, 'user-a')).rejects.toMatchObject({ code });
  });

  it('fails closed when identity or corp lookup throws', async () => {
    requireIdentity.mockRejectedValueOnce(new Error('directory down'));
    await expect(resolveDingtalkPersonalSubject(db, 'user-a')).resolves.toEqual({
      code: 'DINGTALK_PERSONAL_INTERNAL',
      ok: false,
    });

    getSso.mockRejectedValueOnce(new Error('sso down'));
    await expect(resolveDingtalkPersonalSubject(db, 'user-a')).resolves.toEqual({
      code: 'DINGTALK_PERSONAL_INTERNAL',
      ok: false,
    });
  });
});
