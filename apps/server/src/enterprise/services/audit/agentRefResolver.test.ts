// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { agents, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { agentRefOf, resolveAgentRefs, withAgentDisplay } from './agentRefResolver';

const serverDB: LobeChatDatabase = await getTestDB();

const IDS = {
  agent: 'agt-ref-agent',
  empty: 'agt-ref-agent-empty',
  user: 'agt-ref-user',
};

beforeEach(async () => {
  await serverDB.delete(agents).where(eq(agents.userId, IDS.user));
  await serverDB.delete(users).where(eq(users.id, IDS.user));
  await serverDB.insert(users).values({ id: IDS.user });
  await serverDB.insert(agents).values([
    { id: IDS.agent, slug: 'inbox', title: 'Support Bot', userId: IDS.user },
    { id: IDS.empty, slug: '   ', title: '', userId: IDS.user },
  ]);
});

afterEach(async () => {
  await serverDB.delete(agents).where(eq(agents.userId, IDS.user));
  await serverDB.delete(users).where(eq(users.id, IDS.user));
});

describe('resolveAgentRefs', () => {
  it('batch-resolves title and slug and omits missing ids', async () => {
    const refs = await resolveAgentRefs(serverDB, [IDS.agent, IDS.agent, 'missing', null, '']);
    expect([...refs.keys()]).toEqual([IDS.agent]);
    expect(refs.get(IDS.agent)).toEqual({ slug: 'inbox', title: 'Support Bot' });
    expect(agentRefOf('missing', refs)).toBeNull();
    expect(agentRefOf(null, refs)).toBeNull();
  });

  it('treats blank title/slug as null and maps conversation topic DTOs', async () => {
    const refs = await resolveAgentRefs(serverDB, [IDS.agent, IDS.empty]);
    expect(refs.get(IDS.empty)).toEqual({ slug: null, title: null });

    expect(withAgentDisplay({ agentId: IDS.agent, id: 't1' }, refs)).toEqual({
      agentId: IDS.agent,
      agentSlug: 'inbox',
      agentTitle: 'Support Bot',
      id: 't1',
    });
    expect(withAgentDisplay({ agentId: IDS.empty, id: 't2' }, refs)).toEqual({
      agentId: IDS.empty,
      agentSlug: null,
      agentTitle: null,
      id: 't2',
    });
    expect(withAgentDisplay({ agentId: null, id: 't3' }, refs)).toEqual({
      agentId: null,
      agentSlug: null,
      agentTitle: null,
      id: 't3',
    });
  });

  it('returns an empty map for empty input', async () => {
    await expect(resolveAgentRefs(serverDB, [])).resolves.toEqual(new Map());
  });
});
