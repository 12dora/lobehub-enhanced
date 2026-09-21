// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

class DingtalkWorkspaceError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'DingtalkWorkspaceError';
    this.code = code;
  }
}

const getUsers = vi.fn();
const getDepartment = vi.fn();
const search = vi.fn();
const resolveStaff = vi.fn();

vi.mock('../errors', () => ({ DingtalkWorkspaceError }));
vi.mock('../directory', () => ({
  resolveStaff: (...args: unknown[]) => resolveStaff(...args),
}));
vi.mock('@/database/models/dingtalkDirectory', () => ({
  DingTalkDirectoryModel: class {
    getDepartment = getDepartment;
    getUsers = getUsers;
    search = search;
  },
}));

const { isSelfOriginatorAlias, stripDingtalkIdPrefix } = await import('./ids');
const {
  normalizeApprovalRuleConditions,
  normalizeStoredRuleConditions,
  rewriteStoredRuleConditions,
} = await import('./conditions');

describe('stripDingtalkIdPrefix / isSelfOriginatorAlias', () => {
  it('strips staff: and dept: prefixes case-insensitively', () => {
    expect(stripDingtalkIdPrefix('staff:276329315736818882', 'staff:')).toBe('276329315736818882');
    expect(stripDingtalkIdPrefix('STAFF:abc', 'staff:')).toBe('abc');
    expect(stripDingtalkIdPrefix('dept:100', 'dept:')).toBe('100');
    expect(stripDingtalkIdPrefix('276329315736818882', 'staff:')).toBe('276329315736818882');
    expect(stripDingtalkIdPrefix('  staff: 1 ', 'staff:')).toBe('1');
  });

  it('treats me / 我 / 本人 as the caller', () => {
    expect(isSelfOriginatorAlias('me')).toBe(true);
    expect(isSelfOriginatorAlias('ME')).toBe(true);
    expect(isSelfOriginatorAlias('我')).toBe(true);
    expect(isSelfOriginatorAlias('本人')).toBe(true);
    expect(isSelfOriginatorAlias('胡玉琴A')).toBe(false);
  });
});

describe('rewriteStoredRuleConditions', () => {
  it('strips stored staff:/dept: tokens and de-duplicates', () => {
    expect(
      rewriteStoredRuleConditions({
        fields: [],
        match: 'all',
        originators: {
          deptIds: ['dept:1', '1', 'dept:1'],
          staffIds: ['staff:276329315736818882', '276329315736818882'],
        },
      }),
    ).toEqual({
      fields: [],
      match: 'all',
      originators: {
        deptIds: ['1'],
        staffIds: ['276329315736818882'],
      },
    });
  });

  it('is idempotent on already-canonical ids', () => {
    const conditions = {
      match: 'all' as const,
      originators: { staffIds: ['276329315736818882'] },
    };
    expect(rewriteStoredRuleConditions(conditions)).toEqual(conditions);
  });
});

describe('normalizeApprovalRuleConditions', () => {
  const db = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
    getUsers.mockResolvedValue([]);
    getDepartment.mockResolvedValue(undefined);
    search.mockResolvedValue({ departments: [], users: [] });
    resolveStaff.mockResolvedValue({ notFound: true, suggestions: [] });
  });

  it('strips staff: tokens and keeps the raw directory id', async () => {
    getUsers.mockResolvedValueOnce([{ name: '胡玉琴A', staffId: '276329315736818882' }]);
    await expect(
      normalizeApprovalRuleConditions(
        db,
        {
          match: 'all',
          originators: { staffIds: ['staff:276329315736818882'] },
        },
        '276329315736818882',
      ),
    ).resolves.toEqual({
      match: 'all',
      originators: { staffIds: ['276329315736818882'] },
    });
    expect(resolveStaff).not.toHaveBeenCalled();
  });

  it('accepts 我 / me / 本人 as the caller staffId and de-duplicates', async () => {
    await expect(
      normalizeApprovalRuleConditions(
        db,
        { match: 'all', originators: { staffIds: ['我', 'me', '本人'] } },
        'staff_me',
      ),
    ).resolves.toEqual({
      match: 'all',
      originators: { staffIds: ['staff_me'] },
    });
  });

  it('resolves a plain name and throws DINGTALK_AMBIGUOUS with candidates', async () => {
    resolveStaff.mockResolvedValueOnce({
      ambiguous: [
        { deptPath: '安环部', name: '胡玉琴A', staffId: 's1' },
        { deptPath: '财务部', name: '胡玉琴A', staffId: 's2' },
      ],
    });
    await expect(
      normalizeApprovalRuleConditions(
        db,
        { match: 'all', originators: { staffIds: ['胡玉琴A'] } },
        'staff_me',
      ),
    ).rejects.toMatchObject({
      candidates: [
        { deptPath: '安环部', name: '胡玉琴A', staffId: 's1' },
        { deptPath: '财务部', name: '胡玉琴A', staffId: 's2' },
      ],
      code: 'DINGTALK_AMBIGUOUS',
    });
  });

  it('rejects an unknown staff token', async () => {
    await expect(
      normalizeApprovalRuleConditions(
        db,
        { match: 'all', originators: { staffIds: ['staff:missing'] } },
        'staff_me',
      ),
    ).rejects.toMatchObject({ code: 'DINGTALK_NOT_FOUND' });
  });

  it('strips dept: and resolves a unique department name', async () => {
    getDepartment.mockResolvedValueOnce({ deptId: '100', name: '安环部' });
    await expect(
      normalizeApprovalRuleConditions(
        db,
        { match: 'all', originators: { deptIds: ['dept:100'] } },
        'staff_me',
      ),
    ).resolves.toEqual({
      match: 'all',
      originators: { deptIds: ['100'] },
    });

    getDepartment.mockResolvedValueOnce(undefined);
    search.mockResolvedValueOnce({
      departments: [{ deptId: '200', name: '研发部', pathNames: '捷发 / 研发部' }],
      users: [],
    });
    await expect(
      normalizeApprovalRuleConditions(
        db,
        { match: 'all', originators: { deptIds: ['研发部'] } },
        'staff_me',
      ),
    ).resolves.toEqual({
      match: 'all',
      originators: { deptIds: ['200'] },
    });
  });
});

describe('normalizeStoredRuleConditions', () => {
  it('rewrites only rows whose originator tokens still have prefixes', async () => {
    const updateWhere = vi.fn(async () => []);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const rows = [
      {
        conditions: {
          match: 'all',
          originators: { staffIds: ['staff:276329315736818882'] },
        },
        id: 'rule_token',
      },
      {
        conditions: { match: 'all', originators: { staffIds: ['276329315736818882'] } },
        id: 'rule_raw',
      },
    ];
    const db = {
      select: () => ({
        from: async () => rows,
      }),
      update: () => ({ set: updateSet }),
    };

    await expect(normalizeStoredRuleConditions(db as never)).resolves.toEqual({
      scanned: 2,
      updated: 1,
    });
    expect(updateSet).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith({
      conditions: {
        match: 'all',
        originators: { staffIds: ['276329315736818882'] },
      },
    });
  });
});
