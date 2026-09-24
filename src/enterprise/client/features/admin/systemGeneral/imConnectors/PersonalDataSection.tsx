'use client';

import { DINGTALK_CONSOLE_LINKS } from '@lobechat/utils/appLink';
import { Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import ActionLink from '@/components/ActionLink';

import { InfraSwitchRow } from '../infra/InfraField';
import { infraFormStyles as formStyles } from '../infra/styles';
import type { DingTalkConnectorDraft, DingTalkPersonalSummary } from './draft';
import { imConnectorStyles as styles } from './styles';

export interface PersonalDataSectionProps {
  /** The card is saving (or the admin cannot write): the switches follow the rest of the form. */
  disabled: boolean;
  draft: DingTalkConnectorDraft;
  onPatch: (next: Partial<DingTalkConnectorDraft>) => void;
  /** Sidecar presence and the authorized-member count; `null` when the server did not say. */
  summary: DingTalkPersonalSummary | null;
}

/**
 * 钉钉个人数据 — each member authorizes, once, the assistant to read their own to-dos, group
 * messages and work reports through the `aihub-dws` sidecar.
 *
 * The five fields belong to the connector row and are written by the card's own 保存, like the
 * workspace block above. The master switch gates the four scopes: with it off they cannot take
 * effect, so they are shown as they are stored but cannot be changed.
 */
export const PersonalDataSection = memo<PersonalDataSectionProps>(
  ({ disabled, draft, onPatch, summary }) => {
    const { t } = useTranslation('admin');
    const scopesLocked = disabled || !draft.personalDataEnabled;

    return (
      <div className={styles.section}>
        <span className={styles.sectionTitle}>
          {t('systemGeneral.imConnectors.personal.title')}
        </span>
        <span className={formStyles.hint}>
          {/* The CLI switch lives in the DingTalk console, not here: one click to the exact page. */}
          <Trans
            components={{ cli: <ActionLink href={DINGTALK_CONSOLE_LINKS.cliSettings} /> }}
            i18nKey={'systemGeneral.imConnectors.personal.description'}
            ns={'admin'}
          />
        </span>

        {/* Said whatever the switch says: saving it on without the sidecar would look like it
            worked while nothing does. */}
        {summary && !summary.brokerConfigured ? (
          <Text type={'warning'}>{t('systemGeneral.imConnectors.personal.brokerMissing')}</Text>
        ) : null}

        <div className={formStyles.fieldGrid}>
          <InfraSwitchRow
            checked={draft.personalDataEnabled}
            disabled={disabled}
            label={t('systemGeneral.imConnectors.personal.fields.enabled')}
            onChange={(checked) => onPatch({ personalDataEnabled: checked })}
          />
          <InfraSwitchRow
            checked={draft.personalTodoEnabled}
            disabled={scopesLocked}
            label={t('systemGeneral.imConnectors.personal.fields.todo')}
            onChange={(checked) => onPatch({ personalTodoEnabled: checked })}
          />
          <InfraSwitchRow
            checked={draft.personalChatEnabled}
            disabled={scopesLocked}
            label={t('systemGeneral.imConnectors.personal.fields.chat')}
            onChange={(checked) => onPatch({ personalChatEnabled: checked })}
          />
          <InfraSwitchRow
            checked={draft.personalReportEnabled}
            disabled={scopesLocked}
            label={t('systemGeneral.imConnectors.personal.fields.report')}
            onChange={(checked) => onPatch({ personalReportEnabled: checked })}
          />
          <InfraSwitchRow
            checked={draft.personalWriteEnabled}
            disabled={scopesLocked}
            hint={t('systemGeneral.imConnectors.personal.hints.write')}
            label={t('systemGeneral.imConnectors.personal.fields.write')}
            onChange={(checked) => onPatch({ personalWriteEnabled: checked })}
          />
        </div>

        {summary ? (
          <Text type={'secondary'}>
            {t('systemGeneral.imConnectors.personal.authorizedCount', {
              count: summary.authorizedCount,
            })}
          </Text>
        ) : null}
      </div>
    );
  },
);

PersonalDataSection.displayName = 'AdminImConnectorPersonalDataSection';
