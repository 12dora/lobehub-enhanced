// @vitest-environment node
import { LobeChatGPTAI } from '@lobechat/model-runtime';
import { eq, sql } from 'drizzle-orm';
import { AiModelSettingsSchema } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { PlatformAgentCatalogRepository } from '@/database/repositories/platformAgentCatalog';
import {
  platformAgents,
  platformAgentVersions,
  platformAiModels,
  platformAiProviders,
  platformAiProviderSecrets,
  platformAuditLogs,
  platformJobs,
  platformResourceRevisions,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { type KeyProvider, PlatformSecretService } from '@/server/enterprise/security/secret';
import * as ModelRuntime from '@/server/modules/ModelRuntime';

import type { AiProviderDraft } from '../../contracts/aiCatalog';
import { PlatformAuditService } from '../platformAudit';
import {
  AiCatalogAdminService,
  AiCatalogUpstreamSyncError,
  AiCatalogValidationError,
} from './adminService';
import { applyChatGPTWebCatalogSyncPolicy, mapCardsToBatchUpdate } from './adminService.sync';
import {
  applyCursorCatalogSyncPolicy,
  applyProviderCatalogSyncPolicy,
  FAMILY_INHERITED_KEYS,
} from './adminService.sync.mapping';
import type * as DependenciesModule from './dependencies';
import { AiCatalogExecutionResolver } from './runtimeAdapter';
import type * as SharedOAuthRefreshModule from './sharedOAuthRefresh';

const db: LobeChatDatabase = await getTestDB();
const keyProvider: KeyProvider = {
  getKek: async () => ({ key: new Uint8Array(32).fill(71), keyId: 'sync-test' }),
  providerId: 'test',
};

vi.mock('@/server/modules/ModelRuntime', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    initModelRuntimeWithUserPayload: vi.fn(),
  };
});

const { dependentOverride, mockRefreshSharedOAuthVault } = vi.hoisted(() => ({
  dependentOverride: {
    current: null as
      | ((
          db: unknown,
          providerKey: string,
          modelKeys: readonly string[],
        ) => Promise<
          Array<{
            blocking: boolean;
            label: string;
            resourceId: string;
            resourceType: string;
          }>
        >)
      | null,
  },
  mockRefreshSharedOAuthVault: vi.fn(),
}));

vi.mock('./dependencies', async (importOriginal) => {
  const actual = await importOriginal<typeof DependenciesModule>();
  return {
    ...actual,
    resolveAiCatalogDependentsForModels: (
      db: Parameters<typeof actual.resolveAiCatalogDependentsForModels>[0],
      providerKey: string,
      modelKeys: readonly string[],
    ) =>
      dependentOverride.current
        ? dependentOverride.current(db, providerKey, modelKeys)
        : actual.resolveAiCatalogDependentsForModels(db, providerKey, modelKeys),
  };
});

vi.mock('./sharedOAuthRefresh', async (importOriginal) => {
  const actual = await importOriginal<typeof SharedOAuthRefreshModule>();
  return {
    ...actual,
    refreshSharedOAuthVault: mockRefreshSharedOAuthVault,
  };
});

const mockModels = vi.fn();

const cleanup = async () => {
  await db.execute(sql`
    TRUNCATE TABLE
      ${platformAuditLogs},
      ${platformResourceRevisions},
      ${platformAgentVersions},
      ${platformAgents},
      ${platformAiModels},
      ${platformAiProviderSecrets},
      ${platformAiProviders},
      ${platformJobs}
    RESTART IDENTITY CASCADE
  `);
};

const createService = () =>
  new AiCatalogAdminService(db, new PlatformSecretService({ keyProvider }));

const draftModel = (
  overrides: Partial<AiProviderDraft['models'][number]> &
    Pick<AiProviderDraft['models'][number], 'id' | 'modelKey'>,
): AiProviderDraft['models'][number] => ({
  abilities: {},
  config: null,
  contextWindowTokens: null,
  description: null,
  displayName: overrides.modelKey,
  enabled: true,
  parameters: {},
  pricing: null,
  providerId: 'provider-1',
  revision: 1,
  settings: {},
  sort: 0,
  status: 'published',
  type: 'chat',
  ...overrides,
});

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv('ENABLE_PLATFORM_ADMIN', '1');
  vi.stubEnv('CHATGPT_CODEX_CLIENT_VERSION', '0.153.4');
  mockModels.mockReset();
  vi.mocked(ModelRuntime.initModelRuntimeWithUserPayload).mockReset();
  vi.mocked(ModelRuntime.initModelRuntimeWithUserPayload).mockReturnValue({
    models: mockModels,
  } as never);
  mockRefreshSharedOAuthVault.mockReset();
  mockRefreshSharedOAuthVault.mockImplementation(async (params) => params.keyVaults);
  await cleanup();
});

afterEach(async () => {
  dependentOverride.current = null;
  await cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const seedProvider = async (providerKey: string) => {
  const service = createService();
  const created = await service.applyProviderImmediate('admin', {
    displayName: providerKey,
    enabled: true,
    mode: 'create',
    providerKey,
    reason: 'seed provider',
    secret: { operation: 'replace', value: `seed-${providerKey}` },
    settings: { sdkType: 'openai' },
    source: 'custom',
  });
  return { providerId: created.draft.id, service };
};

const listThroughChatGPT = async (data: Array<Record<string, unknown>>) => {
  const instance = new LobeChatGPTAI({ apiKey: 'sync-ability-fixture' });
  vi.spyOn(instance['client'], 'get').mockResolvedValue({ data } as never);
  const listed = await instance.models();
  const requested = new Set(
    data.map((item) => item.id).filter((id): id is string => typeof id === 'string'),
  );
  // models() also unions bank image cards; these cases only care about the fixture payload.
  return listed.filter((card) => requested.has(card.id));
};

describe('mapCardsToBatchUpdate', () => {
  it('retains live Codex protocol settings through sync and keeps new Astra disabled', async () => {
    const runtime = new LobeChatGPTAI({ apiKey: 'catalog-fixture' });
    vi.spyOn(runtime.client, 'get').mockResolvedValue({
      models: [
        {
          slug: 'gpt-6-astra',
          supported_in_api: true,
          use_responses_lite: true,
          supported_reasoning_levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(
            (effort) => ({ effort }),
          ),
        },
      ],
    } as never);
    const cards = (await runtime.models()).filter((card) => card.id === 'gpt-6-astra');
    const result = mapCardsToBatchUpdate(cards, []);
    expect(result.items[0]).toMatchObject({
      enabled: false,
      id: 'gpt-6-astra',
      settings: { chatgptResponsesLite: true, extendParams: ['gpt5_6ReasoningEffort'] },
    });
    expect(AiModelSettingsSchema.parse(result.items[0].settings)).toHaveProperty(
      'chatgptResponsesLite',
      true,
    );
    const existing = draftModel({
      enabled: true,
      id: 'astra-id',
      modelKey: 'gpt-6-astra',
      settings: { chatgptResponsesLite: false },
    });
    const updated = mapCardsToBatchUpdate(cards, [existing]);
    expect(updated.items[0]).not.toHaveProperty('enabled');
    expect(updated.items[0].settings).toHaveProperty('chatgptResponsesLite', true);
  });

  it('clears stored abilities when the live Codex payload reports every capability as false', async () => {
    const cards = await listThroughChatGPT([
      {
        displayName: 'Custom Grok',
        id: 'codex-sync-ability-fixture',
        reasoning: false,
        search: false,
      },
    ]);
    const existing = draftModel({
      abilities: { reasoning: true, search: true },
      displayName: cards[0]?.displayName ?? 'codex-sync-ability-fixture',
      id: 'model-1',
      modelKey: 'codex-sync-ability-fixture',
    });

    const result = mapCardsToBatchUpdate(cards, [existing]);

    expect(result.items).toEqual([expect.objectContaining({ abilities: {}, id: 'model-1' })]);
    expect(result.updated).toBe(1);
  });

  it('keeps stored abilities when the live Codex payload is a bare id', async () => {
    const cards = await listThroughChatGPT([{ id: 'codex-sync-ability-fixture' }]);
    const existing = draftModel({
      abilities: { reasoning: true, search: true },
      displayName: cards[0]?.displayName ?? 'codex-sync-ability-fixture',
      id: 'model-1',
      modelKey: 'codex-sync-ability-fixture',
    });

    const result = mapCardsToBatchUpdate(cards, [existing]);

    expect(result.items.every((item) => item.abilities === undefined)).toBe(true);
  });

  it('emits an update when the only change is settings.extendParams', () => {
    const existing = draftModel({
      displayName: 'GPT-5.5',
      id: 'model-1',
      modelKey: 'gpt-5.5',
      settings: { extendParams: ['gpt5_2ReasoningEffort'] },
    });
    const cards = [
      {
        displayName: 'GPT-5.5',
        id: 'gpt-5.5',
        settings: { extendParams: ['gpt5_6ReasoningEffort' as const] },
      },
    ];

    const result = mapCardsToBatchUpdate(cards, [existing]);

    expect(result.updated).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'model-1',
        settings: { extendParams: ['gpt5_6ReasoningEffort'] },
      }),
    ]);
  });

  const inheritedGrok47 = () => {
    const card = {
      displayName: 'Grok 4.7',
      files: true,
      functionCall: true,
      id: 'grok-4.7',
      reasoning: true,
      search: true,
      settings: {
        extendParams: ['grok4_20ReasoningEffort' as const],
        searchImpl: 'params' as const,
      },
      structuredOutput: true,
      type: 'chat' as const,
      vision: true,
    };
    Object.defineProperty(card, FAMILY_INHERITED_KEYS, {
      configurable: true,
      enumerable: true,
      value: {
        abilities: ['files', 'functionCall', 'reasoning', 'search', 'structuredOutput', 'vision'],
        settings: ['extendParams', 'searchImpl'],
      },
    });
    return card;
  };

  it('persists inferred abilities and settings on a new row', () => {
    const result = mapCardsToBatchUpdate([inheritedGrok47()], []);

    expect(result.created).toBe(1);
    expect(result.items[0]).toMatchObject({
      abilities: {
        files: true,
        functionCall: true,
        reasoning: true,
        search: true,
        structuredOutput: true,
        vision: true,
      },
      enabled: false,
      id: 'grok-4.7',
      settings: { extendParams: ['grok4_20ReasoningEffort'], searchImpl: 'params' },
    });
  });

  it('back-fills an existing row whose abilities and settings are both empty', () => {
    const existing = draftModel({
      abilities: {},
      displayName: 'Grok 4.7',
      id: 'model-1',
      modelKey: 'grok-4.7',
      settings: {},
    });

    const result = mapCardsToBatchUpdate([inheritedGrok47()], [existing]);

    expect(result.updated).toBe(1);
    expect(result.items[0]).toMatchObject({
      abilities: { files: true, reasoning: true, search: true, structuredOutput: true },
      id: 'model-1',
      settings: { extendParams: ['grok4_20ReasoningEffort'], searchImpl: 'params' },
    });
    expect(result.items[0]).not.toHaveProperty('enabled');
  });

  it('does not overwrite abilities or family-inherited settings once an admin has set either', () => {
    const abilitiesOnly = draftModel({
      abilities: { vision: true },
      displayName: 'Grok 4.7',
      id: 'abilities-set',
      modelKey: 'grok-4.7',
      settings: {},
    });
    const settingsOnly = draftModel({
      abilities: {},
      displayName: 'Grok 4.7',
      id: 'settings-set',
      modelKey: 'grok-4.7',
      settings: { searchImpl: 'tool' },
    });

    expect(mapCardsToBatchUpdate([inheritedGrok47()], [abilitiesOnly]).items).toEqual([]);
    expect(mapCardsToBatchUpdate([inheritedGrok47()], [settingsOnly]).items).toEqual([]);
  });

  it('strips donor extendParams and searchImpl when the card already has settings and the row was edited', () => {
    const card = {
      displayName: 'Grok 4.8',
      id: 'grok-4.8',
      reasoning: true,
      search: true,
      settings: {
        extendParams: ['grok4_20ReasoningEffort' as const],
        searchImpl: 'params' as const,
      },
      type: 'chat' as const,
      vision: true,
    };
    Object.defineProperty(card, FAMILY_INHERITED_KEYS, {
      configurable: true,
      enumerable: true,
      value: {
        abilities: ['reasoning', 'search', 'vision'],
        settings: ['extendParams', 'searchImpl'],
      },
    });
    const existing = draftModel({
      abilities: { vision: true },
      displayName: 'Grok 4.8',
      id: 'model-1',
      modelKey: 'grok-4.8',
      settings: { searchImpl: 'internal' },
    });

    const result = mapCardsToBatchUpdate([card], [existing]);

    expect(result.items).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('familyInheritedKeys');
    expect(JSON.stringify(result)).not.toContain('grok4_20ReasoningEffort');
    expect(JSON.stringify(result)).not.toContain('searchImpl');
  });

  it('keeps an admin searchImpl when a touched row also receives a live effort list', () => {
    const card = {
      displayName: 'Grok 4.8',
      id: 'grok-4.8',
      settings: {
        extendParams: ['grok4_5ReasoningEffort' as const],
        searchImpl: 'params' as const,
      },
      type: 'chat' as const,
    };
    Object.defineProperty(card, FAMILY_INHERITED_KEYS, {
      configurable: true,
      enumerable: true,
      value: { abilities: ['reasoning'], settings: ['searchImpl'] },
    });
    const existing = draftModel({
      abilities: {},
      displayName: 'Grok 4.8',
      id: 'model-1',
      modelKey: 'grok-4.8',
      settings: { searchImpl: 'internal' },
    });

    const result = mapCardsToBatchUpdate([card], [existing]);

    expect(result.updated).toBe(1);
    expect(result.items[0]?.settings).toEqual({
      extendParams: ['grok4_5ReasoningEffort'],
      searchImpl: 'internal',
    });
  });

  it('does not overwrite settings with donor values when the marker lists no settings keys', () => {
    const card = {
      displayName: 'Grok 4.7',
      id: 'grok-4.7',
      reasoning: true,
      settings: {
        extendParams: ['grok4_20ReasoningEffort' as const],
        searchImpl: 'params' as const,
      },
      type: 'chat' as const,
      vision: true,
    };
    Object.defineProperty(card, FAMILY_INHERITED_KEYS, {
      configurable: true,
      enumerable: true,
      value: { abilities: ['reasoning', 'vision'], settings: [] },
    });
    const existing = draftModel({
      abilities: { functionCall: true },
      displayName: 'Grok 4.7',
      id: 'model-1',
      modelKey: 'grok-4.7',
      settings: { searchImpl: 'internal' },
    });

    const result = mapCardsToBatchUpdate([card], [existing]);

    expect(result.items).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('grok4_20ReasoningEffort');
    expect(JSON.stringify(result)).not.toContain('searchImpl');
  });

  it('keeps an admin ability the live payload did not report', async () => {
    const cards = await listThroughChatGPT([
      {
        displayName: 'Custom Grok',
        id: 'codex-sync-ability-fixture',
        reasoning: true,
      },
    ]);
    const existing = draftModel({
      abilities: { reasoning: false, vision: true },
      displayName: cards[0]?.displayName ?? 'codex-sync-ability-fixture',
      id: 'model-1',
      modelKey: 'codex-sync-ability-fixture',
    });

    const result = mapCardsToBatchUpdate(cards, [existing]);

    expect(result.items[0]?.abilities).toEqual({ reasoning: true, vision: true });
  });

  it('persists reasoning false for a non-reasoning id on a new or empty row', () => {
    const card = {
      displayName: 'Grok 4.7 Non Reasoning',
      id: 'grok-4.7-non-reasoning',
      reasoning: false as const,
      search: true,
      settings: { searchImpl: 'params' as const },
      type: 'chat' as const,
      vision: true,
    };
    Object.defineProperty(card, FAMILY_INHERITED_KEYS, {
      configurable: true,
      enumerable: true,
      value: {
        abilities: ['reasoning', 'search', 'vision'],
        settings: ['searchImpl'],
      },
    });

    const created = mapCardsToBatchUpdate([card], []);
    expect(created.items[0]?.abilities).toMatchObject({
      reasoning: false,
      search: true,
      vision: true,
    });
    expect(JSON.stringify(created.items[0])).not.toContain('familyInheritedKeys');

    const empty = draftModel({
      abilities: {},
      displayName: 'Grok 4.7 Non Reasoning',
      id: 'model-1',
      modelKey: 'grok-4.7-non-reasoning',
      settings: {},
    });
    const backfill = mapCardsToBatchUpdate([card], [empty]);
    expect(backfill.items[0]?.abilities).toMatchObject({ reasoning: false, search: true });
  });
});

describe('applyChatGPTWebCatalogSyncPolicy', () => {
  it('unstamps leftover family-card settings and normalises thinking/pro/none', () => {
    const existing = [
      draftModel({
        id: 'family-1',
        modelKey: 'gpt-5-6',
        settings: { extendParams: ['chatgptWebReasoningEffort'], searchImpl: 'params' },
      }),
      draftModel({
        enabled: true,
        id: 'thinking-1',
        modelKey: 'gpt-5-6-thinking',
        settings: { extendParams: ['chatgptWebReasoningEffort'] },
      }),
      draftModel({
        enabled: true,
        id: 'pro-1',
        modelKey: 'gpt-5-6-pro',
        settings: { extendParams: ['chatgptWebReasoningEffort'] },
      }),
      draftModel({
        enabled: true,
        id: 'auto-1',
        modelKey: 'auto',
        settings: { extendParams: ['gpt5_6ReasoningEffort'] },
      }),
    ];

    const mapped = mapCardsToBatchUpdate([], existing);
    const result = applyChatGPTWebCatalogSyncPolicy(existing, mapped);
    const byId = Object.fromEntries(result.items.map((item) => [item.id, item]));

    expect(byId['family-1']?.settings).toEqual({ searchImpl: 'params' });
    expect(byId['thinking-1']?.settings).toEqual({
      extendParams: ['chatgptWebThinkingEffort'],
    });
    expect(byId['pro-1']?.settings).toEqual({
      extendParams: ['chatgptWebProThinkingEffort'],
    });
    expect(byId['auto-1']?.settings).toEqual({});
  });

  it('is idempotent when settings already match the 1:1 table', () => {
    const existing = [
      draftModel({
        id: 'thinking-1',
        modelKey: 'gpt-5-6-thinking',
        settings: { extendParams: ['chatgptWebThinkingEffort'] },
      }),
      draftModel({
        id: 'pro-1',
        modelKey: 'gpt-5-6-pro',
        settings: { extendParams: ['chatgptWebProThinkingEffort'] },
      }),
    ];
    const mapped = mapCardsToBatchUpdate([], existing);
    const result = applyChatGPTWebCatalogSyncPolicy(existing, mapped);
    expect(result.items).toEqual(mapped.items);
  });
});

describe('AiCatalogAdminService.syncUpstream', () => {
  it('rejects a disconnected shared account with a typed reason', async () => {
    const service = createService();
    const created = await service.applyProviderImmediate('admin', {
      displayName: 'Grok',
      enabled: true,
      mode: 'create',
      providerKey: 'supergrok',
      reason: 'seed empty shared account',
      source: 'builtin',
    });

    await expect(service.syncUpstream('admin', { providerId: created.draft.id })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AiCatalogValidationError &&
        error.reason === 'shared_account_not_connected',
    );
    expect(mockModels).not.toHaveBeenCalled();
  });

  it('does not sync after a post-exchange refresh persistence failure', async () => {
    const actual = await vi.importActual<typeof SharedOAuthRefreshModule>('./sharedOAuthRefresh');
    mockRefreshSharedOAuthVault.mockImplementation(actual.refreshSharedOAuthVault);

    const secretService = new PlatformSecretService({ keyProvider });
    const service = new AiCatalogAdminService(db, secretService);
    const created = await service.applyProviderImmediate('admin', {
      displayName: 'Shared grok',
      enabled: true,
      mode: 'create',
      providerKey: 'supergrok',
      reason: 'seed oauth',
      secret: {
        operation: 'replace',
        value: {
          oauthAccessToken: 'at-old',
          oauthRefreshToken: 'rt-old',
          oauthTokenExpiresAt: String(Date.now() + 30_000),
        },
      },
      source: 'builtin',
    });
    mockModels.mockResolvedValue([{ displayName: 'Should not land', id: 'nope', type: 'chat' }]);

    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: 'at-new',
            expires_in: 3600,
            refresh_token: 'rt-new',
            token_type: 'bearer',
          }),
          { status: 200 },
        ),
    ) as typeof fetch;
    const encryptSpy = vi
      .spyOn(secretService, 'encrypt')
      .mockRejectedValue(new Error('kek write failed'));

    try {
      await expect(
        service.syncUpstream('admin', { providerId: created.draft.id }),
      ).rejects.toBeInstanceOf(AiCatalogUpstreamSyncError);
      expect(mockModels).not.toHaveBeenCalled();
      expect(globalThis.fetch).toHaveBeenCalled();

      const models = await db
        .select()
        .from(platformAiModels)
        .where(eq(platformAiModels.providerId, created.draft.id));
      expect(models.every((model) => model.modelKey !== 'nope')).toBe(true);
    } finally {
      encryptSpy.mockRestore();
      globalThis.fetch = realFetch;
    }
  });

  it('still lists with the stored vault when the token endpoint fails before exchange', async () => {
    const { providerId, service } = await seedProvider('sync-refresh-blip');
    mockModels.mockResolvedValue([
      { displayName: 'From stored token', id: 'listed', type: 'chat' },
    ]);
    mockRefreshSharedOAuthVault.mockRejectedValue(new Error('token endpoint 503'));

    await expect(service.syncUpstream('admin', { providerId })).resolves.toEqual({
      created: 1,
      deleted: 0,
      retained: 0,
      total: 1,
      updated: 0,
    });
    expect(mockModels).toHaveBeenCalled();
    expect(ModelRuntime.initModelRuntimeWithUserPayload).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ managedBy: 'platform' }),
    );

    const models = await db
      .select()
      .from(platformAiModels)
      .where(eq(platformAiModels.providerId, providerId));
    expect(models).toEqual([expect.objectContaining({ modelKey: 'listed' })]);
  });

  it('rolls the catalog write back when the sync audit insert fails', async () => {
    const { providerId, service } = await seedProvider('sync-audit-atomic');
    mockModels.mockResolvedValue([{ displayName: 'Brand New', id: 'brand-new', type: 'chat' }]);

    const originalAppend = PlatformAuditService.prototype.append;
    vi.spyOn(PlatformAuditService.prototype, 'append').mockImplementation(async function (
      this: PlatformAuditService,
      params,
    ) {
      if (params.action === 'admin.aiModels.syncUpstream') {
        throw new Error('audit insert failed');
      }
      return originalAppend.call(this, params);
    });

    await expect(service.syncUpstream('admin', { providerId })).rejects.toThrow(
      'audit insert failed',
    );

    const models = await db
      .select()
      .from(platformAiModels)
      .where(eq(platformAiModels.providerId, providerId));
    expect(models).toEqual([]);

    const successAudits = (await db.select().from(platformAuditLogs)).filter(
      (row) => row.action === 'admin.aiModels.syncUpstream' && row.result === 'success',
    );
    expect(successAudits).toEqual([]);
  });

  it('persists an empty abilities object when the live Codex payload turns every capability off', async () => {
    const { providerId, service } = await seedProvider('sync-abilities-clear');
    const cards = await listThroughChatGPT([
      {
        displayName: 'Custom Grok',
        id: 'codex-sync-ability-fixture',
        reasoning: false,
        search: false,
      },
    ]);
    let detail = await service.getDetail(providerId);
    await service.applyModelImmediate('admin', {
      abilities: { reasoning: true, search: true },
      displayName: cards[0]?.displayName ?? 'codex-sync-ability-fixture',
      enabled: true,
      expectedDraftToken: detail.draftToken,
      modelKey: 'codex-sync-ability-fixture',
      operation: 'create',
      providerId,
      reason: 'seed existing',
      type: 'chat',
    });

    mockModels.mockImplementation(async () => cards);

    await expect(service.syncUpstream('admin', { providerId })).resolves.toEqual({
      created: 0,
      deleted: 0,
      retained: 0,
      total: 1,
      updated: 1,
    });

    detail = await service.getDetail(providerId);
    expect(
      detail.draft.models.find((model) => model.modelKey === 'codex-sync-ability-fixture'),
    ).toMatchObject({
      abilities: {},
      enabled: true,
    });
  });

  const seedChatgptWeb = async (checkModel = 'auto') => {
    const service = createService();
    const created = await service.applyProviderImmediate('admin', {
      checkModel,
      displayName: 'ChatGPT Web',
      enabled: true,
      mode: 'create',
      providerKey: 'chatgptweb',
      reason: 'seed chatgptweb',
      secret: { operation: 'replace', value: { oauthAccessToken: 'shared-access-token' } },
      source: 'builtin',
    });
    return { providerId: created.draft.id, service };
  };

  const liveCards = [
    {
      displayName: 'GPT-5.6 (ChatGPT Web)',
      id: 'gpt-5-6',
      reasoning: false,
      settings: { searchImpl: 'params' },
      type: 'chat' as const,
    },
    {
      displayName: 'GPT-5.6 Thinking (ChatGPT Web)',
      id: 'gpt-5-6-thinking',
      reasoning: true,
      settings: { extendParams: ['chatgptWebThinkingEffort' as const] },
      type: 'chat' as const,
    },
  ];

  it('keeps a thinking SKU on the execution allowlist after sync and assigns the thinking control', async () => {
    const { providerId, service } = await seedChatgptWeb();
    mockModels.mockResolvedValue(liveCards);

    await expect(service.syncUpstream('admin', { providerId })).resolves.toMatchObject({
      created: 0,
    });

    const thinking = (await db.select().from(platformAiModels)).find(
      (row) => row.modelKey === 'gpt-5-6-thinking',
    );
    expect(thinking).toMatchObject({
      enabled: true,
      settings: expect.objectContaining({ extendParams: ['chatgptWebThinkingEffort'] }),
    });

    const execution = new AiCatalogExecutionResolver(
      db,
      new PlatformSecretService({ keyProvider }),
    );
    const config = await execution.resolveProviderExecutionConfig('chatgptweb');
    expect(config.allowedModels.map((model) => model.modelKey)).toContain('gpt-5-6-thinking');
  });

  it('does not abort sync when a published platform agent depends on a thinking SKU', async () => {
    const { providerId, service } = await seedChatgptWeb();

    const repository = new PlatformAgentCatalogRepository(db);
    const agent = await repository.createIdentity({
      agentKey: 'legacy-thinking-agent',
      isDefault: false,
      systemKey: null,
    });
    const version = await repository.appendVersionCas({
      agentId: agent.id,
      config: {
        avatar: null,
        backgroundColor: null,
        description: 'Depends on thinking SKU',
        displayName: 'Thinking dependent',
        modelParameters: {},
        openingMessage: null,
        openingQuestions: [],
        systemRole: 'Use the exact model dependency.',
        tags: [],
      },
      dependencySnapshot: {
        connectors: [],
        model: {
          modelKey: 'gpt-5-6-thinking',
          providerChecksum: 'b'.repeat(64),
          providerKey: 'chatgptweb',
          providerRevision: 1,
        },
        skills: [],
      },
      expectedDraftSequence: 0,
      expectedRevision: 0,
      version: '1.0.0',
    });
    await repository.pointToVersionCas({
      agentId: agent.id,
      expectedDraftSequence: 1,
      expectedRevision: 0,
      publishedAt: new Date(),
      versionId: version!.id,
    });

    mockModels.mockResolvedValue(liveCards);

    await expect(service.syncUpstream('admin', { providerId })).resolves.toMatchObject({
      created: 0,
    });

    const thinking = (await db.select().from(platformAiModels)).find(
      (row) => row.modelKey === 'gpt-5-6-thinking',
    );
    expect(thinking?.enabled).toBe(true);
  });
});

describe('applyCursorCatalogSyncPolicy', () => {
  const cards = [
    { displayName: 'Grok 4.6', id: 'cursor-grok-4.6', type: 'chat' as const },
    { displayName: 'Grok 4.7', id: 'grok-4.7', type: 'chat' as const },
  ];

  const legacy = [
    draftModel({
      displayName: 'Cursor Grok 4.6 High',
      enabled: true,
      id: 'v-46',
      modelKey: 'cursor-grok-4.6-high',
    }),
    draftModel({
      displayName: 'Grok 4.7 Low',
      enabled: false,
      id: 'v-low',
      modelKey: 'grok-4.7-low',
    }),
    draftModel({
      displayName: 'Grok 4.7 High',
      enabled: true,
      id: 'v-high',
      modelKey: 'grok-4.7-high',
    }),
    draftModel({
      displayName: 'Grok 4.7 Low Fast',
      enabled: false,
      id: 'v-fast',
      modelKey: 'grok-4.7-low-fast',
    }),
    draftModel({
      displayName: 'Kimi K3 High',
      enabled: true,
      id: 'v-kimi',
      modelKey: 'kimi-k3-high',
    }),
  ];

  it('enables returned bases, disables enabled variants, and deletes never-enabled variants', () => {
    const mapped = mapCardsToBatchUpdate(cards, legacy);
    const plan = applyCursorCatalogSyncPolicy(
      legacy,
      mapped,
      cards.map((card) => card.id),
    );
    const byId = Object.fromEntries(plan.items.map((item) => [item.id, item]));

    expect(byId['cursor-grok-4.6']).toMatchObject({ enabled: true });
    expect(byId['grok-4.7']).toMatchObject({ enabled: true });
    expect(byId['v-46']).toMatchObject({ enabled: false });
    expect(byId['v-high']).toMatchObject({ enabled: false });
    expect(plan.deleted).toEqual([{ id: 'v-low', modelKey: 'grok-4.7-low' }]);
    expect(plan.retained).toBe(0);
    expect(byId['v-fast']).toBeUndefined();
    expect(byId['v-kimi']).toBeUndefined();
    expect(plan.updated).toBe(mapped.updated + 2);
  });

  it('keeps variants that have blocking dependents and still enables their bases', () => {
    const mapped = mapCardsToBatchUpdate(cards, legacy);
    const plan = applyCursorCatalogSyncPolicy(
      legacy,
      mapped,
      cards.map((card) => card.id),
      new Set(['cursor-grok-4.6-high', 'grok-4.7-low']),
    );
    const byId = Object.fromEntries(plan.items.map((item) => [item.id, item]));

    expect(plan.retained).toBe(2);
    expect(plan.deleted).toEqual([]);
    expect(byId['v-46']).toBeUndefined();
    expect(byId['cursor-grok-4.6']).toMatchObject({ enabled: true });
    expect(byId['grok-4.7']).toMatchObject({ enabled: true });
    expect(byId['v-high']).toMatchObject({ enabled: false });
  });

  it('enables an existing disabled base when any legacy variant is enabled', () => {
    const existing = [
      draftModel({
        abilities: { reasoning: true },
        displayName: 'Grok 4.7',
        enabled: false,
        id: 'base-47',
        modelKey: 'grok-4.7',
        settings: { searchImpl: 'params' },
      }),
      draftModel({
        displayName: 'Grok 4.7 High',
        enabled: true,
        id: 'v-high',
        modelKey: 'grok-4.7-high',
      }),
    ];
    const baseCards = [{ displayName: 'Grok 4.7', id: 'grok-4.7', type: 'chat' as const }];
    const mapped = mapCardsToBatchUpdate(baseCards, existing);
    const plan = applyCursorCatalogSyncPolicy(existing, mapped, ['grok-4.7']);
    const byId = Object.fromEntries(plan.items.map((item) => [item.id, item]));

    expect(byId['base-47']).toMatchObject({ enabled: true });
    expect(byId['v-high']).toMatchObject({ enabled: false });
    expect(plan.deleted).toEqual([]);
  });

  it('writes cursor selector settings onto an edited gpt-5.3-codex row and retires variants', () => {
    const card = {
      displayName: 'Codex 5.3',
      files: true,
      functionCall: true,
      id: 'gpt-5.3-codex',
      reasoning: true,
      settings: {
        defaultEffortLevel: 'medium' as const,
        effortLevels: ['low', 'medium', 'high', 'xhigh'] as ('low' | 'medium' | 'high' | 'xhigh')[],
        extendParams: ['cursorReasoningEffort' as const],
      },
      type: 'chat' as const,
      vision: true,
    };
    Object.defineProperty(card, FAMILY_INHERITED_KEYS, {
      configurable: true,
      enumerable: true,
      value: {
        abilities: ['files', 'functionCall', 'reasoning', 'vision'],
        settings: [],
      },
    });
    const existing = [
      draftModel({
        abilities: { functionCall: true, search: true },
        displayName: 'Codex 5.3',
        enabled: true,
        id: 'codex',
        modelKey: 'gpt-5.3-codex',
        settings: {
          extendParams: ['gpt5_2ReasoningEffort' as const],
          searchImpl: 'internal' as const,
        },
      }),
      draftModel({
        displayName: 'Codex 5.3 Low',
        enabled: true,
        id: 'v-low',
        modelKey: 'gpt-5.3-codex-low',
      }),
      draftModel({
        displayName: 'Codex 5.3 High',
        enabled: false,
        id: 'v-high',
        modelKey: 'gpt-5.3-codex-high',
      }),
      draftModel({
        displayName: 'Codex 5.3 Extra High',
        enabled: false,
        id: 'v-xhigh',
        modelKey: 'gpt-5.3-codex-xhigh',
      }),
      draftModel({
        displayName: 'Codex 5.3 Fast',
        enabled: true,
        id: 'v-fast',
        modelKey: 'gpt-5.3-codex-fast',
      }),
    ];
    const mapped = mapCardsToBatchUpdate([card], existing);
    const plan = applyCursorCatalogSyncPolicy(existing, mapped, ['gpt-5.3-codex']);
    const byId = Object.fromEntries(plan.items.map((item) => [item.id, item]));

    expect(byId.codex?.settings).toEqual({
      defaultEffortLevel: 'medium',
      effortLevels: ['low', 'medium', 'high', 'xhigh'],
      extendParams: ['gpt5_2ReasoningEffort', 'cursorReasoningEffort'],
      searchImpl: 'internal',
    });
    expect(byId['v-low']).toMatchObject({ enabled: false });
    expect(plan.deleted).toEqual([
      { id: 'v-high', modelKey: 'gpt-5.3-codex-high' },
      { id: 'v-xhigh', modelKey: 'gpt-5.3-codex-xhigh' },
    ]);
    expect(plan.retained).toBe(0);
    expect(byId['v-fast']).toBeUndefined();
    expect(JSON.stringify(plan)).not.toContain('familyInheritedKeys');
  });
});

describe('applyProviderCatalogSyncPolicy cursor scope', () => {
  const cards = [
    { displayName: 'Grok 4.6', id: 'cursor-grok-4.6', type: 'chat' as const },
    { displayName: 'Grok 4.7', id: 'grok-4.7', type: 'chat' as const },
  ];
  const legacy = [
    draftModel({
      displayName: 'Cursor Grok 4.6 High',
      enabled: true,
      id: 'v-46',
      modelKey: 'cursor-grok-4.6-high',
    }),
    draftModel({
      displayName: 'Grok 4.7 Low',
      enabled: false,
      id: 'v-low',
      modelKey: 'grok-4.7-low',
    }),
  ];

  it('leaves a non-cursor provider unchanged', () => {
    const mapped = mapCardsToBatchUpdate(cards, legacy);
    const plan = applyProviderCatalogSyncPolicy({
      existing: legacy,
      mapped,
      providerKey: 'openai',
      returnedModelKeys: cards.map((card) => card.id),
      settings: { sdkType: 'openai' },
    });

    expect(plan.deleted).toEqual([]);
    expect(plan.items).toEqual(mapped.items);
    expect(plan.items.find((item) => item.id === 'v-46')).toBeUndefined();
    expect(plan.updated).toBe(mapped.updated);
  });

  it('matches provider key cursor and sdkType cursor', () => {
    const mapped = mapCardsToBatchUpdate(cards, legacy);
    const returnedModelKeys = cards.map((card) => card.id);
    for (const identity of [
      { providerKey: 'cursor', settings: { sdkType: 'openai' } },
      { providerKey: 'corp-cursor', settings: { sdkType: 'cursor' } },
    ]) {
      const plan = applyProviderCatalogSyncPolicy({
        existing: legacy,
        mapped,
        returnedModelKeys,
        ...identity,
      });
      expect(plan.deleted.map((row) => row.modelKey)).toEqual(['grok-4.7-low']);
      expect(plan.items.find((item) => item.id === 'v-46')).toMatchObject({ enabled: false });
    }
  });
});

describe('AiCatalogAdminService.syncUpstream cursor variants', () => {
  const collapsedCards = [
    { displayName: 'Grok 4.6', id: 'cursor-grok-4.6', type: 'chat' as const },
    { displayName: 'Grok 4.7', id: 'grok-4.7', type: 'chat' as const },
    { displayName: 'Composer 2.5', id: 'composer-2.5', type: 'chat' as const },
  ];

  const seedLegacyRows = async (providerKey: string, sdkType: string) => {
    const service = createService();
    const created = await service.applyProviderImmediate('admin', {
      displayName: providerKey,
      enabled: true,
      mode: 'create',
      providerKey,
      reason: 'seed provider',
      secret: {
        operation: 'replace',
        value:
          sdkType === 'cursor'
            ? {
                oauthAccessToken: `seed-${providerKey}`,
                oauthRefreshToken: `refresh-${providerKey}`,
              }
            : `seed-${providerKey}`,
      },
      settings: { sdkType },
      source: 'custom',
    });
    const providerId = created.draft.id;
    const detail = await service.getDetail(providerId);
    await service.applyModelImmediate('admin', {
      expectedDraftToken: detail.draftToken,
      models: [
        {
          displayName: 'Cursor Grok 4.6 High',
          enabled: true,
          id: 'cursor-grok-4.6-high',
          type: 'chat',
        },
        { displayName: 'Grok 4.7 Low', enabled: false, id: 'grok-4.7-low', type: 'chat' },
        { displayName: 'Grok 4.7 High', enabled: true, id: 'grok-4.7-high', type: 'chat' },
        {
          displayName: 'Grok 4.7 Low Fast',
          enabled: false,
          id: 'grok-4.7-low-fast',
          type: 'chat',
        },
        { displayName: 'Composer 2.5', enabled: true, id: 'composer-2.5', type: 'chat' },
        { displayName: 'Kimi K3 High', enabled: true, id: 'kimi-k3-high', type: 'chat' },
      ],
      operation: 'batchUpdate',
      providerId,
      reason: 'seed legacy cursor models',
    });
    return { providerId, service };
  };

  const rowsByKey = async (providerId: string) => {
    const rows = await db
      .select()
      .from(platformAiModels)
      .where(eq(platformAiModels.providerId, providerId));
    return new Map(rows.map((row) => [row.modelKey, row]));
  };

  it('enables collapsed bases, disables enabled variants, and deletes never-enabled ones', async () => {
    const { providerId, service } = await seedLegacyRows('corp-cursor', 'cursor');
    mockModels.mockResolvedValue(collapsedCards);

    await expect(service.syncUpstream('admin', { providerId })).resolves.toEqual({
      created: 2,
      deleted: 1,
      retained: 0,
      total: 3,
      updated: 2,
    });

    const byKey = await rowsByKey(providerId);
    expect(byKey.get('cursor-grok-4.6')).toMatchObject({ enabled: true });
    expect(byKey.get('cursor-grok-4.6-high')).toMatchObject({ enabled: false });
    expect(byKey.get('grok-4.7')).toMatchObject({ enabled: true });
    expect(byKey.get('grok-4.7-high')).toMatchObject({ enabled: false });
    expect(byKey.has('grok-4.7-low')).toBe(false);
    expect(byKey.get('grok-4.7-low-fast')).toMatchObject({ enabled: false });
    expect(byKey.get('composer-2.5')).toMatchObject({ enabled: true });
    expect(byKey.get('kimi-k3-high')).toMatchObject({ enabled: true });

    const syncAudits = (await db.select().from(platformAuditLogs)).filter(
      (row) => row.action === 'admin.aiModels.syncUpstream' && row.result === 'success',
    );
    expect(syncAudits).toHaveLength(1);
    expect(syncAudits[0]?.afterDiff).toMatchObject({
      created: 2,
      deleted: 1,
      retained: 0,
      total: 3,
      updated: 2,
    });

    const deletions = (await db.select().from(platformAuditLogs)).filter(
      (row) => row.action === 'admin.aiModels.deleteFromDraft' && row.result === 'success',
    );
    expect(deletions.map((row) => row.beforeDiff)).toEqual([
      expect.objectContaining({ modelKey: 'grok-4.7-low', providerId }),
    ]);
  });

  it('keeps a pinned legacy variant enabled and does not roll the sync back', async () => {
    const { providerId, service } = await seedLegacyRows('corp-cursor', 'cursor');
    const repository = new PlatformAgentCatalogRepository(db);
    const agent = await repository.createIdentity({
      agentKey: 'cursor-pinned-variant',
      isDefault: false,
      systemKey: null,
    });
    const version = await repository.appendVersionCas({
      agentId: agent.id,
      config: {
        avatar: null,
        backgroundColor: null,
        description: 'Pins a legacy cursor id',
        displayName: 'Pinned variant',
        modelParameters: {},
        openingMessage: null,
        openingQuestions: [],
        systemRole: 'Use the pinned model.',
        tags: [],
      },
      dependencySnapshot: {
        connectors: [],
        model: {
          modelKey: 'cursor-grok-4.6-high',
          providerChecksum: 'c'.repeat(64),
          providerKey: 'corp-cursor',
          providerRevision: 1,
        },
        skills: [],
      },
      expectedDraftSequence: 0,
      expectedRevision: 0,
      version: '1.0.0',
    });
    await repository.pointToVersionCas({
      agentId: agent.id,
      expectedDraftSequence: 1,
      expectedRevision: 0,
      publishedAt: new Date(),
      versionId: version!.id,
    });

    mockModels.mockResolvedValue(collapsedCards);

    await expect(service.syncUpstream('admin', { providerId })).resolves.toEqual({
      created: 2,
      deleted: 1,
      retained: 1,
      total: 3,
      updated: 1,
    });

    const byKey = await rowsByKey(providerId);
    expect(byKey.get('cursor-grok-4.6')).toMatchObject({ enabled: true });
    expect(byKey.get('cursor-grok-4.6-high')).toMatchObject({ enabled: true });
    expect(byKey.get('grok-4.7')).toMatchObject({ enabled: true });
    expect(byKey.get('grok-4.7-high')).toMatchObject({ enabled: false });
    expect(byKey.has('grok-4.7-low')).toBe(false);
  });

  it('does not retire legacy rows on a non-cursor provider', async () => {
    const { providerId, service } = await seedLegacyRows('corp-openai', 'openai');
    mockModels.mockResolvedValue(collapsedCards);

    await expect(service.syncUpstream('admin', { providerId })).resolves.toEqual({
      created: 2,
      deleted: 0,
      retained: 0,
      total: 3,
      updated: 0,
    });

    const byKey = await rowsByKey(providerId);
    expect(byKey.get('cursor-grok-4.6')).toMatchObject({ enabled: false });
    expect(byKey.get('cursor-grok-4.6-high')).toMatchObject({ enabled: true });
    expect(byKey.get('grok-4.7')).toMatchObject({ enabled: false });
    expect(byKey.get('grok-4.7-high')).toMatchObject({ enabled: true });
    expect(byKey.get('grok-4.7-low')).toMatchObject({ enabled: false });
    expect(byKey.get('grok-4.7-low-fast')).toMatchObject({ enabled: false });
    expect(byKey.get('kimi-k3-high')).toMatchObject({ enabled: true });

    const syncAudit = (await db.select().from(platformAuditLogs)).find(
      (row) => row.action === 'admin.aiModels.syncUpstream' && row.result === 'success',
    );
    expect(syncAudit?.afterDiff).toMatchObject({ deleted: 0 });
  });

  it('persists selector settings on an edited gpt-5.3-codex row and retires its variants', async () => {
    const service = createService();
    const created = await service.applyProviderImmediate('admin', {
      displayName: 'codex-cursor',
      enabled: true,
      mode: 'create',
      providerKey: 'codex-cursor',
      reason: 'seed provider',
      secret: {
        operation: 'replace',
        value: { oauthAccessToken: 'seed-codex-cursor', oauthRefreshToken: 'refresh-codex' },
      },
      settings: { sdkType: 'cursor' },
      source: 'custom',
    });
    const providerId = created.draft.id;
    const detail = await service.getDetail(providerId);
    await service.applyModelImmediate('admin', {
      expectedDraftToken: detail.draftToken,
      models: [
        {
          abilities: { functionCall: true, search: true },
          displayName: 'Codex 5.3',
          enabled: true,
          id: 'gpt-5.3-codex',
          settings: { searchImpl: 'internal' },
          type: 'chat',
        },
        {
          displayName: 'Codex 5.3 Low',
          enabled: true,
          id: 'gpt-5.3-codex-low',
          type: 'chat',
        },
        {
          displayName: 'Codex 5.3 High',
          enabled: false,
          id: 'gpt-5.3-codex-high',
          type: 'chat',
        },
        {
          displayName: 'Codex 5.3 Fast',
          enabled: true,
          id: 'gpt-5.3-codex-fast',
          type: 'chat',
        },
      ],
      operation: 'batchUpdate',
      providerId,
      reason: 'seed edited codex row',
    });

    const card = {
      displayName: 'Codex 5.3',
      files: true,
      functionCall: true,
      id: 'gpt-5.3-codex',
      reasoning: true,
      settings: {
        defaultEffortLevel: 'medium',
        effortLevels: ['low', 'medium', 'high', 'xhigh'],
        extendParams: ['cursorReasoningEffort'],
      },
      type: 'chat' as const,
      vision: true,
    };
    Object.defineProperty(card, FAMILY_INHERITED_KEYS, {
      configurable: true,
      enumerable: true,
      value: {
        abilities: ['files', 'functionCall', 'reasoning', 'vision'],
        settings: [],
      },
    });
    mockModels.mockResolvedValue([card]);

    await expect(service.syncUpstream('admin', { providerId })).resolves.toMatchObject({
      deleted: 1,
      retained: 0,
    });

    const byKey = await rowsByKey(providerId);
    expect(byKey.get('gpt-5.3-codex')?.settings).toMatchObject({
      defaultEffortLevel: 'medium',
      effortLevels: ['low', 'medium', 'high', 'xhigh'],
      extendParams: ['cursorReasoningEffort'],
      searchImpl: 'internal',
    });
    expect(byKey.get('gpt-5.3-codex')?.abilities).toMatchObject({
      functionCall: true,
      search: true,
    });
    expect(byKey.get('gpt-5.3-codex-low')?.enabled).toBe(false);
    expect(byKey.has('gpt-5.3-codex-high')).toBe(false);
    expect(byKey.get('gpt-5.3-codex-fast')?.enabled).toBe(true);
  });

  it('counts only variants that are actually blocked when a pin appears during sync', async () => {
    const { providerId, service } = await seedLegacyRows('retry-cursor', 'cursor');
    let precheck = true;
    dependentOverride.current = async (_db, _providerKey, modelKeys) => {
      if (precheck) {
        precheck = false;
        return [];
      }
      if (modelKeys.includes('cursor-grok-4.6-high')) {
        return [
          {
            blocking: true,
            label: 'Pinned variant',
            resourceId: 'agent-pin',
            resourceType: 'agent',
          },
        ];
      }
      return [];
    };
    mockModels.mockResolvedValue(collapsedCards);

    try {
      await expect(service.syncUpstream('admin', { providerId })).resolves.toEqual({
        created: 2,
        deleted: 1,
        retained: 1,
        total: 3,
        updated: 1,
      });
    } finally {
      dependentOverride.current = null;
    }

    const byKey = await rowsByKey(providerId);
    expect(byKey.get('cursor-grok-4.6-high')?.enabled).toBe(true);
    expect(byKey.get('grok-4.7-high')?.enabled).toBe(false);
    expect(byKey.has('grok-4.7-low')).toBe(false);
    expect(byKey.get('cursor-grok-4.6')?.enabled).toBe(true);
    expect(byKey.get('grok-4.7')?.enabled).toBe(true);

    const syncAudit = (await db.select().from(platformAuditLogs)).find(
      (row) => row.action === 'admin.aiModels.syncUpstream' && row.result === 'success',
    );
    expect(syncAudit?.afterDiff).toMatchObject({ deleted: 1, retained: 1 });
  });
});
