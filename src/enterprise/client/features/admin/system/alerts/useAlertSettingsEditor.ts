'use client';

import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { runAdminMutation } from '@/enterprise/client/features/admin/primitives/runAdminMutation';
import {
  AdminReauthBlockedError,
  AdminReauthCancelledError,
} from '@/enterprise/client/features/admin/reauth/requestAdminReauth';
import { isAdminSystemConflictError } from '@/enterprise/client/features/admin/system/controller';
import { useAdminAccess } from '@/enterprise/client/providers/AdminAccessProvider';
import type {
  AdminStatusAlertChannel,
  AdminStatusAlertsService,
  AdminStatusAlertsView,
  AdminStatusAlertTestResult,
} from '@/enterprise/client/services/adminSystem';
import { useClientDataSWR } from '@/libs/swr';

import { buildAdminSystemAlertsKey } from '../swrKeys';
import {
  alertConfigFingerprint,
  type AlertDraftErrors,
  type AlertDraftField,
  alertDraftFingerprint,
  type AlertSettingsDraft,
  draftFromView,
  mergeAlertDraft,
  toAlertsUpdateInput,
  validateAlertDraft,
} from './draft';
import { resolveAlertSaveError } from './serverErrors';

export type AlertChannelTestState =
  { status: 'pending' } | { result: AdminStatusAlertTestResult; status: 'done' };

/**
 * Why a channel's 「发送测试」 is not available right now — each cause gets its own hint.
 * `null` means the test can run.
 */
export type AlertTestBlock = 'pending' | 'readOnly' | 'storedOff' | 'unavailable' | 'unsaved';

export interface AlertSettingsEditor {
  /** Channel is switched on in the STORED settings and the form has nothing unsaved. */
  canTest: (channel: AdminStatusAlertChannel) => boolean;
  dirty: boolean;
  draft: AlertSettingsDraft | null;
  /** Field → error key; empty until the first save attempt. */
  errors: AlertDraftErrors;
  /** Field → the server's own message from a rejected save; cleared by the next edit. */
  fieldMessages: Partial<Record<AlertDraftField, string>>;
  loadError: unknown;
  patch: (update: (draft: AlertSettingsDraft) => AlertSettingsDraft) => void;
  reload: () => Promise<void>;
  /** Drop unsaved edits and test results (Cancel / close). */
  reset: () => void;
  save: () => Promise<boolean>;
  saving: boolean;
  test: (channel: AdminStatusAlertChannel) => Promise<void>;
  testBlock: (channel: AdminStatusAlertChannel) => AlertTestBlock | null;
  tests: Partial<Record<AdminStatusAlertChannel, AlertChannelTestState>>;
  view?: AdminStatusAlertsView;
}

export interface UseAlertSettingsEditorParams {
  canOperate: boolean;
  /** Drawer open and SYSTEM_READ granted. */
  enabled: boolean;
  service: AdminStatusAlertsService;
}

const FAILED_TEST: AdminStatusAlertTestResult = { delivered: 0, error: null, ok: false };

/** A channel whose delivery backend is missing cannot be switched on or tested. */
export const isAlertChannelAvailable = (
  view: AdminStatusAlertsView,
  channel: AdminStatusAlertChannel,
): boolean => {
  if (channel === 'workNotice') return view.notifyAppConfigured;
  if (channel === 'email') return view.mailConfigured;
  return true;
};

/**
 * Editing state for 告警设置 → 告警.
 *
 * The draft is seeded from the server view and survives background revalidation while it has
 * unsaved edits. Saves are CAS'd against the revision the draft was seeded from:
 * - a newer revision that changed nothing on this form (token rotate / revoke, jobs 清除) is
 *   adopted silently, without touching the edits;
 * - a real concurrent edit is merged three-way — the operator's changes on top of the newer
 *   settings — and left for them to review before saving again.
 */
export const useAlertSettingsEditor = ({
  canOperate,
  enabled,
  service,
}: UseAlertSettingsEditorParams): AlertSettingsEditor => {
  const { t } = useTranslation('admin');
  const { authMethod } = useAdminAccess();
  const query = useClientDataSWR(
    buildAdminSystemAlertsKey(enabled),
    () => service.getAlertSettings(),
    { revalidateOnFocus: false },
  );
  const view = query.data as AdminStatusAlertsView | undefined;

  const [draft, setDraft] = useState<AlertSettingsDraft | null>(null);
  const [baselineFp, setBaselineFp] = useState<string | null>(null);
  const [baseRevision, setBaseRevision] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [fieldMessages, setFieldMessages] = useState<AlertSettingsEditor['fieldMessages']>({});
  const [saving, setSaving] = useState(false);
  const [tests, setTests] = useState<AlertSettingsEditor['tests']>({});

  const draftFp = draft ? alertDraftFingerprint(draft) : null;
  const dirty = draftFp !== null && baselineFp !== null && draftFp !== baselineFp;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  /** The server snapshot the draft was seeded from — the common ancestor for a merge. */
  const baseViewRef = useRef<AdminStatusAlertsView | null>(null);
  const forceSeedRef = useRef(false);
  const savingRef = useRef(false);

  /** Replace the draft with a server snapshot (first load, after a save, Cancel). */
  const applyView = useCallback((next: AdminStatusAlertsView) => {
    const seeded = draftFromView(next);
    baseViewRef.current = next;
    setDraft(seeded);
    setBaselineFp(alertDraftFingerprint(seeded));
    setBaseRevision(next.revision);
    setShowErrors(false);
    setFieldMessages({});
  }, []);

  /** Three-way merge of the operator's edits onto a newer snapshot (see `mergeAlertDraft`). */
  const mergeOnto = useCallback((next: AdminStatusAlertsView) => {
    const baseView = baseViewRef.current ?? next;
    const current = draftRef.current ?? draftFromView(next);
    const merged = mergeAlertDraft(draftFromView(baseView), current, next);
    baseViewRef.current = next;
    setDraft(merged);
    setBaselineFp(alertDraftFingerprint(draftFromView(next)));
    setBaseRevision(next.revision);
  }, []);

  /** True when `next` differs from the draft's base only in columns this form does not edit. */
  const sameConfigAsBase = useCallback((next: AdminStatusAlertsView) => {
    const baseView = baseViewRef.current;
    return baseView !== null && alertConfigFingerprint(baseView) === alertConfigFingerprint(next);
  }, []);

  // Adopt every new server snapshot unless it would wipe edits the operator has not saved. With
  // edits pending, a revision that changed nothing on this form (token / jobs watermark writes)
  // only moves the CAS base, so the next save is not rejected for someone else's non-edit.
  useEffect(() => {
    if (!view) return;
    if (!dirtyRef.current || forceSeedRef.current) {
      forceSeedRef.current = false;
      applyView(view);
      return;
    }
    if (sameConfigAsBase(view)) {
      baseViewRef.current = view;
      setBaseRevision(view.revision);
    }
  }, [applyView, sameConfigAsBase, view]);

  const validation = useMemo(() => (draft ? validateAlertDraft(draft) : {}), [draft]);
  const errors = showErrors ? validation : {};

  const patch = useCallback((update: (current: AlertSettingsDraft) => AlertSettingsDraft) => {
    setDraft((current) => (current ? update(current) : current));
    setFieldMessages({});
  }, []);

  const mutateQuery = query.mutate;
  const reload = useCallback(async () => {
    forceSeedRef.current = true;
    const fresh = (await mutateQuery()) as AdminStatusAlertsView | undefined;
    // Same content → SWR keeps the old object and the effect never fires; seed explicitly.
    if (fresh && forceSeedRef.current) {
      forceSeedRef.current = false;
      applyView(fresh);
    }
  }, [applyView, mutateQuery]);

  const reset = useCallback(() => {
    if (view) applyView(view);
    setTests({});
  }, [applyView, view]);

  /**
   * The CAS write. On a conflict whose newer revision changed nothing on this form, it retries
   * once against that revision; on a real concurrent edit it merges and asks for a review.
   */
  const submit = useCallback(
    async (target: AlertSettingsDraft, revision: number): Promise<boolean> => {
      const attempt = async (expectedRevision: number, allowRetry: boolean): Promise<boolean> => {
        const retry: { view: AdminStatusAlertsView | null } = { view: null };
        const committed = await runAdminMutation({
          authMethod,
          onError: async (error) => {
            if (error instanceof AdminReauthCancelledError) {
              toast.error(t('users.errors.reauthCancelled'));
              return;
            }
            if (error instanceof AdminReauthBlockedError) {
              toast.error(t('users.errors.reauthBlocked'));
              return;
            }
            if (isAdminSystemConflictError(error)) {
              let fresh: AdminStatusAlertsView | undefined;
              try {
                fresh = (await mutateQuery()) as AdminStatusAlertsView | undefined;
              } catch (reloadError) {
                console.error('[admin.system] failed to reload alert settings', reloadError);
              }
              if (fresh && allowRetry && sameConfigAsBase(fresh)) {
                retry.view = fresh;
                return;
              }
              // Someone else really changed these settings: keep only what this operator
              // edited, on top of their version, and let the operator review before saving.
              toast.error(t('system.alerts.toast.conflict'));
              if (fresh) mergeOnto(fresh);
              return;
            }
            console.error('[admin.system] failed to save alert settings', error);
            const resolved = resolveAlertSaveError(error);
            if (resolved.field && resolved.message) {
              setFieldMessages({ [resolved.field]: resolved.message });
            }
            toast.error(resolved.message ?? t('system.alerts.toast.saveFailed'));
          },
          run: async () => {
            const next = await service.updateAlertSettings(
              toAlertsUpdateInput(target, expectedRevision),
            );
            applyView(next);
            setTests({});
            await mutateQuery(next, { revalidate: false });
            toast.success(t('system.alerts.toast.saved'));
          },
        });
        if (!retry.view) return committed;
        // Only columns this form does not edit moved (e.g. a token was generated): same edits,
        // newer revision.
        baseViewRef.current = retry.view;
        setBaseRevision(retry.view.revision);
        return attempt(retry.view.revision, false);
      };
      return attempt(revision, true);
    },
    [applyView, authMethod, mergeOnto, mutateQuery, sameConfigAsBase, service, t],
  );

  const save = useCallback(async () => {
    if (!canOperate || !draft || !view || savingRef.current) return false;
    setShowErrors(true);
    if (Object.keys(validateAlertDraft(draft)).length > 0) {
      toast.error(t('system.alerts.errors.invalid'));
      return false;
    }
    savingRef.current = true;
    setSaving(true);
    setFieldMessages({});
    try {
      return await submit(draft, baseRevision);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [baseRevision, canOperate, draft, submit, t, view]);

  const testBlock = useCallback(
    (channel: AdminStatusAlertChannel): AlertTestBlock | null => {
      if (!canOperate || !view) return 'readOnly';
      if (!isAlertChannelAvailable(view, channel)) return 'unavailable';
      if (!view.settings.channels[channel].enabled) return 'storedOff';
      if (dirty) return 'unsaved';
      if (tests[channel]?.status === 'pending') return 'pending';
      return null;
    },
    [canOperate, dirty, tests, view],
  );

  const canTest = useCallback(
    (channel: AdminStatusAlertChannel) => testBlock(channel) === null,
    [testBlock],
  );

  const test = useCallback(
    async (channel: AdminStatusAlertChannel) => {
      if (!canTest(channel)) return;
      setTests((current) => ({ ...current, [channel]: { status: 'pending' } }));
      let result: AdminStatusAlertTestResult = FAILED_TEST;
      await runAdminMutation({
        authMethod,
        onError: (error) => {
          console.error('[admin.system] alert channel test failed', error);
        },
        run: async () => {
          result = await service.testAlertChannel({ channel });
        },
      });
      setTests((current) => ({ ...current, [channel]: { result, status: 'done' } }));
    },
    [authMethod, canTest, service],
  );

  return {
    canTest,
    dirty,
    draft,
    errors,
    fieldMessages,
    loadError: view ? undefined : query.error,
    patch,
    reload,
    reset,
    save,
    saving,
    test,
    testBlock,
    tests,
    view,
  };
};
