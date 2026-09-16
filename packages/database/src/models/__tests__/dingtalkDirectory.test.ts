// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  dingtalkDepartments,
  dingtalkDirectoryUsers,
  dingtalkUserDepartments,
} from '../../schemas/dingtalkDirectory';
import type { LobeChatDatabase } from '../../type';
import { pinyinFieldsFromFullName } from '../../utils/pinyin';
import { DingTalkDirectoryModel } from '../dingtalkDirectory';

const serverDB: LobeChatDatabase = await getTestDB();
const model = new DingTalkDirectoryModel(serverDB);

const syncedAt = new Date('2026-09-16T04:00:00.000Z');

const pinyin = (name: string) => {
  const fields = pinyinFieldsFromFullName(name);
  return {
    namePinyinFull: fields.pinyinFull ?? '',
    namePinyinInitials: fields.pinyinInitials ?? '',
  };
};

const seedDirectory = async () => {
  await model.replaceAll({
    departments: [
      {
        deptId: '1',
        memberCount: 0,
        name: '捷发',
        parentId: null,
        pathNames: '',
        sortOrder: 0,
        syncedAt,
        ...pinyin('捷发'),
      },
      {
        deptId: 'anhuan',
        memberCount: 2,
        name: '安环部',
        parentId: '1',
        pathNames: '捷发 / 安环部',
        sortOrder: 1,
        syncedAt,
        ...pinyin('安环部'),
      },
      {
        deptId: 'finance',
        memberCount: 1,
        name: '财务部',
        parentId: '1',
        pathNames: '捷发 / 财务部',
        sortOrder: 2,
        syncedAt,
        ...pinyin('财务部'),
      },
      {
        deptId: 'anhuan-sub',
        memberCount: 1,
        name: '安环分部',
        parentId: 'anhuan',
        pathNames: '捷发 / 安环部 / 安环分部',
        sortOrder: 3,
        syncedAt,
        ...pinyin('安环分部'),
      },
    ],
    memberships: [
      { deptId: 'anhuan', staffId: 'staff_hyq_a' },
      { deptId: 'finance', staffId: 'staff_hyq_b' },
      { deptId: 'anhuan-sub', staffId: 'staff_sub' },
      { deptId: 'anhuan', staffId: 'staff_inactive' },
    ],
    users: [
      {
        active: true,
        deptPath: '捷发 / 安环部',
        leafDeptId: 'anhuan',
        leafDeptName: '安环部',
        name: '胡玉琴A',
        staffId: 'staff_hyq_a',
        syncedAt,
        ...pinyin('胡玉琴A'),
      },
      {
        active: true,
        deptPath: '捷发 / 财务部',
        leafDeptId: 'finance',
        leafDeptName: '财务部',
        name: '胡玉琴A',
        staffId: 'staff_hyq_b',
        syncedAt,
        ...pinyin('胡玉琴A'),
      },
      {
        active: true,
        deptPath: '捷发 / 安环部 / 安环分部',
        leafDeptId: 'anhuan-sub',
        leafDeptName: '安环分部',
        name: '李四分',
        staffId: 'staff_sub',
        syncedAt,
        ...pinyin('李四分'),
      },
      {
        active: false,
        deptPath: '捷发 / 安环部',
        leafDeptId: 'anhuan',
        leafDeptName: '安环部',
        name: '已离职',
        staffId: 'staff_inactive',
        syncedAt,
        ...pinyin('已离职'),
      },
    ],
  });
};

beforeEach(async () => {
  await serverDB.delete(dingtalkUserDepartments);
  await serverDB.delete(dingtalkDirectoryUsers);
  await serverDB.delete(dingtalkDepartments);
  await seedDirectory();
});

afterEach(async () => {
  await serverDB.delete(dingtalkUserDepartments);
  await serverDB.delete(dingtalkDirectoryUsers);
  await serverDB.delete(dingtalkDepartments);
});

describe('DingTalkDirectoryModel', () => {
  describe('search', () => {
    it('matches 胡玉琴A by name, full pinyin, prefix, and initials', async () => {
      for (const q of ['胡玉琴A', '胡玉', 'huyuqina', 'huyuqin', 'hyqa', 'hyq']) {
        const result = await model.search(q);
        expect(
          result.users.map((row) => row.staffId),
          q,
        ).toEqual(expect.arrayContaining(['staff_hyq_a', 'staff_hyq_b']));
      }
    });

    it('returns both same-name users with different dept paths', async () => {
      const result = await model.search('胡玉琴A', { kind: 'user' });
      expect(result.users).toHaveLength(2);
      expect(result.users.map((row) => row.deptPath).sort()).toEqual([
        '捷发 / 安环部',
        '捷发 / 财务部',
      ]);
      expect(result.departments).toEqual([]);
    });

    it('searches departments by name and pinyin and reports subtree member counts', async () => {
      const result = await model.search('安环', { kind: 'department' });
      expect(result.users).toEqual([]);
      const anhuan = result.departments.find((row) => row.deptId === 'anhuan');
      expect(anhuan).toMatchObject({
        name: '安环部',
        pathNames: '捷发 / 安环部',
      });
      // Direct: 胡玉琴A + inactive. Subtree adds 李四分. Active only: 2.
      expect(anhuan?.memberCount).toBe(2);
    });

    it('returns empty results for a blank query', async () => {
      await expect(model.search('   ')).resolves.toEqual({ departments: [], users: [] });
    });
  });

  describe('subtree', () => {
    it('includes the department and its descendants', async () => {
      const ids = await model.subtreeDeptIds('anhuan');
      expect(ids.sort()).toEqual(['anhuan', 'anhuan-sub'].sort());
    });

    it('returns only active staff ids in the subtree', async () => {
      const staffIds = await model.subtreeMemberStaffIds('anhuan');
      expect(staffIds.sort()).toEqual(['staff_hyq_a', 'staff_sub'].sort());
      expect(staffIds).not.toContain('staff_inactive');
    });

    it('returns empty arrays for an unknown department', async () => {
      await expect(model.subtreeDeptIds('missing')).resolves.toEqual([]);
      await expect(model.subtreeMemberStaffIds('missing')).resolves.toEqual([]);
    });
  });

  describe('getUsers / getDepartment / stats', () => {
    it('returns requested users and a single department', async () => {
      const users = await model.getUsers(['staff_hyq_a', 'missing']);
      expect(users.map((row) => row.staffId)).toEqual(['staff_hyq_a']);

      const dept = await model.getDepartment('finance');
      expect(dept?.name).toBe('财务部');
      await expect(model.getDepartment('missing')).resolves.toBeUndefined();
      await expect(model.getUsers([])).resolves.toEqual([]);
    });

    it('reports directory stats', async () => {
      const stats = await model.stats();
      expect(stats.departments).toBe(4);
      expect(stats.users).toBe(4);
      expect(stats.lastSyncedAt).toEqual(syncedAt);
    });
  });

  describe('replaceAll', () => {
    it('replaces the directory transactionally and fills pinyin when omitted', async () => {
      await model.replaceAll({
        departments: [
          {
            deptId: '1',
            name: '根',
            parentId: null,
            syncedAt,
          },
        ],
        memberships: [],
        users: [
          {
            name: '张三',
            staffId: 'staff_zs',
            syncedAt,
          },
        ],
      });

      const stats = await model.stats();
      expect(stats.departments).toBe(1);
      expect(stats.users).toBe(1);

      const [user] = await model.getUsers(['staff_zs']);
      expect(user.namePinyinFull).toBe(pinyin('张三').namePinyinFull);
      expect(user.namePinyinInitials).toBe(pinyin('张三').namePinyinInitials);
    });
  });
});
