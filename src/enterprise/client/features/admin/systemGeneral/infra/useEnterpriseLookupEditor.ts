'use client';

import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AdminReauthBlockedError,
  AdminReauthCancelledError,
} from '@/enterprise/client/features/admin/reauth/requestAdminReauth';
import { useAdminAccess } from '@/enterprise/client/providers/AdminAccessProvider';
import type {
  AdminEnterpriseLookupSettingsService,
  AdminSystemEnterpriseLookupProbeResult,
  AdminSystemEnterpriseLookupSettings,
} from '@/enterprise/client/services/adminSystem';
import { adminSystemService } from '@/enterprise/client/services/adminSystem';
import type { EnterpriseLookupProvider } from '@/types/platform/enterpriseLookup';

import { runAdminMutation } from '../../primitives/runAdminMutation';
import { useUnsavedChangesGuard } from '../../primitives/useUnsavedChangesGuard';
import { secretMissing } from './draft';
import {
  type EnterpriseLookupDraft,
  enterpriseLookupProviderSecret,
  fingerprintEnterpriseLookupDraft,
  reconcileEnterpriseLookupDefaultProvider,
  settleEnterpriseLookupDraft,
  toEnterpriseLookupDraft,
  toEnterpriseLookupUpdateInput,
  validateEnterpriseLookupDraft,
} from './enterpriseLookupDraft';
import { decideInfraHydration } from './infraSettingsHydration';
import { invalidateAdminEnterpriseLookupSettings } from './invalidate';
import { resolveInfraSaveError } from './serverErrors';

export type EnterpriseLookupProbeMap = Partial<
  Record<EnterpriseLookupProvider, AdminSystemEnterpriseLookupProbeResult>
>;

export interface UseEnterpriseLookupEditorParams {
  /** SYSTEM_OPERATE — without it the card stays a read-only view. */
  canOperate: boolean;
  /** Injectable for tests. */
  service?: AdminEnterpriseLookupSettingsService;
  view: AdminSystemEnterpriseLookupSettings;
}

/**
 * 企业查询 editing state machine.
 *
 * The same three problems the other 基础设施 editors solve — a shared SWR snapshot that must not
 * wipe a draft, a CAS'd write whose conflict is a reload rather than a retry, and write-only
 * secrets that live in memory for exactly one request — plus one of its own: the probe is per
 * provider, and it has to test the key the operator just typed rather than the stored one, because
 * rotating a credential is the moment you most want to know whether it works.
 *
 * There is no 恢复为环境变量: this dependency has no environment fallback, so the row exists only
 * because an admin created it and the way to switch it off is to disable both providers.
 */
export const useEnterpriseLookupEditor = ({
  canOperate,
  service = adminSystemService,
  view,
}: UseEnterpriseLookupEditorParams) => {
  const { t } = useTranslation('admin');
  const { authMethod } = useAdminAccess();

  const seed = useMemo(() => toEnterpriseLookupDraft(view), [view]);
  const seedFp = fingerprintEnterpriseLookupDraft(seed);
  const seedRef = useRef(seed);
  seedRef.current = seed;

  const [draft, setDraft] = useState<EnterpriseLookupDraft>(seed);
  const [baseRevision, setBaseRevision] = useState(view.revision);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [stale, setStale] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [probes, setProbes] = useState<EnterpriseLookupProbeMap>({});
  const [probing, setProbing] = useState<Partial<Record<EnterpriseLookupProvider, boolean>>>({});
  /** Successful writes, so the 编辑 modal closes on 保存 and on nothing else. */
  const [saveCount, setSaveCount] = useState(0);

  const baselineFpRef = useRef<string | null>(null);
  const draftFpRef = useRef<string | null>(null);
  const forceRef = useRef(false);
  const savingRef = useRef(false);
  const probingRef = useRef<Partial<Record<EnterpriseLookupProvider, boolean>>>({});

  const draftFp = fingerprintEnterpriseLookupDraft(draft);
  useEffect(() => {
    draftFpRef.current = draftFp;
  }, [draftFp]);

  const applySnapshot = useCallback((next: EnterpriseLookupDraft, nextRevision: number) => {
    const fp = fingerprintEnterpriseLookupDraft(next);
    baselineFpRef.current = fp;
    draftFpRef.current = fp;
    setDraft(next);
    setBaseRevision(nextRevision);
    setConflict(false);
    setStale(false);
    setShowErrors(false);
  }, []);

  useEffect(() => {
    const decision = decideInfraHydration({
      baselineFp: baselineFpRef.current,
      draftFp: draftFpRef.current,
      force: forceRef.current,
      nextFp: seedFp,
      saving: savingRef.current,
    });
    forceRef.current = false;
    if (decision.action === 'accept') {
      applySnapshot(seedRef.current, view.revision);
      return;
    }
    if (decision.markStale) {
      setStale(true);
      return;
    }
    // Same content, newer CAS token — adopt it so the next save is not rejected against a
    // revision that no longer exists.
    setBaseRevision(view.revision);
  }, [applySnapshot, seedFp, view.revision]);

  const dirty = baselineFpRef.current !== null && draftFp !== baselineFpRef.current;

  const unsavedMessages = useMemo(
    () => ({
      cancelText: t('systemGeneral.unsaved.stay'),
      content: t('systemGeneral.unsaved.description'),
      okText: t('systemGeneral.unsaved.leave'),
      title: t('systemGeneral.unsaved.title'),
    }),
    [t],
  );
  useUnsavedChangesGuard({ enabled: dirty, messages: unsavedMessages });

  /**
   * Every patch is followed by the default-provider rule, so disabling the provider that is
   * currently the default cannot leave the draft in a state the server would refuse.
   */
  const patch = useCallback((next: Partial<EnterpriseLookupDraft>) => {
    setDraft((current) => reconcileEnterpriseLookupDefaultProvider({ ...current, ...next }));
  }, []);

  const validationErrors = useMemo(() => validateEnterpriseLookupDraft(draft), [draft]);
  const errors = useMemo(() => {
    if (!showErrors) return {};
    const resolved: Record<string, string> = {};
    for (const [field, key] of Object.entries(validationErrors)) {
      resolved[field] = t(`systemGeneral.enterpriseLookup.errors.${key}` as never);
    }
    return resolved;
  }, [showErrors, t, validationErrors]);

  const save = useCallback(async () => {
    if (!canOperate || saving || conflict || stale) return;
    setShowErrors(true);
    if (Object.keys(validationErrors).length > 0) {
      toast.error(t('systemGeneral.edit.invalidDraft'));
      return;
    }

    const target = draft;
    setSaving(true);
    savingRef.current = true;
    await runAdminMutation({
      authMethod,
      onError: async (cause) => {
        if (cause instanceof AdminReauthCancelledError) {
          toast.error(t('users.errors.reauthCancelled'));
          return;
        }
        if (cause instanceof AdminReauthBlockedError) {
          toast.error(t('users.errors.reauthBlocked'));
          return;
        }
        const resolved = resolveInfraSaveError(cause);
        if (resolved.conflict) {
          setConflict(true);
          toast.error(t('systemGeneral.conflict.title'));
          return;
        }
        toast.error(t(resolved.messageKey as never));
      },
      run: async () => {
        const result = await service.updateEnterpriseLookupSettings(
          toEnterpriseLookupUpdateInput(target, baseRevision),
        );
        // The write answers with the summary it produced, but the draft is settled from what was
        // actually sent: it is the only place that knows a plaintext key was just replaced.
        applySnapshot(settleEnterpriseLookupDraft(target), result.revision);
        setProbes({});
        setSaveCount((count) => count + 1);
        toast.success(t('systemGeneral.edit.saved'));
        await invalidateAdminEnterpriseLookupSettings();
      },
    });
    savingRef.current = false;
    setSaving(false);
  }, [
    applySnapshot,
    authMethod,
    baseRevision,
    canOperate,
    conflict,
    draft,
    saving,
    service,
    stale,
    t,
    validationErrors,
  ]);

  const reload = useCallback(async () => {
    forceRef.current = true;
    await invalidateAdminEnterpriseLookupSettings();
  }, []);

  /**
   * Probe one provider with the key that is actually in play.
   *
   * An unsaved key wins: the operator typed it to find out whether it works, and probing the
   * stored one instead would answer a question nobody asked. With no key at all the probe is not
   * even sent — the answer is known, and it is not worth a paid round trip.
   */
  const test = useCallback(
    async (provider: EnterpriseLookupProvider) => {
      if (probingRef.current[provider]) return;
      const secret = enterpriseLookupProviderSecret(draft, provider);
      if (secretMissing(secret)) {
        setProbes((current) => ({
          ...current,
          [provider]: { ok: false, reason: 'not_configured' },
        }));
        return;
      }

      probingRef.current = { ...probingRef.current, [provider]: true };
      setProbing((current) => ({ ...current, [provider]: true }));
      try {
        const result = await service.testEnterpriseLookupProvider({
          provider,
          ...(secret.value.length > 0 ? { draft: { apiKey: secret.value } } : {}),
        });
        setProbes((current) => ({ ...current, [provider]: result }));
      } catch {
        // Never surface the upstream error: the card only has to say what to do next.
        setProbes((current) => ({ ...current, [provider]: { ok: false, reason: 'unreachable' } }));
      } finally {
        probingRef.current = { ...probingRef.current, [provider]: false };
        setProbing((current) => ({ ...current, [provider]: false }));
      }
    },
    [draft, service],
  );

  /**
   * Opening and discarding do the same thing: take the CURRENT server snapshot, not the baseline
   * the last draft started from. While a draft was dirty a newer snapshot may have arrived and been
   * parked as `stale`; restoring that baseline would show values the server no longer holds, still
   * behind a reload banner, over an edit nobody is making any more.
   */
  const resetToSnapshot = useCallback(() => {
    setProbes({});
    applySnapshot(seedRef.current, view.revision);
  }, [applySnapshot, view.revision]);

  return {
    beginEdit: resetToSnapshot,
    cancelEdit: resetToSnapshot,
    conflict,
    dirty,
    draft,
    errors,
    invalid: Object.keys(validationErrors).length > 0 && showErrors,
    patch,
    probes,
    probing,
    reload,
    save,
    saveCount,
    saving,
    stale,
    test,
  };
};

export type EnterpriseLookupEditor = ReturnType<typeof useEnterpriseLookupEditor>;
