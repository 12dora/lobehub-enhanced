// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { resolveUserRefs, userRefOf } from './userRefResolver';

const serverDB: LobeChatDatabase = await getTestDB();

const IDS = {
  a: 'user-ref-a',
  b: 'user-ref-b',
};

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, IDS.a));
  await serverDB.delete(users).where(eq(users.id, IDS.b));
  await serverDB.insert(users).values([
    { avatar: 'https://cdn.example/a.png', fullName: '邵军军', id: IDS.a, username: null },
    { email: 'alice@example.com', fullName: 'Alice Smith', id: IDS.b, username: 'alice' },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, IDS.a));
  await serverDB.delete(users).where(eq(users.id, IDS.b));
});

describe('resolveUserRefs', () => {
  it('dedupes ids and omits unknown rows', async () => {
    const refs = await resolveUserRefs(serverDB, [IDS.a, IDS.a, 'missing', '', IDS.b]);
    expect([...refs.keys()].sort()).toEqual([IDS.a, IDS.b].sort());
    expect(refs.get(IDS.a)).toEqual({
      avatar: 'https://cdn.example/a.png',
      email: null,
      fullName: '邵军军',
      id: IDS.a,
      username: null,
    });
    expect(userRefOf('missing', refs)).toBeNull();
    expect(userRefOf(null, refs)).toBeNull();
    expect(userRefOf(IDS.b, refs)?.username).toBe('alice');
  });

  it('returns an empty map for empty input', async () => {
    await expect(resolveUserRefs(serverDB, [])).resolves.toEqual(new Map());
  });
});
