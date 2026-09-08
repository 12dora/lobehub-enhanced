/**
 * ROOT-02 — the ordinary-Agent mutation guard against a platform-managed materialized local id.
 *
 * @vitest-environment node
 */
import { TRPCError } from '@trpc/server';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MANAGED_ERROR_CODES } from '@/const/platform/errorCodes';
import { getTestDB } from '@/database/core/getTestDB';
import { PlatformAgentCatalogRepository } from '@/database/repositories/platformAgentCatalog';
import { agents } from '@/database/schemas/agent';
import {
  platformAgents,
  platformAgentVersions,
  platformUserAgentMaterializations,
} from '@/database/schemas/platform';
import { users } from '@/database/schemas/user';
import type { LobeChatDatabase } from '@/database/type';
import { PlatformDefaultInboxService } from '@/server/enterprise/services/agentCatalog/defaultInbox';

import { getEnterpriseErrorBody } from './enterpriseErrors';
import {
  assertAgentNotPlatformManaged,
  assertAgentsNotPlatformManaged,
  assertInboxManagedFieldsNotEdited,
  MANAGED_AGENT_BATCH_LIMIT_CODE,
  MANAGED_AGENT_BATCH_LIMIT_REASON,
  MANAGED_AGENT_MUTATION_FORBIDDEN,
  MAX_MANAGED_AGENT_GUARD_IDS,
  pickAgentId,
  pickAgentIds,
  pickDocumentAgentIds,
  pickId,
} from './managedPlatformAgent';

const db: LobeChatDatabase = await getTestDB();
const CHECKSUM = 'a'.repeat(64);

/** Per-file fixture ids — scoped cleanup only (SG-07). */
const USER_A = 'sg07-mpa-user-a';
const USER_B = 'sg07-mpa-user-b';
const PA_ID = 'sg07-mpa-pa';
const PA_V1 = 'sg07-mpa-pa-v1';
const AGT_MATERIALIZED = 'sg07-mpa-agt-mat';
const AGT_ORDINARY = 'sg07-mpa-agt-ord';
const AGT_BUILTIN_INBOX = 'sg07-mpa-builtin-inbox';

const cleanup = async () => {
  await db
    .delete(platformUserAgentMaterializations)
    .where(eq(platformUserAgentMaterializations.platformAgentId, PA_ID));
  // Version rows are append-immutable; opt-in delete for this suite's agent only.
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('lobe.allow_platform_agent_version_delete', 'on', true)`,
    );
    await tx.delete(platformAgentVersions).where(eq(platformAgentVersions.agentId, PA_ID));
  });
  await db.delete(platformAgents).where(eq(platformAgents.id, PA_ID));
  await db
    .delete(agents)
    .where(inArray(agents.id, [AGT_MATERIALIZED, AGT_ORDINARY, AGT_BUILTIN_INBOX]));
  await db.delete(users).where(inArray(users.id, [USER_A, USER_B]));
};

const seedMaterialized = async () => {
  await db.insert(platformAgents).values({
    agentKey: PA_ID,
    id: PA_ID,
    migrationRequired: false,
    status: 'draft',
    title: 'pa',
  });
  await db.insert(platformAgentVersions).values({
    agentId: PA_ID,
    checksum: CHECKSUM,
    config: {} as never,
    dependencySnapshot: { connectors: [], model: {}, skills: [] } as never,
    id: PA_V1,
    version: '1.0.0',
  });
  await db.insert(agents).values([
    { id: AGT_MATERIALIZED, title: 'M', userId: USER_A },
    { id: AGT_ORDINARY, title: 'O', userId: USER_A },
  ]);
  await new PlatformAgentCatalogRepository(db).materializeLocalAgent({
    createLocalAgent: async () => ({ id: AGT_MATERIALIZED }),
    platformAgentId: PA_ID,
    platformAgentVersionChecksum: CHECKSUM,
    platformAgentVersionId: PA_V1,
    userId: USER_A,
  });
};

const assertManaged = (agentId: string, userId = USER_A) =>
  assertAgentNotPlatformManaged({ agentId, db, userId }).then(
    () => null,
    (e) => e,
  );

beforeEach(async () => {
  vi.unstubAllEnvs();
  await cleanup();
  await db.insert(users).values([{ id: USER_A }, { id: USER_B }]);
  await seedMaterialized();
});

afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('assertAgentNotPlatformManaged (ROOT-02)', () => {
  it('rejects a mutation targeting a materialized platform Agent when the flag is on', async () => {
    vi.stubEnv('ENABLE_PLATFORM_MANAGED_AGENTS', '1');
    const error = await assertManaged(AGT_MATERIALIZED);
    expect(error).toBeInstanceOf(TRPCError);
    expect((error as TRPCError).code).toBe('FORBIDDEN');
  });

  it('allows an ordinary (non-materialized) local Agent', async () => {
    vi.stubEnv('ENABLE_PLATFORM_MANAGED_AGENTS', '1');
    expect(await assertManaged(AGT_ORDINARY)).toBeNull();
  });

  it('is owner-scoped: another user is never blocked by user-a’s mapping', async () => {
    vi.stubEnv('ENABLE_PLATFORM_MANAGED_AGENTS', '1');
    expect(await assertManaged(AGT_MATERIALIZED, USER_B)).toBeNull();
  });

  it('is a no-op when the managed flag is off (ordinary local Agents unaffected)', async () => {
    vi.stubEnv('ENABLE_PLATFORM_MANAGED_AGENTS', '0');
    expect(await assertManaged(AGT_MATERIALIZED)).toBeNull();
  });

  it('rejects the builtin inbox before its first operation creates a reverse mapping', async () => {
    vi.stubEnv('ENABLE_PLATFORM_MANAGED_AGENTS', '1');
    await db.insert(agents).values({ id: AGT_BUILTIN_INBOX, slug: 'inbox', userId: USER_A });
    const capture = vi
      .spyOn(PlatformDefaultInboxService.prototype, 'capture')
      .mockResolvedValue({} as never);

    const error = await assertManaged(AGT_BUILTIN_INBOX);
    expect(error).toBeInstanceOf(TRPCError);
    expect((error as TRPCError).code).toBe('FORBIDDEN');
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('fails closed when default-inbox resolution fails during a builtin inbox mutation', async () => {
    vi.stubEnv('ENABLE_PLATFORM_MANAGED_AGENTS', '1');
    await db.insert(agents).values({ id: AGT_BUILTIN_INBOX, slug: 'inbox', userId: USER_A });
    const failure = new Error('resolver unavailable');
    vi.spyOn(PlatformDefaultInboxService.prototype, 'capture').mockRejectedValue(failure);

    await expect(
      assertAgentNotPlatformManaged({ agentId: AGT_BUILTIN_INBOX, db, userId: USER_A }),
    ).rejects.toBe(failure);
  });
});

describe('assertAgentsNotPlatformManaged (RR2-4 batch)', () => {
  const assertMany = (agentIds: string[], userId = USER_A) =>
    assertAgentsNotPlatformManaged({ agentIds, db, userId }).then(
      () => null,
      (e) => e,
    );

  it('rejects the whole batch when ANY id is a materialized platform Agent', async () => {
    vi.stubEnv('ENABLE_PLATFORM_MANAGED_AGENTS', '1');
    // A managed id smuggled inside an otherwise-ordinary array must still be caught.
    const error = await assertMany([AGT_ORDINARY, AGT_MATERIALIZED]);
    expect(error).toBeInstanceOf(TRPCError);
    expect((error as TRPCError).code).toBe('FORBIDDEN');
  });

  it('allows a batch of only ordinary local Agents', async () => {
    vi.stubEnv('ENABLE_PLATFORM_MANAGED_AGENTS', '1');
    expect(await assertMany([AGT_ORDINARY])).toBeNull();
    expect(await assertMany([])).toBeNull();
  });

  it('is owner-scoped and flag-gated', async () => {
    vi.stubEnv('ENABLE_PLATFORM_MANAGED_AGENTS', '1');
    expect(await assertMany([AGT_MATERIALIZED], USER_B)).toBeNull();
    const countingDb = Object.create(db) as LobeChatDatabase;
    countingDb.select = vi.fn(db.select.bind(db)) as never;
    vi.stubEnv('ENABLE_PLATFORM_MANAGED_AGENTS', '0');
    await expect(
      assertAgentsNotPlatformManaged({
        agentIds: [AGT_MATERIALIZED],
        db: countingDb,
        userId: USER_A,
      }),
    ).resolves.toBeUndefined();
    expect(countingDb.select).not.toHaveBeenCalled();
  });

  it('deduplicates into a fixed set of owner-scoped batch queries', async () => {
    vi.stubEnv('ENABLE_PLATFORM_MANAGED_AGENTS', '1');
    const countingDb = Object.create(db) as LobeChatDatabase;
    countingDb.select = vi.fn(db.select.bind(db)) as never;

    await expect(
      assertAgentsNotPlatformManaged({
        agentIds: [AGT_ORDINARY, AGT_ORDINARY],
        db: countingDb,
        userId: USER_A,
      }),
    ).resolves.toBeUndefined();
    // live materializations + tombstones + inbox-slug lookup (deduped agent id list once each)
    expect(countingDb.select).toHaveBeenCalledTimes(3);
  });

  it('skipManagedInbox still rejects a materialized platform Agent', async () => {
    vi.stubEnv('ENABLE_PLATFORM_MANAGED_AGENTS', '1');
    const error = await assertAgentsNotPlatformManaged({
      agentIds: [AGT_MATERIALIZED],
      db,
      skipManagedInbox: true,
      userId: USER_A,
    }).then(
      () => null,
      (e) => e,
    );
    expect(error).toBeInstanceOf(TRPCError);
    expect((error as TRPCError).code).toBe('FORBIDDEN');
  });

  it('skipManagedInbox does not blanket-reject the builtin inbox', async () => {
    vi.stubEnv('ENABLE_PLATFORM_MANAGED_AGENTS', '1');
    await db.insert(agents).values({ id: AGT_BUILTIN_INBOX, slug: 'inbox', userId: USER_A });
    const capture = vi
      .spyOn(PlatformDefaultInboxService.prototype, 'capture')
      .mockResolvedValue({} as never);

    await expect(
      assertAgentsNotPlatformManaged({
        agentIds: [AGT_BUILTIN_INBOX],
        db,
        skipManagedInbox: true,
        userId: USER_A,
      }),
    ).resolves.toBeUndefined();
    expect(capture).not.toHaveBeenCalled();
  });

  it('rejects oversized batches before any query with structured i18n details', async () => {
    vi.stubEnv('ENABLE_PLATFORM_MANAGED_AGENTS', '1');
    const countingDb = Object.create(db) as LobeChatDatabase;
    countingDb.select = vi.fn(db.select.bind(db)) as never;
    const ids = Array.from({ length: MAX_MANAGED_AGENT_GUARD_IDS + 1 }, (_, i) => `agt_${i}`);

    const error = await assertAgentsNotPlatformManaged({
      agentIds: ids,
      db: countingDb,
      userId: USER_A,
    }).then(
      () => null,
      (e) => e,
    );
    expect(error).toBeInstanceOf(TRPCError);
    expect((error as TRPCError).code).toBe('BAD_REQUEST');
    expect((error as TRPCError).message).toBe(MANAGED_AGENT_BATCH_LIMIT_CODE);
    expect(getEnterpriseErrorBody(error)).toEqual({
      code: MANAGED_AGENT_BATCH_LIMIT_CODE,
      details: {
        max: MAX_MANAGED_AGENT_GUARD_IDS,
        reason: MANAGED_AGENT_BATCH_LIMIT_REASON,
      },
      message: MANAGED_AGENT_BATCH_LIMIT_CODE,
    });
    expect(countingDb.select).not.toHaveBeenCalled();
  });

  it('exposes a dedicated batch-limit code + details.max contract for client i18n', () => {
    // Server contract only — client mapper + locale keys are OUT_OF_SCOPE shared-infra/i18n.
    expect(MANAGED_AGENT_BATCH_LIMIT_CODE).toBe('MANAGED_AGENT_BATCH_LIMIT');
    expect(MANAGED_AGENT_BATCH_LIMIT_REASON).toBe('managed_agent_batch_limit');
    // i18n key shape clients must register: enterprise.error.MANAGED_AGENT_BATCH_LIMIT with {{max}}.
    const i18nKey = `enterprise.error.${MANAGED_AGENT_BATCH_LIMIT_CODE}`;
    expect(i18nKey).toBe('enterprise.error.MANAGED_AGENT_BATCH_LIMIT');
    expect(MAX_MANAGED_AGENT_GUARD_IDS).toBe(100);
  });
});

describe('agent-id pickers (RR2-4)', () => {
  it('extract the target agent id(s) from each mutation input shape', () => {
    expect(pickAgentId({ agentId: 'a1' })).toEqual(['a1']);
    expect(pickId({ id: 'a2' })).toEqual(['a2']);
    expect(pickAgentIds({ agentIds: ['a3', 'a4'] })).toEqual(['a3', 'a4']);
    expect(pickDocumentAgentIds({ sourceAgentId: 's', targetAgentId: 't' })).toEqual([
      undefined,
      's',
      't',
    ]);
    // Robust to malformed / missing inputs (guard then simply finds nothing to check).
    expect(pickAgentIds({})).toEqual([]);
    expect(pickAgentId(null)).toEqual([undefined]);
    expect(pickId(undefined)).toEqual([undefined]);
  });
});

describe('assertInboxManagedFieldsNotEdited', () => {
  const run = (patch: unknown, agentId = AGT_BUILTIN_INBOX) =>
    assertInboxManagedFieldsNotEdited({
      agentId,
      db,
      patch,
      userId: USER_A,
    });

  const seedInbox = async () => {
    await db.insert(agents).values({ id: AGT_BUILTIN_INBOX, slug: 'inbox', userId: USER_A });
  };

  beforeEach(() => {
    vi.stubEnv('ENABLE_PLATFORM_MANAGED_AGENTS', '1');
  });

  it('rejects admin-owned fields when the platform overlay is bound', async () => {
    await seedInbox();
    const capture = vi
      .spyOn(PlatformDefaultInboxService.prototype, 'capture')
      .mockResolvedValue({} as never);

    const error = await run({ model: 'gpt-4o', systemRole: 'x' }).then(
      () => null,
      (e) => e,
    );
    expect(error).toBeInstanceOf(TRPCError);
    expect((error as TRPCError).code).toBe(MANAGED_AGENT_MUTATION_FORBIDDEN.code);
    expect((error as TRPCError).message).toBe(MANAGED_ERROR_CODES.MANAGED_RESOURCE_BY_PLATFORM);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('rejects title/avatar meta fields the same way as model/systemRole', async () => {
    await seedInbox();
    vi.spyOn(PlatformDefaultInboxService.prototype, 'capture').mockResolvedValue({} as never);

    const error = await run({ avatar: 'x', title: 'Managed' }).then(
      () => null,
      (e) => e,
    );
    expect(error).toBeInstanceOf(TRPCError);
    expect((error as TRPCError).message).toBe(MANAGED_ERROR_CODES.MANAGED_RESOURCE_BY_PLATFORM);
  });

  it('allows per-user preference patches without capturing the overlay', async () => {
    await seedInbox();
    const select = vi.spyOn(db, 'select');
    const capture = vi.spyOn(PlatformDefaultInboxService.prototype, 'capture');

    await expect(
      run({
        agencyConfig: { enabled: true },
        chatConfig: { enableReasoning: true },
        fewShots: [],
        tts: { showAllLocaleVoice: true },
      }),
    ).resolves.toBeUndefined();
    expect(select).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('rejects a mixed patch that also touches an admin-owned field', async () => {
    await seedInbox();
    vi.spyOn(PlatformDefaultInboxService.prototype, 'capture').mockResolvedValue({} as never);

    const error = await run({ chatConfig: { enableReasoning: true }, model: 'x' }).then(
      () => null,
      (e) => e,
    );
    expect(error).toBeInstanceOf(TRPCError);
  });

  it('does not call capture for a non-inbox agent', async () => {
    const capture = vi.spyOn(PlatformDefaultInboxService.prototype, 'capture');

    await expect(run({ model: 'x' }, AGT_ORDINARY)).resolves.toBeUndefined();
    expect(capture).not.toHaveBeenCalled();
  });

  it('allows admin-owned fields when the overlay is not bound', async () => {
    await seedInbox();
    const capture = vi
      .spyOn(PlatformDefaultInboxService.prototype, 'capture')
      .mockResolvedValue(null);

    await expect(run({ systemRole: 'personal' })).resolves.toBeUndefined();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the managed flag is off', async () => {
    vi.stubEnv('ENABLE_PLATFORM_MANAGED_AGENTS', '0');
    await seedInbox();
    const capture = vi.spyOn(PlatformDefaultInboxService.prototype, 'capture');

    await expect(run({ model: 'x' })).resolves.toBeUndefined();
    expect(capture).not.toHaveBeenCalled();
  });
});
