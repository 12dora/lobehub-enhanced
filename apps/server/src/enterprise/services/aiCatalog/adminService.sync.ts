import type { ChatModelCard } from 'model-bank';
import { isProviderOAuthDeviceFlow } from 'model-bank/modelProviders';

import { PlatformAiCatalogRepository } from '@/database/repositories/platformAiCatalog';
import type { PlatformAiProviderSettings } from '@/database/schemas/platform';
import type { LobeChatDatabase, Transaction } from '@/database/type';
import {
  buildPayloadFromKeyVaults,
  initModelRuntimeWithUserPayload,
  resolvePlatformBrowserProfile,
} from '@/server/modules/ModelRuntime';

import { PlatformAuditService } from '../platformAudit';
import { AiCatalogAdminServiceModelOps } from './adminService.models';
import {
  applyProviderCatalogSyncPolicy,
  cursorRetirementModelKeys,
  isCursorCatalogProvider,
  mapCardsToBatchUpdate,
} from './adminService.sync.mapping';
import { aiConnectionFailureCode, classifyAiConnectionFailure } from './connectionTestService';
import { normalizeAiCatalogExecutionCredentials } from './credentialAdapter';
import { resolveAiCatalogDependentsForModels } from './dependencies';
import {
  AiCatalogCannotEnumerateError,
  AiCatalogNotFoundError,
  AiCatalogResourceInUseError,
  AiCatalogUpstreamSyncError,
  AiCatalogValidationError,
} from './errors';
import { modelBatchDml } from './modelBatchDml';
import type { AiCatalogSecretManager, PlatformProviderKeyVaults } from './secretManager';
import {
  isOAuthAuthorizationExpiredError,
  isSharedOAuthRefreshConsumedError,
  refreshSharedOAuthVault,
  type RefreshSharedOAuthVaultParams,
} from './sharedOAuthRefresh';

export {
  applyChatGPTWebCatalogSyncPolicy,
  mapCardsToBatchUpdate,
} from './adminService.sync.mapping';

const SYNC_UPSTREAM_REASON = 'Sync models from upstream';

/**
 * Which of `modelKeys` a published platform agent or setting policy still pins.
 * One query when nothing is pinned; otherwise a split until each pinned key is
 * known. The shared resolver does not say which key matched.
 */
const findBlockedModelKeys = async (
  db: LobeChatDatabase | Transaction,
  providerKey: string,
  modelKeys: readonly string[],
): Promise<Set<string>> => {
  const unique = [...new Set(modelKeys)];
  if (unique.length === 0) return new Set();
  const dependents = await resolveAiCatalogDependentsForModels(db, providerKey, unique);
  if (!dependents.some((item) => item.blocking)) return new Set();
  if (unique.length === 1) return new Set(unique);
  const mid = Math.ceil(unique.length / 2);
  const left = await findBlockedModelKeys(db, providerKey, unique.slice(0, mid));
  const right = await findBlockedModelKeys(db, providerKey, unique.slice(mid));
  return new Set([...left, ...right]);
};

const toUpstreamSyncError = (error: unknown): AiCatalogUpstreamSyncError => {
  if (error instanceof AiCatalogUpstreamSyncError) return error;
  const failure = classifyAiConnectionFailure(error);
  const errorType = isOAuthAuthorizationExpiredError(error)
    ? 'OAuthAuthorizationExpired'
    : failure.errorType;
  return new AiCatalogUpstreamSyncError({
    errorCategory: failure.errorCategory,
    errorType,
    message: aiConnectionFailureCode(failure.errorCategory, errorType),
  });
};

const refreshVaultForUpstreamSync = async (
  params: RefreshSharedOAuthVaultParams,
): Promise<PlatformProviderKeyVaults> => {
  try {
    return await refreshSharedOAuthVault(params);
  } catch (error) {
    if (isOAuthAuthorizationExpiredError(error) || isSharedOAuthRefreshConsumedError(error)) {
      throw toUpstreamSyncError(error);
    }
    // Token-endpoint blip before the rotating token is spent — the still-valid
    // access token may list models. Persist failures after exchange are terminal.
    return params.keyVaults;
  }
};

const assertSharedAccountConnected = (
  provider: { providerKey: string; settings: PlatformAiProviderSettings },
  refreshed: Record<string, unknown>,
) => {
  const isSharedAccountProvider =
    provider.settings.authType === 'oauthDeviceFlow' ||
    isProviderOAuthDeviceFlow(provider.providerKey);
  const accessToken =
    typeof refreshed.oauthAccessToken === 'string' ? refreshed.oauthAccessToken : undefined;
  if (isSharedAccountProvider && !accessToken) {
    throw new AiCatalogValidationError(
      ['Shared account is not connected'],
      'shared_account_not_connected',
    );
  }
};

/**
 * Decrypt the draft platform vault, refresh a rotating grant if needed, and list
 * models through the same runtime chat uses. Does not go through
 * `resolvePlatformAiExecutionConfig` — that throws unless 平台托管 is published.
 */
export const enumeratePlatformUpstreamModels = async (params: {
  browserProfile?: Awaited<ReturnType<typeof resolvePlatformBrowserProfile>>;
  keyVaults: Record<string, unknown>;
  providerKey: string;
  runtimeProvider: string;
}): Promise<ChatModelCard[]> => {
  const payload = buildPayloadFromKeyVaults(
    params.keyVaults as Parameters<typeof buildPayloadFromKeyVaults>[0],
    params.runtimeProvider,
  );
  const runtime = initModelRuntimeWithUserPayload(params.providerKey, payload, {
    ...(params.browserProfile ? { browserProfile: params.browserProfile } : {}),
    conversationKey: `platform:sync-upstream:${params.providerKey}`,
    managedBy: 'platform',
  });
  let listed: ChatModelCard[] | undefined;
  try {
    listed = await runtime.models();
  } catch (error) {
    throw toUpstreamSyncError(error);
  }
  if (!Array.isArray(listed)) throw new AiCatalogCannotEnumerateError();
  return listed;
};

/**
 * Model-sync surface of {@link AiCatalogAdminService}.
 * Split from the provider / model-mutation surfaces to stay under the ~800-line guideline.
 */
export abstract class AiCatalogAdminServiceSyncOps extends AiCatalogAdminServiceModelOps {
  protected abstract readonly db: LobeChatDatabase;
  protected abstract readonly secrets: AiCatalogSecretManager;

  syncUpstream = async (actorUserId: string, input: { providerId: string }) => {
    const reason = await this.sanitizeReason(SYNC_UPSTREAM_REASON);
    let targetId: string | undefined;
    try {
      const detail = await this.resolveProviderDetail(input.providerId);
      targetId = detail.draft.id;
      const repository = new PlatformAiCatalogRepository(this.db);
      const provider = await repository.getProvider(detail.draft.id);
      if (!provider) throw new AiCatalogNotFoundError();

      const keyVaults = provider.encryptedKeyVaults
        ? await this.secrets.decrypt(provider.encryptedKeyVaults)
        : {};
      const refreshed =
        provider.encryptedKeyVaults && provider.secretFingerprint
          ? await refreshVaultForUpstreamSync({
              ciphertext: provider.encryptedKeyVaults,
              db: this.db,
              fingerprint: provider.secretFingerprint,
              keyVaults,
              providerKey: provider.providerKey,
              providerRowId: provider.id,
              secrets: this.secrets,
            })
          : keyVaults;

      assertSharedAccountConnected(provider, refreshed);

      const normalized = normalizeAiCatalogExecutionCredentials({
        config: provider.config,
        keyVaults: refreshed,
        providerKey: provider.providerKey,
        settings: provider.settings,
        source: provider.source,
      });
      const browserProfile = await resolvePlatformBrowserProfile(
        this.db,
        normalized.runtimeProvider,
      );
      const cards = await enumeratePlatformUpstreamModels({
        browserProfile,
        keyVaults: normalized.keyVaults,
        providerKey: provider.providerKey,
        runtimeProvider: normalized.runtimeProvider,
      });

      const mapped = mapCardsToBatchUpdate(cards, detail.draft.models);
      const returnedModelKeys = cards.map((card) => card.id);
      const cursorProvider = isCursorCatalogProvider(provider.providerKey, provider.settings);
      const planFor = (blockedModelKeys?: ReadonlySet<string>) =>
        applyProviderCatalogSyncPolicy({
          existing: detail.draft.models,
          mapped,
          providerKey: provider.providerKey,
          returnedModelKeys,
          settings: provider.settings,
          ...(blockedModelKeys && blockedModelKeys.size > 0 ? { blockedModelKeys } : {}),
        });

      let plan = planFor();
      if (cursorProvider) {
        const keys = cursorRetirementModelKeys(detail.draft.models, plan);
        if (keys.length > 0) {
          const blocked = await findBlockedModelKeys(this.db, provider.providerKey, keys);
          if (blocked.size > 0) plan = planFor(blocked);
        }
      }

      const appendSyncSuccessAudit = (db: typeof this.db) =>
        new PlatformAuditService(db).append({
          action: 'admin.aiModels.syncUpstream',
          actorUserId,
          afterDiff: {
            created: plan.created,
            deleted: plan.deleted.length,
            retained: plan.retained,
            total: plan.total,
            updated: plan.updated,
          },
          reason,
          result: 'success',
          targetId: detail.draft.id,
          targetType: 'provider',
        });

      const applyPlan = async (scoped: this) => {
        if (plan.items.length > 0) {
          await scoped.applyModelMutation(
            actorUserId,
            {
              expectedDraftToken: detail.draftToken,
              models: plan.items,
              operation: 'batchUpdate',
              providerId: detail.draft.id,
              reason,
            },
            { allowModelCreate: true },
          );
        }
        if (plan.deleted.length > 0) {
          const expectedDraftToken =
            plan.items.length > 0
              ? (await scoped.getDetail(detail.draft.id)).draftToken
              : detail.draftToken;
          const skipped = await scoped.removeSyncedCursorVariants(actorUserId, {
            expectedDraftToken,
            providerId: detail.draft.id,
            reason,
            variants: plan.deleted,
          });
          if (skipped.length > 0) {
            const skippedKeys = new Set(skipped);
            plan = {
              ...plan,
              deleted: plan.deleted.filter((row) => !skippedKeys.has(row.modelKey)),
              retained: plan.retained + skipped.length,
            };
          }
        }
        await scoped.publishAfterMutation(actorUserId, detail.draft.id, reason);
        await appendSyncSuccessAudit(scoped.db);
      };

      if (plan.items.length > 0 || plan.deleted.length > 0) {
        await this.runModelApplyTransaction(
          {
            action: 'admin.aiModels.applyImmediate',
            actorUserId,
            auditTargetId: detail.draft.id,
            reason,
            secretTargetId: detail.draft.id,
          },
          async (scoped) => {
            try {
              await applyPlan(scoped);
            } catch (error) {
              // A pin that appeared after the pre-check must not roll the
              // collapsed cards back. Keep only the variants a published
              // dependent actually blocks, and apply the rest.
              if (!cursorProvider || !(error instanceof AiCatalogResourceInUseError)) throw error;
              const keys = cursorRetirementModelKeys(detail.draft.models, planFor());
              if (keys.length === 0) throw error;
              const blocked = await findBlockedModelKeys(scoped.db, provider.providerKey, keys);
              if (blocked.size === 0) throw error;
              plan = planFor(blocked);
              await applyPlan(scoped);
            }
          },
        );
      } else {
        await appendSyncSuccessAudit(this.db);
      }

      return {
        created: plan.created,
        deleted: plan.deleted.length,
        retained: plan.retained,
        total: plan.total,
        updated: plan.updated,
      };
    } catch (error) {
      await this.appendFailureAudit({
        action: 'admin.aiModels.syncUpstream',
        actorUserId,
        reason,
        targetId,
      });
      throw error;
    }
  };

  /**
   * Drop never-enabled cursor variant rows inside the sync transaction.
   * Each row is audited as `admin.aiModels.deleteFromDraft`, the same action a
   * manual draft delete writes. A variant with a blocking dependent is left in
   * place and returned; it does not abort the sync.
   */
  private removeSyncedCursorVariants = async (
    actorUserId: string,
    input: {
      expectedDraftToken: string;
      providerId: string;
      reason: string;
      variants: readonly { id: string; modelKey: string }[];
    },
  ): Promise<readonly string[]> => {
    if (input.variants.length === 0) return [];
    return this.db.transaction(async (tx) => {
      const draft = await this.getLockedDraft(tx, input.providerId, input.expectedDraftToken);
      const byId = new Map(draft.models.map((model) => [model.id, model]));
      const targets = input.variants.map((variant) => {
        const model = byId.get(variant.id);
        if (!model) throw new AiCatalogNotFoundError();
        return model;
      });
      const blocked = await findBlockedModelKeys(
        tx,
        draft.providerKey,
        targets.map((model) => model.modelKey),
      );
      const removing = targets.filter((model) => !blocked.has(model.modelKey));
      const kept = targets
        .filter((model) => blocked.has(model.modelKey))
        .map((model) => model.modelKey);
      if (removing.length === 0) return kept;
      const modelIds = removing.map((model) => model.id);
      const removed = await modelBatchDml.bulkDeleteModels(tx, input.providerId, modelIds);
      if (removed !== modelIds.length) throw new AiCatalogNotFoundError();
      await modelBatchDml.bulkAppendAuditEntries(
        tx,
        removing.map((model) => ({
          action: 'admin.aiModels.deleteFromDraft',
          actorUserId,
          beforeDiff: {
            modelId: model.id,
            modelKey: model.modelKey,
            providerId: input.providerId,
          },
          reason: input.reason,
          result: 'success' as const,
          targetId: model.id,
          targetType: 'model',
        })),
      );
      await new PlatformAiCatalogRepository(tx).updateProvider(input.providerId, {
        status: 'draft',
        updatedBy: actorUserId,
      });
      return kept;
    });
  };

  private resolveProviderDetail = async (providerId: string) => {
    try {
      return await this.getDetail({ providerKey: providerId });
    } catch (error) {
      if (!(error instanceof AiCatalogNotFoundError)) throw error;
      return this.getDetail(providerId);
    }
  };
}
