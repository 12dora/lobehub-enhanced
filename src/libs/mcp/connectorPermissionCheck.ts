import type { LobeChatDatabase } from '@lobechat/database';
import type { AppLinkResolver } from '@lobechat/utils/appLink';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import type { ConnectorToolPermission } from '@/database/schemas';

import { blockedToolMessage } from './disabledToolText';

// Re-exported from a pure module so the same patch logic is usable client-side.
export { patchManifestWithPermissions } from './patchManifestPermissions';

/**
 * Look up the user's permission setting for a specific connector tool.
 *
 * @param db        - Server DB instance
 * @param userId    - Authenticated user ID
 * @param identifier - Connector identifier (e.g. 'gmail', 'vercel')
 * @param toolName  - Tool API name (e.g. 'gmail_search_emails', 'deploy')
 * @param workspaceId - Workspace scope (omit for personal mode)
 *
 * Returns the stored permission, or null if no connector/tool entry exists.
 */
export async function getConnectorToolPermission(
  db: LobeChatDatabase,
  userId: string,
  identifier: string,
  toolName: string,
  workspaceId?: string,
): Promise<ConnectorToolPermission | null> {
  try {
    const connectorModel = new ConnectorModel(db, userId, workspaceId);
    const [connector] = await connectorModel.queryByIdentifiers([identifier]);
    if (!connector) return null;

    const toolModel = new ConnectorToolModel(db, userId, workspaceId);
    const tools = await toolModel.queryByConnector(connector.id);
    return (
      (tools.find((t) => t.toolName === toolName)?.permission as ConnectorToolPermission) ?? null
    );
  } catch {
    return null; // never block execution due to DB error
  }
}

/**
 * Standardised blocked-tool response returned to the AI. `byOrgPolicy` points at the admin
 * connectors page instead of the user's own settings; `resolveLink` makes the link absolute for IM.
 */
export function buildBlockedToolResponse(
  toolName: string,
  options: { byOrgPolicy?: boolean; resolveLink?: AppLinkResolver } = {},
): {
  content: string;
  state: { content: [{ text: string; type: 'text' }]; isError: boolean };
  success: boolean;
} {
  const message = blockedToolMessage(toolName, options);
  return {
    content: message,
    state: { content: [{ text: message, type: 'text' }], isError: false },
    success: true,
  };
}
