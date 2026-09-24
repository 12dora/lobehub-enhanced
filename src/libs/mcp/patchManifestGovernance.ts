/**
 * Org-mandate layer for builtin in-process tool manifests.
 *
 * While the org connectors managed policy is effectively enforced
 * (`governance.active`), the org's builtin tool permission matrix REPLACES
 * per-user connector_tools rows for builtin identifiers. This helper surfaces
 * the matrix to the model / approval prompt by patching manifest `api[]`
 * entries, mirroring the per-user semantics of `patchManifestPermissions.ts`
 * and `buildConnectorManifests.ts`:
 *
 * - 'disabled'       → blocking description + humanIntervention 'required'
 *                      (the hard block is enforced separately at execution
 *                      time in ToolExecutionService)
 * - 'needs_approval' → humanIntervention 'required'
 * - 'auto'           → the org explicitly allows the API: strip ONLY a static
 *                      `'required'` the manifest shipped with; `'always'` and
 *                      rule/dynamic intervention configs are tool-authored
 *                      safety gates (not permission defaults) and stay as-is
 * - matrix miss      → the manifest's static default behavior, same as an
 *                      unsynced user today
 *
 * Pure (no DB / server imports) so it can run wherever the manifests are
 * built. The permission strings are structurally identical to
 * `ConnectorGovernancePermission` in the enterprise connector governance
 * service; they are re-declared here to keep this module dependency-free.
 *
 * `resolveLink` turns the admin path in the blocking description into an
 * absolute link for IM turns.
 */
import type { AppLinkResolver } from '@lobechat/utils/appLink';

import { orgDisabledToolDescription } from './disabledToolText';

export type BuiltinGovernancePermission = 'auto' | 'disabled' | 'needs_approval';

/** identifier (builtin tool id, e.g. `lobe-task`) → apiName → permission. */
export type BuiltinGovernanceMatrix = Record<string, Record<string, BuiltinGovernancePermission>>;

export function patchBuiltinManifestWithGovernance<
  M extends {
    api: Array<{
      description?: string;
      humanIntervention?: unknown;
      name: string;
      [k: string]: unknown;
    }>;
    identifier: string;
  },
>(manifest: M, matrix: BuiltinGovernanceMatrix, resolveLink?: AppLinkResolver): M {
  const policies = matrix[manifest.identifier];
  if (!policies || !Array.isArray(manifest.api)) return manifest;

  const patchedApi = manifest.api.map((api) => {
    const permission = policies[api.name];
    if (permission === 'disabled') {
      return {
        ...api,
        description: orgDisabledToolDescription(api.name, resolveLink),
        humanIntervention: 'required' as const,
      };
    }
    if (permission === 'needs_approval') {
      return { ...api, humanIntervention: 'required' as const };
    }
    if (permission === 'auto' && api.humanIntervention === 'required') {
      // The org explicitly allows this API: drop only the static 'required'
      // approval gate. 'always' / complex configs remain safety-critical.
      return { ...api, humanIntervention: undefined };
    }
    return api;
  });
  return { ...manifest, api: patchedApi };
}
