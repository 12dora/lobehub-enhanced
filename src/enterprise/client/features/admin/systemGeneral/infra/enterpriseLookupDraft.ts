import type {
  AdminSystemEnterpriseLookupProbeResult,
  AdminSystemEnterpriseLookupSettings,
  AdminSystemUpdateEnterpriseLookupSettingsInput,
} from '@/enterprise/client/services/adminSystem';
import {
  ENTERPRISE_LOOKUP_DAILY_LIMIT_MAX,
  ENTERPRISE_LOOKUP_PROVIDERS,
  type EnterpriseLookupProvider,
  QCC_CATEGORIES,
  type QccCategory,
} from '@/types/platform/enterpriseLookup';

import { deriveSecretAction, type InfraSecretDraft, secretMissing, settleSecret } from './draft';

/** Same ceiling as every other infrastructure credential (`enterpriseLookupSecretActionSchema`). */
const MAX_API_KEY_LENGTH = 512;

/**
 * Editable form state.
 *
 * The two providers are flattened rather than nested so `patch` stays a shallow merge, and the
 * daily limit lives as free text so a half-typed number never round-trips through `Number()`.
 */
export interface EnterpriseLookupDraft {
  dailyLimitPerUser: string;
  defaultProvider: EnterpriseLookupProvider;
  fallbackEnabled: boolean;
  qccApiKey: InfraSecretDraft;
  qccCategories: QccCategory[];
  qccEnabled: boolean;
  tianyanchaApiKey: InfraSecretDraft;
  tianyanchaEnabled: boolean;
}

const emptySecret = (stored: boolean): InfraSecretDraft => ({ cleared: false, stored, value: '' });

/**
 * Seed the form from the server snapshot.
 *
 * Unlike 对象存储 and 邮件服务 this row has no environment fallback — it exists only when an admin
 * created it — so a stored key always belongs to the configuration being edited and `keep` is
 * always meaningful.
 */
export const toEnterpriseLookupDraft = (
  view: AdminSystemEnterpriseLookupSettings,
): EnterpriseLookupDraft => ({
  dailyLimitPerUser: String(view.config.dailyLimitPerUser),
  defaultProvider: view.config.defaultProvider,
  fallbackEnabled: view.config.fallbackEnabled,
  qccApiKey: emptySecret(view.config.qcc.apiKeyStored),
  // Ordered by the canonical list so a reordered server answer is not read as an edit.
  qccCategories: QCC_CATEGORIES.filter((category) => view.config.qcc.categories.includes(category)),
  qccEnabled: view.config.qcc.enabled,
  tianyanchaApiKey: emptySecret(view.config.tianyancha.apiKeyStored),
  tianyanchaEnabled: view.config.tianyancha.enabled,
});

const secretFingerprint = (secret: InfraSecretDraft): string =>
  `${secret.stored ? '1' : '0'}${secret.cleared ? 'c' : '-'}${secret.value.length > 0 ? 'v' : '-'}`;

export const fingerprintEnterpriseLookupDraft = (draft: EnterpriseLookupDraft): string =>
  [
    draft.defaultProvider,
    draft.fallbackEnabled ? '1' : '0',
    draft.dailyLimitPerUser.trim(),
    draft.qccEnabled ? '1' : '0',
    draft.qccCategories.join(','),
    secretFingerprint(draft.qccApiKey),
    draft.tianyanchaEnabled ? '1' : '0',
    secretFingerprint(draft.tianyanchaApiKey),
  ].join('|');

export const enterpriseLookupProviderEnabled = (
  draft: EnterpriseLookupDraft,
  provider: EnterpriseLookupProvider,
): boolean => (provider === 'qcc' ? draft.qccEnabled : draft.tianyanchaEnabled);

export const enterpriseLookupProviderSecret = (
  draft: EnterpriseLookupDraft,
  provider: EnterpriseLookupProvider,
): InfraSecretDraft => (provider === 'qcc' ? draft.qccApiKey : draft.tianyanchaApiKey);

/**
 * Providers the 默认供应商 select may offer.
 *
 * Only enabled ones: picking a default the platform will not call is a setting that silently does
 * nothing, and the server rejects it anyway.
 */
export const enterpriseLookupDefaultProviderOptions = (
  draft: EnterpriseLookupDraft,
): readonly EnterpriseLookupProvider[] =>
  ENTERPRISE_LOOKUP_PROVIDERS.filter((provider) =>
    enterpriseLookupProviderEnabled(draft, provider),
  );

export const parseEnterpriseLookupDailyLimit = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return parsed <= ENTERPRISE_LOOKUP_DAILY_LIMIT_MAX ? parsed : undefined;
};

/**
 * Mirrors the `superRefine` rules of `adminSystemEnterpriseLookupConfigSchema` by hand, exactly as
 * `draft.ts` mirrors the infra schemas: a normal input must never reach a server-only rejection
 * (the lambda tRPC formatter does not expose Zod issues, so a rejection has nowhere to land).
 *
 * Field name → `systemGeneral.enterpriseLookup.errors.*` key suffix; an empty object means "safe
 * to submit".
 */
export const validateEnterpriseLookupDraft = (
  draft: EnterpriseLookupDraft,
): Record<string, string> => {
  const errors: Record<string, string> = {};

  for (const provider of ENTERPRISE_LOOKUP_PROVIDERS) {
    if (!enterpriseLookupProviderEnabled(draft, provider)) continue;
    const field = provider === 'qcc' ? 'qccApiKey' : 'tianyanchaApiKey';
    const secret = enterpriseLookupProviderSecret(draft, provider);
    // An enabled provider needs a key the server can actually send: a stored one, or a new one.
    if (secretMissing(secret)) errors[field] = 'secretRequired';
    else if (secret.value.length > MAX_API_KEY_LENGTH) errors[field] = 'secretTooLong';
  }

  // An enabled 企查查 with no category reaches no endpoint at all — the switch would lie.
  if (draft.qccEnabled && draft.qccCategories.length === 0) {
    errors.qccCategories = 'categoryRequired';
  }

  const enabled = enterpriseLookupDefaultProviderOptions(draft);
  if (enabled.length > 0 && !enabled.includes(draft.defaultProvider)) {
    errors.defaultProvider = 'defaultProvider';
  }

  if (parseEnterpriseLookupDailyLimit(draft.dailyLimitPerUser) === undefined) {
    errors.dailyLimitPerUser = 'dailyLimit';
  }

  return errors;
};

/**
 * `defaultProvider` follows the switches.
 *
 * Turning the current default off would otherwise leave a stored default the server refuses; the
 * form moves it to the provider that is still on rather than making the operator notice.
 */
export const reconcileEnterpriseLookupDefaultProvider = (
  draft: EnterpriseLookupDraft,
): EnterpriseLookupDraft => {
  const enabled = enterpriseLookupDefaultProviderOptions(draft);
  if (enabled.length === 0 || enabled.includes(draft.defaultProvider)) return draft;
  return { ...draft, defaultProvider: enabled[0]! };
};

export const toEnterpriseLookupConfig = (
  draft: EnterpriseLookupDraft,
): AdminSystemUpdateEnterpriseLookupSettingsInput['config'] => ({
  dailyLimitPerUser: parseEnterpriseLookupDailyLimit(draft.dailyLimitPerUser) ?? 0,
  defaultProvider: draft.defaultProvider,
  fallbackEnabled: draft.fallbackEnabled,
  qcc: {
    apiKey: deriveSecretAction(draft.qccApiKey),
    categories: QCC_CATEGORIES.filter((category) => draft.qccCategories.includes(category)),
    enabled: draft.qccEnabled,
  },
  tianyancha: {
    apiKey: deriveSecretAction(draft.tianyanchaApiKey),
    enabled: draft.tianyanchaEnabled,
  },
});

export const toEnterpriseLookupUpdateInput = (
  draft: EnterpriseLookupDraft,
  expectedRevision: number,
): AdminSystemUpdateEnterpriseLookupSettingsInput => ({
  config: toEnterpriseLookupConfig(draft),
  expectedRevision,
});

/** Drop the plaintext keys and re-derive "stored" from what the accepted write left behind. */
export const settleEnterpriseLookupDraft = (
  draft: EnterpriseLookupDraft,
): EnterpriseLookupDraft => ({
  ...draft,
  qccApiKey: settleSecret(draft.qccApiKey),
  tianyanchaApiKey: settleSecret(draft.tianyanchaApiKey),
});

/** superjson hands back a `Date`; a hand-rolled fixture may still carry the ISO string. */
export const formatEnterpriseLookupTime = (value: Date | string | null): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
};

/**
 * Probe outcome → `systemGeneral.enterpriseLookup.test.*` key suffix.
 *
 * Every reason gets its own short sentence: "failed" alone leaves an admin guessing between a typo
 * in the key, a blocked egress route and an exhausted quota, which are three different next steps.
 */
export const resolveEnterpriseLookupProbeKey = (
  probe: AdminSystemEnterpriseLookupProbeResult,
): string => {
  if (probe.ok) return 'systemGeneral.enterpriseLookup.test.success';
  switch (probe.reason) {
    case 'not_configured': {
      return 'systemGeneral.enterpriseLookup.test.reason.notConfigured';
    }
    case 'quota_exceeded': {
      return 'systemGeneral.enterpriseLookup.test.reason.quotaExceeded';
    }
    case 'timeout': {
      return 'systemGeneral.enterpriseLookup.test.reason.timeout';
    }
    case 'unauthorized': {
      return 'systemGeneral.enterpriseLookup.test.reason.unauthorized';
    }
    default: {
      // An unnamed reason is still a connection that did not happen.
      return 'systemGeneral.enterpriseLookup.test.reason.unreachable';
    }
  }
};
