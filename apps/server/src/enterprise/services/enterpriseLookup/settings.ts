import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { getServerDB } from '@/database/core/db-adaptor';
import { PlatformRevisionConflictError } from '@/database/models/platform/errors';
import { inTransaction } from '@/database/repositories/platform/tx';
import {
  INFRA_SETTINGS_ENTERPRISE_LOOKUP_ID,
  platformInfraSettings,
} from '@/database/schemas/platform/infraSettings';
import type { LobeChatDatabase, Transaction } from '@/database/type';
import type {
  AdminSystemGetEnterpriseLookupSettings,
  AdminSystemTestEnterpriseLookupProviderInput,
  AdminSystemTestEnterpriseLookupProviderOutput,
  AdminSystemUpdateEnterpriseLookupSettingsInput,
} from '@/server/enterprise/contracts/adminSystem/enterpriseLookup';
import type {
  EnterpriseLookupPersistedConfig,
  EnterpriseLookupProvider,
  EnterpriseLookupRuntimeConfig,
  EnterpriseLookupSecretAction,
  QccCategory,
} from '@/types/platform/enterpriseLookup';
import {
  createDefaultEnterpriseLookupConfig,
  normalizeEnterpriseLookupConfig,
  QCC_DEFAULT_CATEGORIES,
} from '@/types/platform/enterpriseLookup';

import { InfraSettingsSecretRequiredError } from '../infraSettings/errors';
import { resolveInfraSecretCiphertext } from '../infraSettings/resolveSecretAction';
import { openInfraSecret, sealInfraSecret } from '../infraSettings/secrets';
import { clearEnterpriseLookupUnhealthy, noteEnterpriseLookupConfigured } from './health';
import { invalidateEnterpriseLookupToolsCache, probeProvider } from './mcpClient';

const RUNTIME_CACHE_TTL_MS = 30_000;

type EnterpriseLookupSettingsRow = {
  config: EnterpriseLookupPersistedConfig;
  revision: number;
  updatedAt: Date | null;
};

type RuntimeCache = {
  expiresAt: number;
  value: EnterpriseLookupRuntimeConfig | null;
};

let runtimeCache: RuntimeCache | null = null;
let runtimeGeneration = 0;
let runtimeInflight: Promise<EnterpriseLookupRuntimeConfig | null> | null = null;

export const fingerprintEnterpriseLookupApiKey = (secret: string): string =>
  `sha256:${createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 8)}`;

const cloneRuntimeConfig = (
  value: EnterpriseLookupRuntimeConfig | null,
): EnterpriseLookupRuntimeConfig | null => {
  if (!value) return null;
  return {
    dailyLimitPerUser: value.dailyLimitPerUser,
    defaultProvider: value.defaultProvider,
    fallbackEnabled: value.fallbackEnabled,
    ...(value.qcc
      ? { qcc: { apiKey: value.qcc.apiKey, categories: [...value.qcc.categories] } }
      : {}),
    ...(value.tianyancha ? { tianyancha: { apiKey: value.tianyancha.apiKey } } : {}),
  };
};

const uniqueCategories = (categories: QccCategory[]): QccCategory[] => [...new Set(categories)];

const isConfigured = (config: EnterpriseLookupPersistedConfig): boolean =>
  (config.qcc.enabled && Boolean(config.qcc.apiKeyCiphertext)) ||
  (config.tianyancha.enabled && Boolean(config.tianyancha.apiKeyCiphertext));

const toRow = (row: {
  config: unknown;
  revision: number;
  updatedAt: Date | null;
}): EnterpriseLookupSettingsRow => ({
  config: normalizeEnterpriseLookupConfig(row.config),
  revision: row.revision,
  updatedAt: row.updatedAt,
});

const resolveProviderSecret = async (params: {
  action: EnterpriseLookupSecretAction | undefined;
  field: string;
  required: boolean;
  storedCiphertext: string | undefined;
  storedFingerprint: string | undefined;
}): Promise<{ apiKeyCiphertext?: string; apiKeyFingerprint?: string }> => {
  const action = params.action ?? { action: 'keep' as const };
  if (action.action === 'replace') {
    const apiKeyCiphertext = await sealInfraSecret(action.value);
    return {
      apiKeyCiphertext,
      apiKeyFingerprint: fingerprintEnterpriseLookupApiKey(action.value),
    };
  }

  const apiKeyCiphertext = await resolveInfraSecretCiphertext({
    action,
    field: params.field,
    storedCiphertext: params.storedCiphertext,
  });
  if (params.required && !apiKeyCiphertext) {
    throw new InfraSettingsSecretRequiredError(params.field);
  }
  if (!apiKeyCiphertext) return {};
  return {
    apiKeyCiphertext,
    ...(params.storedFingerprint ? { apiKeyFingerprint: params.storedFingerprint } : {}),
  };
};

export const applyEnterpriseLookupUpdate = async (
  current: EnterpriseLookupPersistedConfig | undefined,
  update: AdminSystemUpdateEnterpriseLookupSettingsInput['config'],
): Promise<EnterpriseLookupPersistedConfig> => {
  const stored = current ?? createDefaultEnterpriseLookupConfig();
  const qccSecret = await resolveProviderSecret({
    action: update.qcc.apiKey,
    field: 'qcc.apiKey',
    required: update.qcc.enabled,
    storedCiphertext: stored.qcc.apiKeyCiphertext,
    storedFingerprint: stored.qcc.apiKeyFingerprint,
  });
  const tianyanchaSecret = await resolveProviderSecret({
    action: update.tianyancha.apiKey,
    field: 'tianyancha.apiKey',
    required: update.tianyancha.enabled,
    storedCiphertext: stored.tianyancha.apiKeyCiphertext,
    storedFingerprint: stored.tianyancha.apiKeyFingerprint,
  });

  const categories = uniqueCategories(
    update.qcc.categories ?? stored.qcc.categories ?? QCC_DEFAULT_CATEGORIES,
  );

  return {
    dailyLimitPerUser: update.dailyLimitPerUser,
    defaultProvider: update.defaultProvider,
    fallbackEnabled: update.fallbackEnabled,
    qcc: {
      categories: categories.length > 0 ? categories : [...QCC_DEFAULT_CATEGORIES],
      enabled: update.qcc.enabled,
      ...qccSecret,
    },
    tianyancha: {
      enabled: update.tianyancha.enabled,
      ...tianyanchaSecret,
    },
  };
};

export const toEnterpriseLookupView = (
  config: EnterpriseLookupPersistedConfig,
): AdminSystemGetEnterpriseLookupSettings['config'] => ({
  dailyLimitPerUser: config.dailyLimitPerUser,
  defaultProvider: config.defaultProvider,
  fallbackEnabled: config.fallbackEnabled,
  qcc: {
    apiKeyStored: Boolean(config.qcc.apiKeyCiphertext),
    categories: [...config.qcc.categories],
    enabled: config.qcc.enabled,
    ...(config.qcc.apiKeyFingerprint ? { apiKeyFingerprint: config.qcc.apiKeyFingerprint } : {}),
  },
  tianyancha: {
    apiKeyStored: Boolean(config.tianyancha.apiKeyCiphertext),
    enabled: config.tianyancha.enabled,
    ...(config.tianyancha.apiKeyFingerprint
      ? { apiKeyFingerprint: config.tianyancha.apiKeyFingerprint }
      : {}),
  },
});

export const toEnterpriseLookupSettingsOutput = (
  row: EnterpriseLookupSettingsRow,
): AdminSystemGetEnterpriseLookupSettings => ({
  config: toEnterpriseLookupView(row.config),
  revision: row.revision,
  status: isConfigured(row.config) ? 'configured' : 'not_configured',
  updatedAt: row.updatedAt,
});

export const enterpriseLookupSecretChanged = (
  previous: EnterpriseLookupPersistedConfig | undefined,
  next: EnterpriseLookupPersistedConfig,
): { qcc: boolean; tianyancha: boolean } => ({
  qcc: previous?.qcc.apiKeyCiphertext !== next.qcc.apiKeyCiphertext,
  tianyancha: previous?.tianyancha.apiKeyCiphertext !== next.tianyancha.apiKeyCiphertext,
});

/** Redacted audit afterDiff — never includes plaintext, ciphertext, or fingerprints. */
export const summarizeEnterpriseLookupAfterDiff = (
  config: EnterpriseLookupPersistedConfig,
  secretChanged: { qcc: boolean; tianyancha: boolean },
) => ({
  dailyLimitPerUser: config.dailyLimitPerUser,
  defaultProvider: config.defaultProvider,
  fallbackEnabled: config.fallbackEnabled,
  qccCategories: config.qcc.categories,
  qccEnabled: config.qcc.enabled,
  qccSecretChanged: secretChanged.qcc,
  tianyanchaEnabled: config.tianyancha.enabled,
  tianyanchaSecretChanged: secretChanged.tianyancha,
});

const loadPersistedRow = async (
  db: LobeChatDatabase | Transaction,
): Promise<EnterpriseLookupSettingsRow> => {
  const [existing] = await db
    .select()
    .from(platformInfraSettings)
    .where(eq(platformInfraSettings.id, INFRA_SETTINGS_ENTERPRISE_LOOKUP_ID))
    .limit(1);
  if (existing) return toRow(existing);

  const [inserted] = await db
    .insert(platformInfraSettings)
    .values({
      config: createDefaultEnterpriseLookupConfig(),
      id: INFRA_SETTINGS_ENTERPRISE_LOOKUP_ID,
      revision: 0,
    })
    .onConflictDoNothing({ target: platformInfraSettings.id })
    .returning();
  if (inserted) return toRow(inserted);

  const [raced] = await db
    .select()
    .from(platformInfraSettings)
    .where(eq(platformInfraSettings.id, INFRA_SETTINGS_ENTERPRISE_LOOKUP_ID))
    .limit(1);
  if (!raced) {
    throw new Error('Failed to ensure default enterprise-lookup settings');
  }
  return toRow(raced);
};

const persistEnterpriseLookupConfig = async (
  db: LobeChatDatabase | Transaction,
  input: {
    config: EnterpriseLookupPersistedConfig;
    expectedRevision: number;
    updatedBy: string;
  },
): Promise<EnterpriseLookupSettingsRow> =>
  inTransaction(db, async (tx) => {
    const [locked] = await tx
      .select()
      .from(platformInfraSettings)
      .where(eq(platformInfraSettings.id, INFRA_SETTINGS_ENTERPRISE_LOOKUP_ID))
      .limit(1)
      .for('update');

    const currentRevision = locked?.revision ?? 0;
    if (currentRevision !== input.expectedRevision) {
      throw new PlatformRevisionConflictError(
        'Infra settings revision conflict: expectedRevision does not match current revision',
        {
          currentRevision,
          expectedRevision: input.expectedRevision,
          resourceId: INFRA_SETTINGS_ENTERPRISE_LOOKUP_ID,
          resourceType: 'infra_settings',
        },
      );
    }

    const nextRevision = currentRevision + 1;
    const config = normalizeEnterpriseLookupConfig(input.config);

    if (!locked) {
      const [inserted] = await tx
        .insert(platformInfraSettings)
        .values({
          config,
          id: INFRA_SETTINGS_ENTERPRISE_LOOKUP_ID,
          revision: nextRevision,
          updatedBy: input.updatedBy,
        })
        .onConflictDoNothing({ target: platformInfraSettings.id })
        .returning();
      if (!inserted) {
        throw new PlatformRevisionConflictError(
          'Infra settings revision conflict: concurrent first-write',
          {
            expectedRevision: input.expectedRevision,
            resourceId: INFRA_SETTINGS_ENTERPRISE_LOOKUP_ID,
            resourceType: 'infra_settings',
          },
        );
      }
      return toRow(inserted);
    }

    const [updated] = await tx
      .update(platformInfraSettings)
      .set({
        config,
        revision: nextRevision,
        updatedAt: new Date(),
        updatedBy: input.updatedBy,
      })
      .where(
        and(
          eq(platformInfraSettings.id, INFRA_SETTINGS_ENTERPRISE_LOOKUP_ID),
          eq(platformInfraSettings.revision, input.expectedRevision),
        ),
      )
      .returning();

    if (!updated) {
      throw new PlatformRevisionConflictError(
        'Infra settings revision conflict: expectedRevision does not match current revision',
        {
          currentRevision,
          expectedRevision: input.expectedRevision,
          resourceId: INFRA_SETTINGS_ENTERPRISE_LOOKUP_ID,
          resourceType: 'infra_settings',
        },
      );
    }
    return toRow(updated);
  });

const openProviderKey = async (ciphertext: string | undefined): Promise<string | undefined> => {
  if (!ciphertext) return undefined;
  try {
    const plain = await openInfraSecret(ciphertext);
    return plain.trim().length > 0 ? plain : undefined;
  } catch (error) {
    console.error('[enterpriseLookup] failed to open provider secret', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    return undefined;
  }
};

const toRuntimeConfig = async (
  config: EnterpriseLookupPersistedConfig,
): Promise<EnterpriseLookupRuntimeConfig | null> => {
  const qccKey = config.qcc.enabled
    ? await openProviderKey(config.qcc.apiKeyCiphertext)
    : undefined;
  const tianyanchaKey = config.tianyancha.enabled
    ? await openProviderKey(config.tianyancha.apiKeyCiphertext)
    : undefined;

  if (!qccKey && !tianyanchaKey) return null;

  const runtime: EnterpriseLookupRuntimeConfig = {
    dailyLimitPerUser: config.dailyLimitPerUser,
    defaultProvider: config.defaultProvider,
    fallbackEnabled: config.fallbackEnabled,
  };
  if (qccKey) runtime.qcc = { apiKey: qccKey, categories: [...config.qcc.categories] };
  if (tianyanchaKey) runtime.tianyancha = { apiKey: tianyanchaKey };
  return runtime;
};

const loadRuntimeConfig = async (): Promise<EnterpriseLookupRuntimeConfig | null> => {
  const db = await getServerDB();
  const row = await loadPersistedRow(db);
  return toRuntimeConfig(row.config);
};

export const invalidateEnterpriseLookupRuntimeConfig = (): void => {
  runtimeCache = null;
  runtimeInflight = null;
  runtimeGeneration += 1;
  clearEnterpriseLookupUnhealthy();
  invalidateEnterpriseLookupToolsCache();
};

export const getEnterpriseLookupRuntimeConfig =
  async (): Promise<EnterpriseLookupRuntimeConfig | null> => {
    const now = Date.now();
    if (runtimeCache && runtimeCache.expiresAt > now) {
      return cloneRuntimeConfig(runtimeCache.value);
    }
    if (runtimeInflight) return cloneRuntimeConfig(await runtimeInflight);

    const generation = runtimeGeneration;
    runtimeInflight = loadRuntimeConfig()
      .then((value) => {
        if (generation === runtimeGeneration) {
          runtimeCache = { expiresAt: Date.now() + RUNTIME_CACHE_TTL_MS, value };
        }
        return value;
      })
      .finally(() => {
        if (generation === runtimeGeneration) runtimeInflight = null;
      });
    return cloneRuntimeConfig(await runtimeInflight);
  };

const storedKeyForProvider = (
  config: EnterpriseLookupPersistedConfig,
  provider: EnterpriseLookupProvider,
): string | undefined =>
  provider === 'qcc' ? config.qcc.apiKeyCiphertext : config.tianyancha.apiKeyCiphertext;

export const testEnterpriseLookupProvider = async (
  db: LobeChatDatabase | Transaction,
  input: AdminSystemTestEnterpriseLookupProviderInput,
): Promise<AdminSystemTestEnterpriseLookupProviderOutput> => {
  let apiKey = input.draft?.apiKey;

  if (!apiKey) {
    const row = await loadPersistedRow(db);
    apiKey = await openProviderKey(storedKeyForProvider(row.config, input.provider));
  }

  if (!apiKey) return { ok: false, reason: 'not_configured' };

  try {
    const result = await probeProvider(input.provider, apiKey);
    if (result.ok) {
      return {
        ok: true,
        ...(typeof result.toolCount === 'number' ? { toolCount: result.toolCount } : {}),
      };
    }
    return {
      ok: false,
      ...(result.reason ? { reason: result.reason } : { reason: 'unreachable' }),
    };
  } catch (error) {
    console.error('[enterpriseLookup] provider probe failed', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
      provider: input.provider,
    });
    return { ok: false, reason: 'unreachable' };
  }
};

export class EnterpriseLookupSettingsService {
  constructor(private readonly db: LobeChatDatabase | Transaction) {}

  get = async (): Promise<AdminSystemGetEnterpriseLookupSettings> => {
    const row = await loadPersistedRow(this.db);
    return toEnterpriseLookupSettingsOutput(row);
  };

  update = async (input: {
    config: AdminSystemUpdateEnterpriseLookupSettingsInput['config'];
    expectedRevision: number;
    updatedBy: string;
  }): Promise<{
    previous: EnterpriseLookupPersistedConfig;
    row: EnterpriseLookupSettingsRow;
    view: AdminSystemGetEnterpriseLookupSettings;
  }> => {
    const current = await loadPersistedRow(this.db);
    const config = await applyEnterpriseLookupUpdate(current.config, input.config);
    const row = await persistEnterpriseLookupConfig(this.db, {
      config,
      expectedRevision: input.expectedRevision,
      updatedBy: input.updatedBy,
    });
    noteEnterpriseLookupConfigured(isConfigured(row.config));
    return {
      previous: current.config,
      row,
      view: toEnterpriseLookupSettingsOutput(row),
    };
  };
}
