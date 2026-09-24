import type { AppLinkResolver } from '@lobechat/utils/appLink';

import { ConnectorToolPermission } from '@/database/schemas';

import { userDisabledToolDescription } from './disabledToolText';

/**
 * Patch a tool manifest's `api[]` with connector tool permissions.
 *
 * Pure (no DB / server imports) so it can run on BOTH the server runtime and the
 * classic client chat path. The 'disabled' hard-block is enforced separately at
 * execution time (ToolExecutionService / mcp router); this surfaces the
 * permission to the model and the client approval prompt.
 *
 * - needs_approval → humanIntervention: 'required'  (approval prompt)
 * - disabled       → blocking description + humanIntervention: 'required'
 *
 * `resolveLink` turns the settings path in that description into an absolute link for IM turns.
 */
export function patchManifestWithPermissions<
  M extends {
    api: Array<{
      description?: string;
      humanIntervention?: unknown;
      name: string;
      [k: string]: unknown;
    }>;
  },
>(
  manifest: M,
  toolPermissions: Map<string, ConnectorToolPermission>,
  resolveLink?: AppLinkResolver,
): M {
  const patchedApi = manifest.api.map((api) => {
    const permission = toolPermissions.get(api.name);
    if (permission === ConnectorToolPermission.disabled) {
      return {
        ...api,
        description: userDisabledToolDescription(api.name, resolveLink),
        humanIntervention: 'required' as const,
      };
    }
    if (permission === ConnectorToolPermission.needs_approval) {
      return { ...api, humanIntervention: 'required' as const };
    }
    return api;
  });
  return { ...manifest, api: patchedApi };
}
