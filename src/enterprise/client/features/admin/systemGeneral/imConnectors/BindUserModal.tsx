'use client';

import { Alert, Button, Input, Modal, toast } from '@lobehub/ui/base-ui';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PLATFORM_PERMISSIONS } from '@/const/platform/permissions';
import { useAdminAccess } from '@/enterprise/client/providers/AdminAccessProvider';
import type { ImConnectorPlatform } from '@/enterprise/client/services/adminImConnectors';

import { runAdminMutation } from '../../primitives/runAdminMutation';
import UserSearchSelect from '../../primitives/UserSearchSelect';
import { InfraField } from '../infra/InfraField';
import { infraFormStyles as formStyles } from '../infra/styles';
import {
  displayBindingUserLabel,
  emptyImConnectorBindingDraft,
  type ImConnectorBindingConflict,
  type ImConnectorBindingDraft,
  readImConnectorBindingConflict,
  toImConnectorBindingUpsertInput,
  validateImConnectorBindingDraft,
} from './bindings';
import type { ImConnectorBindingsService } from './service';

const ERROR_KEYS: Record<string, string> = {
  required: 'systemGeneral.errors.required',
  tooLong: 'systemGeneral.errors.tooLong',
};

export interface BindUserModalProps {
  onBound: () => Promise<void> | void;
  onClose: () => void;
  open: boolean;
  platform: ImConnectorPlatform;
  service: ImConnectorBindingsService;
}

/**
 * 绑定用户 — bind one DingTalk corp user to an AIHub account by hand.
 *
 * The automatic link only happens for accounts that signed in through DingTalk, so an account that
 * never did (a local or break-glass one, most of all) can only reach DingTalk reminders through
 * this modal.
 *
 * A DingTalk user already bound elsewhere is reported inline rather than as a toast: the admin's
 * next move is about the OTHER account, so the modal keeps the draft and offers 改绑, which drops
 * that binding and retries this one in a single confirmation.
 */
export const BindUserModal = memo<BindUserModalProps>(
  ({ onBound, onClose, open, platform, service }) => {
    const { t } = useTranslation('admin');
    const { authMethod, permissions } = useAdminAccess();
    const [draft, setDraft] = useState<ImConnectorBindingDraft>(emptyImConnectorBindingDraft);
    const [showErrors, setShowErrors] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [conflict, setConflict] = useState<ImConnectorBindingConflict | null>(null);
    // State lags a click; the ref is what keeps a double-click from writing the row twice.
    const submittingRef = useRef(false);

    // A reopened modal starts from nothing: the previous binding was either written or abandoned,
    // and a leftover DingTalk id is the one value that would silently bind the wrong person.
    useEffect(() => {
      if (!open) return;
      setDraft(emptyImConnectorBindingDraft());
      setShowErrors(false);
      setConflict(null);
    }, [open]);

    const validationErrors = validateImConnectorBindingDraft(draft);
    const errors = showErrors
      ? Object.fromEntries(
          Object.entries(validationErrors).map(([field, key]) => [
            field,
            t((ERROR_KEYS[key] ?? 'systemGeneral.errors.required') as never),
          ]),
        )
      : {};

    const patch = useCallback((next: Partial<ImConnectorBindingDraft>) => {
      setDraft((current) => ({ ...current, ...next }));
      // The conflict belongs to the DingTalk id that was submitted; editing anything invalidates it.
      setConflict(null);
    }, []);

    /**
     * @param unbindUserId - The account whose binding is dropped first (改绑). Leaving it out is
     *   the plain bind: the server rejects a DingTalk user that already belongs to someone else.
     */
    const submit = useCallback(
      async (unbindUserId?: string) => {
        if (submittingRef.current) return;
        setShowErrors(true);
        if (Object.keys(validateImConnectorBindingDraft(draft)).length > 0) {
          toast.error(t('systemGeneral.edit.invalidDraft'));
          return;
        }

        submittingRef.current = true;
        setSubmitting(true);
        try {
          const committed = await runAdminMutation({
            authMethod,
            onError: (error) => {
              const nextConflict = readImConnectorBindingConflict(error);
              if (nextConflict) {
                setConflict(nextConflict);
                return;
              }
              toast.error(t('systemGeneral.imConnectors.bindings.bindFailed'));
            },
            run: async () => {
              if (unbindUserId) await service.removeBinding({ platform, userId: unbindUserId });
              await service.upsertBinding(toImConnectorBindingUpsertInput(platform, draft));
            },
          });
          if (!committed) return;

          setConflict(null);
          toast.success(t('systemGeneral.imConnectors.bindings.bound'));
          // The write has committed; a refresh that fails afterwards is a stale reading, not a
          // failed bind, so it must not reach the error surface.
          try {
            await onBound();
          } catch {
            /* the next revalidation catches the list up */
          }
          onClose();
        } finally {
          submittingRef.current = false;
          setSubmitting(false);
        }
      },
      [authMethod, draft, onBound, onClose, platform, service, t],
    );

    const conflictName = conflict
      ? displayBindingUserLabel(
          conflict.boundUserName,
          conflict.boundUserEmail,
          conflict.boundUserId,
        )
      : '';

    return (
      <Modal
        cancelText={t('systemGeneral.edit.cancel')}
        confirmLoading={submitting}
        okText={t('systemGeneral.imConnectors.bindings.submit')}
        open={open}
        title={t('systemGeneral.imConnectors.bindings.bind')}
        onCancel={onClose}
        onOk={() => void submit()}
      >
        <div className={formStyles.stack}>
          {conflict ? (
            <Alert
              showIcon
              title={t('systemGeneral.imConnectors.bindings.conflictTitle')}
              type="error"
              action={
                <Button
                  loading={submitting}
                  size="small"
                  onClick={() => void submit(conflict.boundUserId)}
                >
                  {t('systemGeneral.imConnectors.bindings.rebind')}
                </Button>
              }
              description={t('systemGeneral.imConnectors.bindings.conflict', {
                name: conflictName,
              })}
            />
          ) : null}

          <InfraField
            error={errors.userId}
            label={t('systemGeneral.imConnectors.bindings.fields.user')}
            note={t('systemGeneral.imConnectors.bindings.hints.user')}
          >
            {(field) => (
              <UserSearchSelect
                allowRawId
                aria-label={t('systemGeneral.imConnectors.bindings.fields.user')}
                disabled={submitting}
                enabled={permissions.includes(PLATFORM_PERMISSIONS.USER_READ)}
                id={field.control.id}
                userId={draft.userId || undefined}
                onChange={(userId) => patch({ userId: userId ?? '' })}
              />
            )}
          </InfraField>

          <InfraField
            error={errors.platformUserId}
            label={t('systemGeneral.imConnectors.bindings.fields.platformUserId')}
            note={t('systemGeneral.imConnectors.bindings.hints.platformUserId')}
          >
            {(field) => (
              <Input
                {...field.control}
                autoComplete="off"
                disabled={submitting}
                value={draft.platformUserId}
                onChange={(event) => patch({ platformUserId: event.target.value })}
              />
            )}
          </InfraField>

          <InfraField
            error={errors.platformUsername}
            label={t('systemGeneral.imConnectors.bindings.fields.platformUsername')}
            note={t('systemGeneral.imConnectors.bindings.hints.platformUsername')}
          >
            {(field) => (
              <Input
                {...field.control}
                autoComplete="off"
                disabled={submitting}
                value={draft.platformUsername}
                onChange={(event) => patch({ platformUsername: event.target.value })}
              />
            )}
          </InfraField>
        </div>
      </Modal>
    );
  },
);

BindUserModal.displayName = 'AdminImConnectorBindUserModal';
