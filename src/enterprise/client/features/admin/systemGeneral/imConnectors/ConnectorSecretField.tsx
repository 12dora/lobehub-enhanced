'use client';

import { InputPassword } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { InfraField } from '../infra/InfraField';
import type { ImConnectorSecretDraft } from './draft';

export interface ConnectorSecretFieldProps {
  disabled?: boolean;
  error?: string;
  hint?: string;
  label: string;
  onChange: (next: ImConnectorSecretDraft) => void;
  /** Override the 已保存 placeholder — the notification app's secret has its own wording. */
  storedPlaceholder?: string;
  value: ImConnectorSecretDraft;
  wide?: boolean;
}

/**
 * Write-only credential input for an IM connector.
 *
 * The connector contract knows two intents only — keep what is stored, or replace it — because a
 * connector row without a secret cannot exist; there is deliberately no 清除 action to offer. The
 * stored secret is identified by its fingerprint so an admin can tell one credential from another
 * without the server ever echoing the value.
 */
export const ConnectorSecretField = memo<ConnectorSecretFieldProps>(
  ({ disabled, error, hint, label, onChange, storedPlaceholder, value, wide }) => {
    const { t } = useTranslation('admin');

    return (
      <InfraField
        error={error}
        hint={hint}
        label={label}
        wide={wide}
        note={
          value.stored && value.fingerprint
            ? t('systemGeneral.imConnectors.secret.stored', { fingerprint: value.fingerprint })
            : undefined
        }
      >
        {(field) => (
          <InputPassword
            {...field.control}
            autoComplete="new-password"
            disabled={disabled}
            value={value.value}
            placeholder={
              value.stored
                ? (storedPlaceholder ?? t('systemGeneral.secret.storedPlaceholder'))
                : t('systemGeneral.secret.enterPlaceholder')
            }
            onChange={(event) => onChange({ ...value, value: event.target.value })}
          />
        )}
      </InfraField>
    );
  },
);

ConnectorSecretField.displayName = 'AdminImConnectorSecretField';
