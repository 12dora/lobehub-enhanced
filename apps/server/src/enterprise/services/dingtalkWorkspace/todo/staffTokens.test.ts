import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/enterprise/services/dingtalkWorkspace/directory', () => ({
  resolveStaff: vi.fn(),
}));

const { lookupStaffByUnionIds, toStaffToken } = await import('./staffTokens');

describe('staffTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefixes staff ids', () => {
    expect(toStaffToken('173abc')).toBe('staff:173abc');
    expect(toStaffToken('staff:173abc')).toBe('staff:173abc');
  });

  it('looks up directory rows by unionId', async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi
            .fn()
            .mockResolvedValue([
              { deptPath: '财务', name: '李四', staffId: 'li', unionId: 'union-li' },
            ]),
        })),
      })),
    };
    const map = await lookupStaffByUnionIds(db as never, ['union-li', 'union-li']);
    expect(map.get('union-li')).toEqual({
      deptPath: '财务',
      name: '李四',
      staffId: 'li',
      unionId: 'union-li',
    });
  });

  it('returns an empty map when db cannot query', async () => {
    const map = await lookupStaffByUnionIds({} as never, ['union-li']);
    expect(map.size).toBe(0);
  });

  it('propagates directory lookup failures instead of returning an empty map', async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockRejectedValue(new Error('relation does not exist')),
        })),
      })),
    };
    const { DingtalkWorkspaceError } = await import('../errors');
    await expect(lookupStaffByUnionIds(db as never, ['union-li'])).rejects.toMatchObject({
      code: 'DINGTALK_UNAVAILABLE',
    });
    await expect(lookupStaffByUnionIds(db as never, ['union-li'])).rejects.toBeInstanceOf(
      DingtalkWorkspaceError,
    );
  });
});
