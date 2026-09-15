'use client';

import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAdminAccess } from '@/enterprise/client/providers/AdminAccessProvider';
import type {
  AdminImConnectorTestOutput,
  AdminImConnectorView,
} from '@/enterprise/client/services/adminImConnectors';

import { runAdminMutation } from '../../primitives/runAdminMutation';
import { useUnsavedChangesGuard } from '../../primitives/useUnsavedChangesGuard';
import {
  type DingTalkConnectorDraft,
  fingerprintDingTalkDraft,
  settleDingTalkDraft,
  toDingTalkDraft,
  toDingTalkTestInput,
  toDingTalkUpsertInput,
  validateDingTalkDraft,
} from './draft';
import { type ImConnectorMutationService, imConnectorMutationService } from './service';

export interface UseImConnectorEditorParams {
  /** SYSTEM_OPERATE — without it the card is a read-only reading of the connector. */
  canOperate: boolean;
  /** Refresh the list so the header, stats and fingerprint come from the server's own answer. */
  onSaved?: (view: AdminImConnectorView) => Promise<void> | void;
  /** Injectable for tests. */
  service?: ImConnectorMutationService;
  view: AdminImConnectorView;
}

export interface ImConnectorEditor {
  cancel: () => void;
  dirty: boolean;
  draft: DingTalkConnectorDraft;
  /** Field name → resolved message; only populated after a save attempt. */
  errors: Record<string, string>;
  patch: (next: Partial<DingTalkConnectorDraft>) => void;
  save: () => Promise<void>;
  saving: boolean;
  test: () => Promise<void>;
  testing: boolean;
  testResult?: AdminImConnectorTestOutput;
}

const ERROR_KEYS: Record<string, string> = {
  idleHours: 'systemGeneral.imConnectors.errors.idleHours',
  required: 'systemGeneral.errors.required',
  tooLong: 'systemGeneral.errors.tooLong',
};

/**
 * Editing state for one IM connector card.
 *
 * The card edits inline rather than behind a modal, so the server snapshot keeps arriving while an
 * admin types: a fresh snapshot is only adopted while the draft is clean, which keeps a background
 * revalidation from wiping half-entered credentials. There is no CAS token on this row — the write
 * is a whole-row upsert — so the only recovery a save needs is the toast plus the refreshed list.
 */
export const useImConnectorEditor = ({
  canOperate,
  onSaved,
  service = imConnectorMutationService,
  view,
}: UseImConnectorEditorParams): ImConnectorEditor => {
  const { t } = useTranslation('admin');
  const { authMethod } = useAdminAccess();

  const seed = useMemo(() => toDingTalkDraft(view), [view]);
  const seedFp = fingerprintDingTalkDraft(seed);
  const seedRef = useRef(seed);
  seedRef.current = seed;

  const [draft, setDraft] = useState<DingTalkConnectorDraft>(seed);
  const [baselineFp, setBaselineFp] = useState(seedFp);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  // State lags a click; the ref is what keeps a double-click from writing the row twice.
  const savingRef = useRef(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AdminImConnectorTestOutput | undefined>();

  const draftFp = fingerprintDingTalkDraft(draft);
  const dirty = draftFp !== baselineFp;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // A background revalidation must never overwrite what is being typed; a clean card follows the
  // server so a change made elsewhere (or by this card's own save) shows up without a reload.
  useEffect(() => {
    if (dirtyRef.current) return;
    setDraft(seedRef.current);
    setBaselineFp(seedFp);
    setShowErrors(false);
  }, [seedFp]);

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

  const patch = useCallback((next: Partial<DingTalkConnectorDraft>) => {
    setDraft((current) => ({ ...current, ...next }));
  }, []);

  const validationErrors = useMemo(() => validateDingTalkDraft(draft), [draft]);

  const errors = useMemo(() => {
    if (!showErrors) return {};
    const resolved: Record<string, string> = {};
    for (const [field, key] of Object.entries(validationErrors)) {
      resolved[field] = t((ERROR_KEYS[key] ?? 'systemGeneral.errors.required') as never);
    }
    return resolved;
  }, [showErrors, t, validationErrors]);

  const cancel = useCallback(() => {
    setDraft(seedRef.current);
    setBaselineFp(fingerprintDingTalkDraft(seedRef.current));
    setShowErrors(false);
    setTestResult(undefined);
  }, []);

  const save = useCallback(async () => {
    if (!canOperate || savingRef.current) return;
    setShowErrors(true);
    if (Object.keys(validationErrors).length > 0) {
      toast.error(t('systemGeneral.edit.invalidDraft'));
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      await runAdminMutation({
        authMethod,
        mapErrorKey: () => 'systemGeneral.edit.saveFailed',
        run: async () => {
          const saved = await service.upsert(toDingTalkUpsertInput(draft));
          // The plaintext leaves memory the moment the server has it, and the secret's identity
          // comes from the row that was just written rather than from the next list read.
          const settled = settleDingTalkDraft(draft, saved);
          setDraft(settled);
          setBaselineFp(fingerprintDingTalkDraft(settled));
          setShowErrors(false);
          // The write has committed. A refresh that fails afterwards is a stale reading, not a
          // failed save, so it must not reach the mutation's error toast.
          try {
            await onSaved?.(saved);
          } catch {
            /* keep the saved state; the next revalidation will catch the card up */
          }
          toast.success(t('systemGeneral.imConnectors.saved'));
        },
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [authMethod, canOperate, draft, onSaved, service, t, validationErrors]);

  /**
   * The probe runs against the draft, not the saved row: credentials are verified before they are
   * written. Fields left empty are omitted so a stored secret can be re-tested as it is.
   */
  const test = useCallback(async () => {
    if (!canOperate || testing) return;
    setTesting(true);
    try {
      setTestResult(await service.test(toDingTalkTestInput(draft)));
    } catch {
      setTestResult({
        errorCode: 'unknown',
        errorMessage: null,
        latencyMs: null,
        ok: false,
        robotName: null,
      });
    } finally {
      setTesting(false);
    }
  }, [canOperate, draft, service, testing]);

  return { cancel, dirty, draft, errors, patch, save, saving, test, testResult, testing };
};
