'use client';

import { Button, InputPassword } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { InfraField } from '@/enterprise/client/features/admin/systemGeneral/infra/InfraField';
import { infraFormStyles } from '@/enterprise/client/features/admin/systemGeneral/infra/styles';

import type { AlertCredentialDraft } from './draft';

export interface CredentialFieldProps {
  disabled?: boolean;
  error?: string;
  /** Static guidance behind the "?" next to the label. */
  hint?: string;
  label: string;
  maxLength: number;
  onChange: (next: AlertCredentialDraft) => void;
  /** Placeholder while nothing is stored (e.g. the webhook URL format). */
  placeholder?: string;
  /** Masked description of what is stored (never the credential itself). */
  storedHint?: string | null;
  value: AlertCredentialDraft;
}

/**
 * Write-only credential input for the alert channels (robot webhook, signing secret).
 *
 * The server never returns the value, so the three intents are explicit: blank keeps what is
 * stored, typing replaces it, and 清除 removes it. The input is masked so a replaced value is not
 * left readable on screen either.
 */
export const CredentialField = memo<CredentialFieldProps>(
  ({ disabled, error, hint, label, maxLength, onChange, placeholder, storedHint, value }) => {
    const { t } = useTranslation('admin');
    const keeping = value.stored && !value.cleared;
    const note = value.cleared
      ? t('systemGeneral.secret.clearedHint')
      : keeping && storedHint
        ? t('system.alerts.credential.stored', { hint: storedHint })
        : undefined;

    return (
      <InfraField error={error} hint={hint} label={label} note={note}>
        {(field) => (
          <div className={infraFormStyles.actions}>
            <InputPassword
              {...field.control}
              autoComplete="new-password"
              disabled={disabled || value.cleared}
              maxLength={maxLength}
              placeholder={keeping ? t('systemGeneral.secret.storedPlaceholder') : placeholder}
              style={{ flex: 1, minWidth: 160 }}
              value={value.value}
              onChange={(event) =>
                onChange({ ...value, cleared: false, value: event.target.value })
              }
            />
            {value.stored ? (
              <Button
                disabled={disabled}
                size="small"
                onClick={() =>
                  onChange(
                    value.cleared
                      ? { ...value, cleared: false }
                      : { ...value, cleared: true, value: '' },
                  )
                }
              >
                {t(value.cleared ? 'systemGeneral.secret.undoClear' : 'systemGeneral.secret.clear')}
              </Button>
            ) : null}
          </div>
        )}
      </InfraField>
    );
  },
);

CredentialField.displayName = 'AdminSystemAlertCredentialField';
