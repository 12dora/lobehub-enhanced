import { BUILTIN_AGENT_SLUGS, getAgentRuntimeConfig, TASK_AGENT } from '@lobechat/builtin-agents';
import type {
  PlatformAgentAssignmentMode,
  PlatformAgentDependencySnapshot,
  PlatformAgentVersionConfig,
  PlatformAgentVersionPolicy,
} from '@lobechat/types';
import {
  PLATFORM_AGENT_GLOBAL_TARGET_ID,
  PLATFORM_AGENT_TASK_MANAGER_SYSTEM_KEY,
} from '@lobechat/types';

import type { PlatformAgentAssignmentSafeItem } from '@/database/repositories/platformAgentCatalog';
import type { PlatformAgentItem } from '@/database/schemas/platform';
import type { LobeChatDatabase, Transaction } from '@/database/type';
import type { getServerDefaultAgentConfig } from '@/server/globalConfig';

import {
  platformAgentDependencySnapshotSchema,
  platformAgentVersionConfigSchema,
} from '../../contracts/platformAgents/common';
import {
  isDefaultInboxGlobalAssignment,
  isEffectiveDefaultInboxGlobalAssignment,
  resolvePublishedDefaultModelPin,
} from './defaultInboxProvision';
import { PlatformAgentInvalidInputError } from './errors';

/** Catalog identity key for the provisioned task-manager Agent (matches the system key). */
export const PLATFORM_TASK_MANAGER_AGENT_KEY = PLATFORM_AGENT_TASK_MANAGER_SYSTEM_KEY;

/** Builtin slug on each member's `agents` row that this catalog identity overlays. */
export const PLATFORM_TASK_MANAGER_MEMBER_SLUG = BUILTIN_AGENT_SLUGS.taskAgent;

/** Product display name (zh-CN). English fallback is `Task Agent`. */
export const DEFAULT_TASK_MANAGER_DISPLAY_NAME_ZH = '任务助手';
export const DEFAULT_TASK_MANAGER_DISPLAY_NAME_EN = 'Task Agent';

const builtinTaskManagerTitleFor = (locale?: string) =>
  (locale ?? '').toLowerCase().startsWith('zh')
    ? DEFAULT_TASK_MANAGER_DISPLAY_NAME_ZH
    : DEFAULT_TASK_MANAGER_DISPLAY_NAME_EN;

/**
 * Global assignment that makes `task-manager` eligible for runtime overlay: enabled + active
 * + global target. Mode `default` is sufficient for effective resolution.
 */
export const TASK_MANAGER_GLOBAL_ASSIGNMENT = {
  enabled: true,
  mode: 'default' as PlatformAgentAssignmentMode,
  pinnedVersionId: null,
  targetId: PLATFORM_AGENT_GLOBAL_TARGET_ID,
  targetType: 'global' as const,
  versionPolicy: 'latest_published' as PlatformAgentVersionPolicy,
};

export const isTaskManagerIdentity = (identity: Pick<PlatformAgentItem, 'systemKey'>): boolean =>
  identity.systemKey === PLATFORM_AGENT_TASK_MANAGER_SYSTEM_KEY;

export const isTaskManagerGlobalAssignment = (
  assignment: Pick<PlatformAgentAssignmentSafeItem, 'targetId' | 'targetType'>,
): boolean => isDefaultInboxGlobalAssignment(assignment);

export const isEffectiveTaskManagerGlobalAssignment = (
  assignment: Pick<
    PlatformAgentAssignmentSafeItem,
    'enabled' | 'pinnedVersionId' | 'status' | 'targetId' | 'targetType' | 'versionPolicy'
  >,
): boolean => isEffectiveDefaultInboxGlobalAssignment(assignment);

export interface TaskManagerSeed {
  config: PlatformAgentVersionConfig;
  dependencySnapshot: PlatformAgentDependencySnapshot;
}

export interface BuildTaskManagerSeedOptions {
  getServerDefaultAgentConfig?: typeof getServerDefaultAgentConfig;
  /** Operator UI language from the admin mutation / startup `DEFAULT_LANG`. */
  locale?: string;
}

/**
 * Seed the first published task-manager version from the builtin TASK_AGENT definition:
 * display name 「任务助手」, avatar `/avatars/lobe-ai.png`, system role from
 * `task-agent/systemRole.ts`. Plugins (`lobe-task`) stay on each member's `task-agent` row
 * via builtin runtime — the version config has no plugins field. Model/provider pin is the
 * same published catalog default the inbox seed uses.
 */
export const buildTaskManagerSeed = async (
  db: LobeChatDatabase | Transaction,
  options: BuildTaskManagerSeedOptions = {},
): Promise<TaskManagerSeed> => {
  const runtime = getAgentRuntimeConfig(BUILTIN_AGENT_SLUGS.taskAgent, { plugins: [] });
  const systemRole = runtime?.systemRole ?? '';
  const model = await resolvePublishedDefaultModelPin(db, {
    getServerDefaultAgentConfig: options.getServerDefaultAgentConfig,
  });

  const configParsed = platformAgentVersionConfigSchema.safeParse({
    avatar: TASK_AGENT.avatar ?? null,
    backgroundColor: null,
    description: null,
    displayName: builtinTaskManagerTitleFor(options.locale),
    modelParameters: {},
    openingMessage: null,
    openingQuestions: [],
    systemRole,
    tags: [],
    thinkingEffort: null,
  });
  if (!configParsed.success) {
    throw new PlatformAgentInvalidInputError(
      'Task-manager seed failed platformAgentVersionConfigSchema validation',
    );
  }
  const dependencyParsed = platformAgentDependencySnapshotSchema.safeParse({
    connectors: [],
    model,
    skills: [],
  });
  if (!dependencyParsed.success) {
    throw new PlatformAgentInvalidInputError(
      'Task-manager seed failed platformAgentDependencySnapshotSchema validation',
    );
  }

  return {
    config: configParsed.data,
    dependencySnapshot: dependencyParsed.data,
  };
};
