// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const getUsers = vi.fn();
const selectWhere = vi.fn();

vi.mock('@/database/models/dingtalkDirectory', () => ({
  DingTalkDirectoryModel: class {
    getUsers = getUsers;
  },
}));

const { collectOriginatorIds, pickOriginatorLabels, resolveOriginatorLabels } =
  await import('./labels');

describe('originator labels', () => {
  it('collects unique staff and department ids', () => {
    expect(
      collectOriginatorIds({
        match: 'all',
        originators: { deptIds: ['d1', 'd1', ''], staffIds: ['s1', ' s2 '] },
      }),
    ).toEqual({ deptIds: ['d1'], staffIds: ['s1', 's2'] });
    expect(collectOriginatorIds({ match: 'all' })).toEqual({ deptIds: [], staffIds: [] });
  });

  it('picks only the ids that belong to the rule', () => {
    expect(
      pickOriginatorLabels(
        { match: 'all', originators: { deptIds: ['d1'], staffIds: ['s1'] } },
        { d1: '研发部', d2: '财务', s1: '张三', s9: '别人' },
      ),
    ).toEqual({ d1: '研发部', s1: '张三' });
  });

  it('resolves names from the directory mirror and omits misses', async () => {
    getUsers.mockResolvedValueOnce([{ name: '张三', staffId: 's1' }]);
    selectWhere.mockResolvedValueOnce([{ deptId: 'd1', name: '研发部' }]);
    const db = {
      select: () => ({
        from: () => ({
          where: selectWhere,
        }),
      }),
    };

    await expect(
      resolveOriginatorLabels(db as never, [
        { match: 'all', originators: { deptIds: ['d1', 'd-missing'], staffIds: ['s1'] } },
      ]),
    ).resolves.toEqual({ d1: '研发部', s1: '张三' });
    expect(selectWhere).toHaveBeenCalledTimes(1);
  });
});
