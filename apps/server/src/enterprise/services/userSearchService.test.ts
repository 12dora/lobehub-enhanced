// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { pinyinFieldsFromFullName } from '@/database/utils/pinyin';

import { UserSearchService } from './userSearchService';

const serverDB: LobeChatDatabase = await getTestDB();
const service = new UserSearchService(serverDB);
const id = 'user-search-svc-ding';

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, id));
  await serverDB.insert(users).values({
    email: 'dingtalk-synthetic@example.invalid',
    fullName: '邵军军',
    id,
    username: null,
    ...pinyinFieldsFromFullName('邵军军'),
  });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, id));
});

describe('UserSearchService', () => {
  it('returns UserPublicRef items for CJK name and pinyin queries', async () => {
    for (const q of ['邵军军', 'shao', 'sjj']) {
      const { items } = await service.search({ limit: 20, q });
      expect(
        items.map((row) => row.id),
        q,
      ).toContain(id);
      expect(items.find((row) => row.id === id)).toMatchObject({
        avatar: null,
        email: 'dingtalk-synthetic@example.invalid',
        fullName: '邵军军',
        id,
        username: null,
      });
    }
  });
});
