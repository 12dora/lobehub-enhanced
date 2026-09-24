'use client';

import { Input, Tag } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { InfraField } from '../infra/InfraField';
import { ConnectorSecretField } from './ConnectorSecretField';
import { ConnectorSection } from './ConnectorSection';
import type { DingTalkConnectorDraft } from './draft';
import { imConnectorStyles as styles } from './styles';

export interface CredentialsSectionProps {
  /** The CorpId the worker captured — the input's placeholder once it is emptied. */
  corpIdFallback: string | null;
  /** The CorpId input shows the id the worker captured, not a stored one (tag 自动获取). */
  corpIdPrefilled: boolean;
  /** The card is saving (or the admin cannot write): the fields follow the rest of the form. */
  disabled: boolean;
  draft: DingTalkConnectorDraft;
  /** Field name → resolved message, from the card's own validation pass. */
  errors: Record<string, string>;
  onPatch: (next: Partial<DingTalkConnectorDraft>) => void;
  /** What the robot is called when 机器人名称 is left empty — shown as the placeholder only. */
  robotNameFallback: string;
}

/**
 * 连接凭据 — what makes the Stream robot exist. Every other group depends on it, so it comes first.
 */
export const CredentialsSection = memo<CredentialsSectionProps>(
  ({ corpIdFallback, corpIdPrefilled, disabled, draft, errors, onPatch, robotNameFallback }) => {
    const { t } = useTranslation('admin');

    return (
      <ConnectorSection
        help={t('systemGeneral.imConnectors.hints.credentials')}
        title={t('systemGeneral.imConnectors.sections.credentials')}
      >
        <div className={styles.fieldGrid}>
          <InfraField
            error={errors.clientId}
            label={t('systemGeneral.imConnectors.fields.clientId')}
          >
            {(field) => (
              <Input
                {...field.control}
                autoComplete="off"
                disabled={disabled}
                value={draft.clientId}
                onChange={(event) => onPatch({ clientId: event.target.value })}
              />
            )}
          </InfraField>
          <ConnectorSecretField
            disabled={disabled}
            error={errors.clientSecret}
            label={t('systemGeneral.imConnectors.fields.clientSecret')}
            value={draft.clientSecret}
            onChange={(next) => onPatch({ clientSecret: next })}
          />
          <InfraField
            error={errors.robotCode}
            hint={t('systemGeneral.imConnectors.hints.robotCode')}
            label={t('systemGeneral.imConnectors.fields.robotCode')}
          >
            {(field) => (
              <Input
                {...field.control}
                autoComplete="off"
                disabled={disabled}
                value={draft.robotCode}
                onChange={(event) => onPatch({ robotCode: event.target.value })}
              />
            )}
          </InfraField>
          <InfraField
            error={errors.corpId}
            hint={t('systemGeneral.imConnectors.hints.corpId')}
            label={t('systemGeneral.imConnectors.fields.corpId')}
            labelExtra={
              corpIdPrefilled ? (
                <Tag size="small">{t('systemGeneral.imConnectors.prefill.auto')}</Tag>
              ) : undefined
            }
          >
            {(field) => (
              <Input
                {...field.control}
                autoComplete="off"
                disabled={disabled}
                // Emptied, the input still says what is in force: the captured id.
                placeholder={corpIdFallback ?? undefined}
                value={draft.corpId}
                onChange={(event) => onPatch({ corpId: event.target.value })}
              />
            )}
          </InfraField>
          <InfraField
            error={errors.agentId}
            hint={t('systemGeneral.imConnectors.hints.agentId')}
            label={t('systemGeneral.imConnectors.fields.agentId')}
          >
            {(field) => (
              <Input
                {...field.control}
                autoComplete="off"
                disabled={disabled}
                value={draft.agentId}
                onChange={(event) => onPatch({ agentId: event.target.value })}
              />
            )}
          </InfraField>
          <InfraField
            error={errors.robotDisplayName}
            hint={t('systemGeneral.imConnectors.hints.robotDisplayName')}
            label={t('systemGeneral.imConnectors.fields.robotDisplayName')}
          >
            {(field) => (
              <Input
                {...field.control}
                autoComplete="off"
                disabled={disabled}
                maxLength={32}
                // The fallback is what employees see while this is empty; it is never written into
                // the field, so「未设置」 stays distinguishable from a saved name.
                placeholder={robotNameFallback || undefined}
                value={draft.robotDisplayName}
                onChange={(event) => onPatch({ robotDisplayName: event.target.value })}
              />
            )}
          </InfraField>
        </div>
      </ConnectorSection>
    );
  },
);

CredentialsSection.displayName = 'AdminImConnectorCredentialsSection';
