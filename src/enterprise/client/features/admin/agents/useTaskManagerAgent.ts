'use client';

import { PLATFORM_AGENT_TASK_MANAGER_SYSTEM_KEY } from '@lobechat/types';

import { adminAgentsService } from '@/enterprise/client/services/adminAgents';
import { useClientDataSWR } from '@/libs/swr';

import { ADMIN_AGENT_TASK_MANAGER_KEY } from './swrKeys';
import type { AdminAgentsClient } from './types';
import type { AdminDefaultAgentSnapshot } from './useAdminAgents';
import { fetchAdminAgentDetail } from './useAdminAgents';

/** Same shape the pinned 默认助理 card reads: the catalog row plus its published version. */
export type AdminSystemAgentSnapshot = AdminDefaultAgentSnapshot;

/**
 * Resolve the managed 任务助手, or `null` when the platform has not taken it over yet (members are
 * then served the built-in task agent).
 *
 * Dedicated `systemKey: 'task-manager'` pointer read — one list request, never a page-walk.
 */
export const fetchTaskManagerAdminAgent = async (
  client: AdminAgentsClient = adminAgentsService,
): Promise<AdminSystemAgentSnapshot | null> => {
  const page = await client.list({
    limit: 1,
    systemKey: PLATFORM_AGENT_TASK_MANAGER_SYSTEM_KEY,
  });
  const item = page.items.find(
    ({ identity }) => identity.systemKey === PLATFORM_AGENT_TASK_MANAGER_SYSTEM_KEY,
  );
  if (!item) return null;
  // The pointer row is the authoritative half: a failed aggregate read costs the card its avatar,
  // never the pinned assistant itself.
  const detail = await fetchAdminAgentDetail(item.identity.id, client, false).catch(() => null);
  return { detail, item };
};

/**
 * The pinned 任务助手. Its own SWR entry, like the default assistant's: the card must stay put
 * while the table below is searched, filtered or paged.
 */
export const useTaskManagerAdminAgent = (
  enabled: boolean,
  client: AdminAgentsClient = adminAgentsService,
) =>
  useClientDataSWR<AdminSystemAgentSnapshot | null>(
    enabled ? ADMIN_AGENT_TASK_MANAGER_KEY : null,
    () => fetchTaskManagerAdminAgent(client),
    { revalidateOnFocus: false },
  );
