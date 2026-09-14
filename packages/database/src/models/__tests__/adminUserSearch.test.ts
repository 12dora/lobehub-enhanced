// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { pinyinFieldsFromFullName } from '../../utils/pinyin';
import { searchUsers } from '../adminUserSearch';

const serverDB: LobeChatDatabase = await getTestDB();

const IDS = {
  ding: 'admin-search-dingtalk',
  latin: 'admin-search-alice',
};

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, IDS.ding));
  await serverDB.delete(users).where(eq(users.id, IDS.latin));
  await serverDB.insert(users).values([
    {
      email: 'dingtalk-synthetic@example.invalid',
      fullName: '邵军军',
      id: IDS.ding,
      username: null,
      ...pinyinFieldsFromFullName('邵军军'),
    },
    {
      email: 'alice@example.com',
      fullName: 'Alice Smith',
      id: IDS.latin,
      username: 'alice',
      ...pinyinFieldsFromFullName('Alice Smith'),
    },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, IDS.ding));
  await serverDB.delete(users).where(eq(users.id, IDS.latin));
});

describe('searchUsers', () => {
  it('matches a CJK display name by substring, full pinyin, prefix, and initials', async () => {
    for (const q of ['邵军军', '军军', 'shaojunjun', 'shao', 'shaojun', 'sjj', 's', 'sj']) {
      const items = await searchUsers(serverDB, { limit: 20, q });
      expect(
        items.map((row) => row.id),
        q,
      ).toContain(IDS.ding);
    }
  });

  it('matches latin names by contains on fullName and email', async () => {
    const byName = await searchUsers(serverDB, { limit: 20, q: 'Smith' });
    expect(byName.map((row) => row.id)).toContain(IDS.latin);

    const byEmail = await searchUsers(serverDB, { limit: 20, q: 'alice@' });
    expect(byEmail.map((row) => row.id)).toContain(IDS.latin);
  });

  it('treats LIKE metacharacters as literals', async () => {
    const items = await searchUsers(serverDB, { limit: 20, q: '%alice' });
    expect(items.map((row) => row.id)).not.toContain(IDS.latin);
  });
});
