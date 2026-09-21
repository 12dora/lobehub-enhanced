// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSearch = vi.hoisted(() => vi.fn());
const mockGetUsers = vi.hoisted(() => vi.fn());
const mockNear = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/dingtalkDirectory', () => ({
  DingTalkDirectoryModel: class {
    getUsers = mockGetUsers;
    listActiveUsersNearName = mockNear;
    search = mockSearch;
  },
}));

const { resolveStaff } = await import('./directory');

const ada = {
  active: true,
  deptPath: '研发',
  name: 'Ada',
  staffId: 'staff-1',
  unionId: 'union-1',
};

describe('resolveStaff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.mockResolvedValue({ departments: [], users: [] });
    mockGetUsers.mockResolvedValue([]);
    mockNear.mockResolvedValue([]);
  });

  it('resolves a staff:<id> token without guessing', async () => {
    mockGetUsers.mockResolvedValue([ada]);
    await expect(resolveStaff({} as never, 'staff:staff-1')).resolves.toEqual({
      deptPath: '研发',
      name: 'Ada',
      staffId: 'staff-1',
      unionId: 'union-1',
    });
  });

  it('returns ambiguous when two directory users share a name', async () => {
    mockSearch.mockResolvedValue({
      departments: [],
      users: [
        { name: 'Ada', staffId: 'staff-1' },
        { name: 'Ada', staffId: 'staff-2' },
      ],
    });
    mockGetUsers.mockResolvedValue([
      ada,
      { ...ada, staffId: 'staff-2', unionId: 'union-2', deptPath: '销售' },
    ]);
    const result = await resolveStaff({} as never, 'Ada');
    expect(result).toMatchObject({
      ambiguous: [
        { staffId: 'staff-1', unionId: 'union-1' },
        { staffId: 'staff-2', unionId: 'union-2' },
      ],
    });
  });

  it('returns notFound with near-name suggestions', async () => {
    mockNear.mockResolvedValue([{ name: 'Ada', staffId: 'staff-1' }]);
    mockGetUsers.mockResolvedValue([ada]);
    const result = await resolveStaff({} as never, 'Adx');
    expect(result).toEqual({
      notFound: true,
      suggestions: [{ deptPath: '研发', name: 'Ada', staffId: 'staff-1', unionId: 'union-1' }],
    });
  });
});
