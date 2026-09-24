import { DingtalkApprovalIdentifier } from '@lobechat/builtin-tool-dingtalk-approval';
import { DingtalkWorkspaceIdentifier } from '@lobechat/builtin-tool-dingtalk-workspace';
import { EnterpriseLookupIdentifier } from '@lobechat/builtin-tool-enterprise-lookup';
import type { EnterprisePublicServerConfig } from '@lobechat/types';

export type EnterpriseToolCapabilities = EnterprisePublicServerConfig['capabilities'];

/** `@lobechat/builtin-tool-dingtalk-personal`, keyed by identifier as the tools engine does. */
const DINGTALK_PERSONAL_TOOL_IDENTIFIER = 'lobe-dingtalk-personal';

/**
 * Builtin tools the administrator governs through a deployment capability flag
 * instead of per-user installation.
 *
 * `src/helpers/toolEngineering` gives each of them an explicit enable rule keyed
 * on its flag (plus a `defaultToolIds` injection), which *overrides* the user's
 * `uninstalledBuiltinTools` list. So while the flag is on the tool runs in every
 * chat no matter what the user stored — and while it is off the manifest is
 * dropped from the pool entirely. A per-user switch here would be a lie in both
 * directions, so these rows are shown as enabled with no control.
 */
const PLATFORM_MANAGED_BUILTIN_TOOLS = new Set<string>([
  DingtalkApprovalIdentifier,
  DINGTALK_PERSONAL_TOOL_IDENTIFIER,
  DingtalkWorkspaceIdentifier,
  EnterpriseLookupIdentifier,
]);

/** True when the tool's availability is an administrator decision, not the user's. */
export const isPlatformManagedBuiltinTool = (identifier: string): boolean =>
  PLATFORM_MANAGED_BUILTIN_TOOLS.has(identifier);

/**
 * Whether the deployment has the backend for a builtin tool.
 *
 * **Fails closed**: anything other than an explicit `true` hides the tool. The
 * flags are seeded synchronously from the injected server config, so a hidden
 * row never flashes in and out while a fetch settles.
 */
export const isBuiltinToolAvailableInDeployment = (
  identifier: string,
  capabilities: EnterpriseToolCapabilities,
): boolean => {
  switch (identifier) {
    case DingtalkApprovalIdentifier: {
      return capabilities?.dingtalkApproval === true;
    }
    case DingtalkWorkspaceIdentifier: {
      return capabilities?.dingtalkTodo === true || capabilities?.dingtalkCalendar === true;
    }
    case DINGTALK_PERSONAL_TOOL_IDENTIFIER: {
      return capabilities?.dingtalkPersonal === true;
    }
    case EnterpriseLookupIdentifier: {
      return capabilities?.enterpriseLookup === true;
    }
    default: {
      return true;
    }
  }
};
