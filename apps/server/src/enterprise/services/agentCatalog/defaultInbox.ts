import { INBOX_SESSION_ID } from '@lobechat/const';
import { type AgentItem, PLATFORM_AGENT_DEFAULT_INBOX_SYSTEM_KEY } from '@lobechat/types';
import { isNonEmptyString } from '@lobechat/utils';

import type { EnterpriseFeatureFlags } from '@/const/platform/featureFlags';
import type { PlatformManagedResourcePolicyModel } from '@/database/models/platform';
import type { PlatformAgentCatalogRepository } from '@/database/repositories/platformAgentCatalog';
import type { LobeChatDatabase } from '@/database/type';
import type { AgentConfigWithId } from '@/server/services/agent';

import { parseEnterpriseFeatureFlags } from '../../featureFlags';
import { validateExactPlatformAgentDependencies } from './dependencyValidator';
import {
  PlatformAgentEffectiveResolver,
  type PlatformAgentOperationHandle,
} from './effectiveResolver';
import { isPlatformAgentTakeoverActive } from './enforcement';
import { PlatformAgentMaterializationService } from './materialization';
import { resolveThinkingEffortChatConfigPatch } from './thinkingEffort';

interface PlatformDefaultInboxServiceOptions {
  flags?: EnterpriseFeatureFlags;
  /**
   * Override for tests. Production default is {@link isPlatformAgentTakeoverActive}.
   * When false, user plugin toggles stay on the overlay; when true they are blanked.
   */
  isTakeoverActive?: () => Promise<boolean>;
  materializationService?: Pick<PlatformAgentMaterializationService, 'resolveForExistingAgent'>;
  policyModel?: Pick<PlatformManagedResourcePolicyModel, 'getSnapshot'>;
  repository?: PlatformAgentCatalogRepository;
  resolver?: Pick<PlatformAgentEffectiveResolver, 'beginSystemOperation'>;
  validateDependencies?: typeof validateExactPlatformAgentDependencies;
}

type BuiltinInboxConfig = AgentConfigWithId & Pick<AgentItem, 'description' | 'slug' | 'tags'>;

/**
 * Narrow adapter that maps the stable `default-inbox` platform role onto the existing builtin
 * `inbox` identity. It never creates/replaces an inbox row and never rewrites history.
 */
export class PlatformDefaultInboxService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly options: PlatformDefaultInboxServiceOptions = {},
  ) {}

  private flags = (): EnterpriseFeatureFlags =>
    this.options.flags ?? parseEnterpriseFeatureFlags(process.env);

  private isTakeoverActive = (): Promise<boolean> =>
    this.options.isTakeoverActive?.() ?? isPlatformAgentTakeoverActive(this.db, this.flags());

  /** Flag-off short-circuits before policy/catalog IO. Null means genuinely not managed. */
  async capture(): Promise<PlatformAgentOperationHandle | null> {
    if (!this.flags().ENABLE_PLATFORM_MANAGED_AGENTS) return null;
    const resolver =
      this.options.resolver ??
      new PlatformAgentEffectiveResolver(this.db, {
        flags: this.options.flags,
        policyModel: this.options.policyModel,
        repository: this.options.repository,
      });
    return resolver.beginSystemOperation(this.userId, PLATFORM_AGENT_DEFAULT_INBOX_SYSTEM_KEY);
  }

  /**
   * Overlay the fields owned by the immutable platform version. Internal id/slug and the
   * existing non-managed chat/TTS/agency fields remain intact. User plugin toggles stay unless
   * catalog takeover is active (then plugins are blanked).
   *
   * In light mode (takeover off) model/provider/params are DEFAULTS: a user pair is kept only
   * when both `base.provider` and `base.model` are non-empty (never mixed with the admin pair);
   * params merge admin defaults under the user row. Enforced takeover pins the admin pair and
   * lets admin params win. A version thinking-effort pin is always a default, not a lock: it
   * fills chatConfig only when the user has not set that key.
   * Resolver/exact-version/dependency errors propagate (never masquerade as "no default"); only a
   * real null capture falls back.
   */
  getEffectiveBuiltinConfig = async (base: BuiltinInboxConfig): Promise<BuiltinInboxConfig> => {
    if (base.slug !== INBOX_SESSION_ID) return base;
    const handle = await this.capture();
    if (!handle) return base;
    const snapshot = handle.getSnapshot();
    const materialization =
      this.options.materializationService ??
      new PlatformAgentMaterializationService(this.db, this.userId, this.options.repository);
    const resolved = await materialization.resolveForExistingAgent(snapshot, base.id);
    await (this.options.validateDependencies ?? validateExactPlatformAgentDependencies)(
      this.db,
      resolved.dependencySnapshot,
    );

    const effortPatch = resolveThinkingEffortChatConfigPatch(snapshot.config);
    const takeover = await this.isTakeoverActive();
    const userOwnsModelPair =
      !takeover && isNonEmptyString(base.provider) && isNonEmptyString(base.model);

    return {
      ...base,
      avatar: snapshot.config.avatar,
      backgroundColor: snapshot.config.backgroundColor ?? undefined,
      description: snapshot.config.description ?? undefined,
      model: userOwnsModelPair ? base.model : resolved.config.model,
      openingMessage: snapshot.config.openingMessage ?? undefined,
      openingQuestions: snapshot.config.openingQuestions,
      params: takeover
        ? { ...base.params, ...resolved.config.params }
        : { ...resolved.config.params, ...base.params },
      platform: {
        distribution: handle.distribution,
        managed: true,
        modelLocked: takeover,
        source: 'platform',
      },
      plugins: takeover ? [] : base.plugins,
      provider: userOwnsModelPair ? base.provider : resolved.config.provider,
      slug: INBOX_SESSION_ID,
      systemRole: snapshot.config.systemRole,
      tags: snapshot.config.tags,
      title: snapshot.config.displayName,
      ...(effortPatch
        ? {
            chatConfig: {
              ...base.chatConfig,
              [effortPatch.configKey]:
                base.chatConfig?.[effortPatch.configKey] ?? effortPatch.level,
            } as BuiltinInboxConfig['chatConfig'],
          }
        : {}),
    };
  };
}
