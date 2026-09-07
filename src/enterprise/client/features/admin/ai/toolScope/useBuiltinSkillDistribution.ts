'use client';

import { builtinSkills as bundledBuiltinSkills } from '@lobechat/builtin-skills';
import { useCallback, useMemo } from 'react';

import { adminSkillsService } from '@/enterprise/client/services/adminSkills';
import type { AdminSkillDistribution, AdminToolScopeCapabilities } from '@/features/AdminToolScope';

import { buildApplyImmediateVersionPayload } from '../../skills/controller';
import { REASONS } from './adminToolScopeHelpers';
import { LOCAL_ERROR } from './toolScopeErrors';
import type { AdminToolScopeSectionParams } from './toolScopeSection';
import type { useAdminSkillCatalog } from './useAdminSkillCatalog';

interface UseBuiltinSkillDistributionParams {
  capabilities: AdminToolScopeCapabilities;
  notifications: AdminToolScopeSectionParams['notifications'];
  retry: ReturnType<typeof useAdminSkillCatalog>['retry'];
  skillRowsByKey: ReturnType<typeof useAdminSkillCatalog>['skillRowsByKey'];
}

/**
 * Org-wide skill availability + builtin distribution. A code-bundled builtin has
 * no row until the org makes its first decision about it, so reads fall back to
 * the bundled default and the first write materializes an override row.
 */
export const useBuiltinSkillDistribution = ({
  capabilities,
  notifications,
  retry,
  skillRowsByKey,
}: UseBuiltinSkillDistributionParams) => {
  const { notifyApplyOutcome, notifySkillFailure, notifyUnlessAlreadyToasted } = notifications;

  const bundledBuiltinKeys = useMemo(
    () => new Set(bundledBuiltinSkills.map((skill) => skill.identifier)),
    [],
  );

  /**
   * Org-wide availability of a catalog skill. Availability and distribution are
   * separate axes: `distribution: 'optional'` still ships the skill, it just is
   * not pinned onto every assistant, so it must not read as disabled.
   */
  const isSkillKeyEnabled = useCallback(
    (skillKey: string) => {
      const row = skillRowsByKey.get(skillKey);
      if (!row) return true;
      return row.enabled !== false && row.status !== 'archived';
    },
    [skillRowsByKey],
  );

  /** Bundled builtin skills have no row until the org disables them. */
  const isBuiltinSkillEnabled = isSkillKeyEnabled;

  /** Uploaded org catalog skills always have a row; the fallback never fires. */
  const isOrgSkillEnabled = isSkillKeyEnabled;

  const getBuiltinSkillDistribution = useCallback(
    (identifier: string): AdminSkillDistribution => {
      const row = skillRowsByKey.get(identifier);
      if (!row || row.status === 'archived') return row ? 'optional' : 'default';
      return row.distribution;
    },
    [skillRowsByKey],
  );

  /** Create when no live override exists; update when one does (ASKC-03). */
  const canSetBuiltinSkillDistribution = useCallback(
    (identifier: string): boolean => {
      const row = skillRowsByKey.get(identifier);
      if (row && row.status !== 'archived') return capabilities.canUpdateSkill;
      return capabilities.canCreateSkill;
    },
    [capabilities.canCreateSkill, capabilities.canUpdateSkill, skillRowsByKey],
  );

  const setBuiltinSkillDistribution = useCallback(
    async (identifier: string, distribution: AdminSkillDistribution) => {
      // Hard applyImmediate failures toast via withAdminAiInfraErrorToast (tagged).
      // Pre-read / local denials are toasted by callers that check the tag.
      const row = skillRowsByKey.get(identifier);
      if (row) {
        if (!capabilities.canUpdateSkill) throw new Error(LOCAL_ERROR.PERMISSION);
        const detail = await adminSkillsService.get({ id: row.id });
        const result = await adminSkillsService.applyImmediate({
          distribution,
          expectedDraftToken: detail.draftToken,
          expectedRevision: detail.baseRevision,
          id: row.id,
          mode: 'update',
          reason: REASONS.skillDistribution,
        });
        notifyApplyOutcome(result);
      } else {
        if (!capabilities.canCreateSkill) throw new Error(LOCAL_ERROR.PERMISSION);
        // First org-level decision about a code-bundled builtin: materialize an
        // override row carrying the bundled content so the catalog can shadow it.
        const bundled = bundledBuiltinSkills.find((skill) => skill.identifier === identifier);
        if (!bundled) throw new Error(`Unknown builtin skill: ${identifier}`);
        const version = buildApplyImmediateVersionPayload({
          content: bundled.content,
          description: bundled.description ?? null,
          displayName: bundled.name,
          version: '1.0.0',
        });
        if (!version) throw new Error('Failed to build builtin override version');
        const result = await adminSkillsService.applyImmediate({
          allowBuiltinOverride: true,
          description: bundled.description ?? null,
          displayName: bundled.name,
          distribution,
          enabled: true,
          mode: 'create',
          reason: REASONS.skillDistribution,
          skillKey: identifier,
          version,
        });
        notifyApplyOutcome(result);
      }
      retry();
    },
    [
      capabilities.canCreateSkill,
      capabilities.canUpdateSkill,
      notifyApplyOutcome,
      retry,
      skillRowsByKey,
    ],
  );

  /**
   * Org-wide availability write. Materializing a builtin override row is the
   * server's job (setEnabled is keyed by skillKey), so the only client-side
   * gate is the permission the write will require — and the server selects that
   * permission from the key alone (bundled builtin ⇒ CREATE, otherwise UPDATE),
   * so mirroring row presence here would disagree with it.
   */
  const setSkillKeyEnabled = useCallback(
    async (skillKey: string, enabled: boolean) => {
      const permitted = bundledBuiltinKeys.has(skillKey)
        ? capabilities.canCreateSkill
        : capabilities.canUpdateSkill;
      if (!permitted) throw new Error(LOCAL_ERROR.PERMISSION);
      await adminSkillsService.setEnabled({ enabled, skillKey });
      notifyApplyOutcome({ publishError: null, published: true });
      retry();
    },
    [
      bundledBuiltinKeys,
      capabilities.canCreateSkill,
      capabilities.canUpdateSkill,
      notifyApplyOutcome,
      retry,
    ],
  );

  const withSkillFailureToast = useCallback(
    async (run: () => Promise<void>) => {
      try {
        await run();
      } catch (err) {
        // setEnabled already toasts hard failures; cover local denials.
        notifyUnlessAlreadyToasted(notifySkillFailure, err);
        throw err;
      }
    },
    [notifySkillFailure, notifyUnlessAlreadyToasted],
  );

  const toggleBuiltinSkill = useCallback(
    (identifier: string, enabled: boolean) =>
      withSkillFailureToast(() => setSkillKeyEnabled(identifier, enabled)),
    [setSkillKeyEnabled, withSkillFailureToast],
  );

  const setOrgSkillEnabled = useCallback(
    (skillKey: string, enabled: boolean) =>
      withSkillFailureToast(() => setSkillKeyEnabled(skillKey, enabled)),
    [setSkillKeyEnabled, withSkillFailureToast],
  );

  return {
    canSetBuiltinSkillDistribution,
    getBuiltinSkillDistribution,
    isBuiltinSkillEnabled,
    isOrgSkillEnabled,
    setBuiltinSkillDistribution,
    setOrgSkillEnabled,
    toggleBuiltinSkill,
  };
};
