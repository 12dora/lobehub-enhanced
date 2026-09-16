import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { type AgentItem, PLATFORM_AGENT_TASK_MANAGER_SYSTEM_KEY } from '@lobechat/types';
import { isNonEmptyString } from '@lobechat/utils';

import type { EnterpriseFeatureFlags } from '@/const/platform/featureFlags';
import type { PlatformAgentCatalogRepository } from '@/database/repositories/platformAgentCatalog';
import type { LobeChatDatabase } from '@/database/type';
import type { AgentConfigWithId } from '@/server/services/agent';

import { parseEnterpriseFeatureFlags } from '../../featureFlags';
import { validateExactPlatformAgentDependencies } from './dependencyValidator';
import {
  PlatformAgentEffectiveResolver,
  type PlatformAgentOperationHandle,
} from './effectiveResolver';
import { mapModelParameters, PlatformAgentMaterializationService } from './materialization';
import { resolveThinkingEffortChatConfigPatch } from './thinkingEffort';

interface PlatformTaskManagerServiceOptions {
  flags?: EnterpriseFeatureFlags;
  materializationService?: Pick<PlatformAgentMaterializationService, 'resolveForExistingAgent'>;
  repository?: PlatformAgentCatalogRepository;
  resolver?: Pick<PlatformAgentEffectiveResolver, 'beginSystemOperation'>;
  validateDependencies?: typeof validateExactPlatformAgentDependencies;
}

type BuiltinTaskManagerConfig = AgentConfigWithId &
  Pick<AgentItem, 'description' | 'slug' | 'tags'>;

/** Raw `agents` row fields used for light-mode model/provider/params defaults. */
export interface TaskManagerUserRow {
  model?: string | null;
  params?: Record<string, unknown> | null;
  provider?: string | null;
}

export interface GetEffectiveTaskManagerConfigOptions {
  /**
   * Unmerged DB row. When present, light-mode "did the user pick a model?" uses these
   * values (null/empty = follow the admin default) instead of `base`, which may already
   * contain DEFAULT_AGENT_CONFIG / server / user-settings fills.
   */
  userRow?: TaskManagerUserRow;
}

/** Display fields from the published task-manager catalog version. */
export interface PublishedTaskManagerIdentity {
  avatar: string | null;
  backgroundColor: string | null;
  title: string | null;
}

/**
 * Narrow adapter that maps the stable `task-manager` platform role onto the existing builtin
 * `task-agent` identity. Light-mode only: admin identity/prompt always overlay; model/provider
 * /params/thinkingEffort are defaults; the member row keeps chatConfig and plugins. It never
 * creates/replaces a task-agent row and never rewrites history.
 */
export class PlatformTaskManagerService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly options: PlatformTaskManagerServiceOptions = {},
  ) {}

  private flags = (): EnterpriseFeatureFlags =>
    this.options.flags ?? parseEnterpriseFeatureFlags(process.env);

  /** Flag-off short-circuits before policy/catalog IO. Null means genuinely not managed. */
  async capture(): Promise<PlatformAgentOperationHandle | null> {
    if (!this.flags().ENABLE_PLATFORM_MANAGED_AGENTS) return null;
    const resolver =
      this.options.resolver ??
      new PlatformAgentEffectiveResolver(this.db, {
        flags: this.options.flags,
        repository: this.options.repository,
      });
    return resolver.beginSystemOperation(this.userId, PLATFORM_AGENT_TASK_MANAGER_SYSTEM_KEY);
  }

  /**
   * Published task-manager display identity without materializing an agent row.
   * Null when the catalog is off or unpublished. Resolver errors propagate.
   */
  async getPublishedIdentity(): Promise<PublishedTaskManagerIdentity | null> {
    const handle = await this.capture();
    if (!handle) return null;
    const { avatar, backgroundColor, displayName } = handle.getSnapshot().config;
    return {
      avatar,
      backgroundColor,
      title: displayName,
    };
  }

  /**
   * Overlay the fields owned by the immutable platform version. Internal id/slug and the
   * existing non-managed chat/TTS/agency fields remain intact. Plugins always stay on the
   * member row (`lobe-task` lives there via builtin runtime).
   *
   * Always light mode: a user pair is kept only when both provider and model are non-empty
   * on the raw row. Pass `options.userRow` for that decision. A version thinking-effort pin
   * fills chatConfig only when the user has not set that key.
   */
  getEffectiveBuiltinConfig = async (
    base: BuiltinTaskManagerConfig,
    options?: GetEffectiveTaskManagerConfigOptions,
  ): Promise<BuiltinTaskManagerConfig> => {
    if (base.slug !== BUILTIN_AGENT_SLUGS.taskAgent) return base;
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
    const modelSource = options?.userRow ?? base;
    const userModel = isNonEmptyString(modelSource.model) ? modelSource.model : undefined;
    const userProvider = isNonEmptyString(modelSource.provider) ? modelSource.provider : undefined;
    const userOwnsModelPair = userModel !== undefined && userProvider !== undefined;

    const mappedAdminParams = mapModelParameters(snapshot.config);
    const lightParams = {
      ...base.params,
      ...mappedAdminParams,
      ...(options?.userRow ? (options.userRow.params ?? {}) : {}),
    };

    return {
      ...base,
      avatar: snapshot.config.avatar,
      backgroundColor: snapshot.config.backgroundColor ?? undefined,
      description: snapshot.config.description ?? undefined,
      model: userOwnsModelPair ? userModel : resolved.config.model,
      openingMessage: snapshot.config.openingMessage ?? undefined,
      openingQuestions: snapshot.config.openingQuestions,
      params: lightParams,
      platform: {
        distribution: handle.distribution,
        managed: true,
        modelLocked: false,
        source: 'platform',
      },
      plugins: base.plugins,
      provider: userOwnsModelPair ? userProvider : resolved.config.provider,
      slug: BUILTIN_AGENT_SLUGS.taskAgent,
      systemRole: snapshot.config.systemRole,
      tags: snapshot.config.tags,
      title: snapshot.config.displayName,
      ...(effortPatch
        ? {
            chatConfig: {
              ...base.chatConfig,
              [effortPatch.configKey]:
                base.chatConfig?.[effortPatch.configKey] ?? effortPatch.level,
            } as BuiltinTaskManagerConfig['chatConfig'],
          }
        : {}),
    };
  };
}
