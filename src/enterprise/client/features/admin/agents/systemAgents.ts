import {
  PLATFORM_AGENT_DEFAULT_INBOX_SYSTEM_KEY,
  PLATFORM_AGENT_TASK_MANAGER_SYSTEM_KEY,
} from '@lobechat/types';

/** Admin-namespace label for a reserved system assistant (默认助理 / 任务助手). */
export type SystemAgentLabelKey =
  'agentCatalog.systemAgent.defaultInbox' | 'agentCatalog.systemAgent.taskManager';

/**
 * Name the reserved assistant behind a system key, so copy about "this identity is the
 * platform's" can be written once and say WHICH assistant it is talking about.
 *
 * Takes a plain string: the identity type narrows to whatever the server contract currently
 * publishes, and this helper must keep answering for every key the platform ships.
 */
export const systemAgentLabel = (
  systemKey: string | null | undefined,
): SystemAgentLabelKey | null => {
  if (systemKey === PLATFORM_AGENT_TASK_MANAGER_SYSTEM_KEY) {
    return 'agentCatalog.systemAgent.taskManager';
  }
  if (systemKey === PLATFORM_AGENT_DEFAULT_INBOX_SYSTEM_KEY) {
    return 'agentCatalog.systemAgent.defaultInbox';
  }
  return null;
};

/**
 * A row the platform reserves: its identifier, its delivery and its lifecycle belong to the
 * platform, so the catalog table never lists it and the row menu never offers to archive,
 * delete or promote it. `isDefault` is kept in the predicate for a row whose `systemKey`
 * projection is behind — the default pointer alone is already proof of a reserved identity.
 */
export const isReservedSystemAgent = (identity: {
  isDefault?: boolean;
  systemKey?: string | null;
}): boolean => identity.systemKey != null || identity.isDefault === true;
