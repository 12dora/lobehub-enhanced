'use client';

import { DINGTALK_CONSOLE_LINKS } from '@lobechat/utils/appLink';
import { Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ActionLink from '@/components/ActionLink';

import { InfraHelpButton, InfraSwitchRow } from '../infra/InfraField';
import { ConnectorSection } from './ConnectorSection';
import type { DingTalkConnectorDraft, DingTalkPersonalSummary } from './draft';
import { imConnectorStyles as styles } from './styles';

export interface PersonalDataSectionProps {
  /** The card is saving (or the admin cannot write): the switches follow the rest of the form. */
  disabled: boolean;
  draft: DingTalkConnectorDraft;
  onPatch: (next: Partial<DingTalkConnectorDraft>) => void;
  /** Module `dingtalkDocs`: the 文档 and 表格 scopes. Defaults to shown. */
  showDocs?: boolean;
  /** Sidecar presence and the authorized-member count; `null` when the server did not say. */
  summary: DingTalkPersonalSummary | null;
}

type PersonalScope = 'chat' | 'docs' | 'report' | 'sheets' | 'todo' | 'write';

type PersonalScopeField =
  | 'personalChatEnabled'
  | 'personalDocsEnabled'
  | 'personalReportEnabled'
  | 'personalSheetsEnabled'
  | 'personalTodoEnabled'
  | 'personalWriteEnabled';

/** The draft field behind each scope switch, in the order the grid shows them. */
const SCOPES: readonly { field: PersonalScopeField; scope: PersonalScope }[] = [
  { field: 'personalTodoEnabled', scope: 'todo' },
  { field: 'personalChatEnabled', scope: 'chat' },
  { field: 'personalReportEnabled', scope: 'report' },
  { field: 'personalDocsEnabled', scope: 'docs' },
  { field: 'personalSheetsEnabled', scope: 'sheets' },
  { field: 'personalWriteEnabled', scope: 'write' },
];

/** Scopes served by `lobe-dingtalk-docs`, which the `dingtalkDocs` module installs. */
const DOCS_SCOPES = new Set<PersonalScope>(['docs', 'sheets']);

const patchScope = (
  field: PersonalScopeField,
  checked: boolean,
): Partial<DingTalkConnectorDraft> => {
  const patch: Partial<Record<PersonalScopeField, boolean>> = { [field]: checked };
  return patch;
};

/**
 * 个人数据授权 — each member authorizes, once, the assistant to read their own to-dos, group
 * messages and work reports (`lobe-dingtalk-personal`) and their documents and sheets
 * (`lobe-dingtalk-docs`) through the personal-data sidecar.
 *
 * The seven fields belong to the connector row and are written by the card's own 保存. The master
 * switch gates the scopes: with it off they cannot take effect, so they are shown as stored but
 * cannot be changed. The write switch covers the writes of both toolsets.
 */
export const PersonalDataSection = memo<PersonalDataSectionProps>(
  ({ disabled, draft, onPatch, showDocs = true, summary }) => {
    const { t } = useTranslation('admin');
    const scopesLocked = disabled || !draft.personalDataEnabled;
    const scopes = showDocs ? SCOPES : SCOPES.filter(({ scope }) => !DOCS_SCOPES.has(scope));

    return (
      <ConnectorSection
        help={t('systemGeneral.imConnectors.personal.description')}
        title={t('systemGeneral.imConnectors.personal.title')}
        extra={
          // The DingTalk-side switch this needs lives in the developer console: one click to it.
          <ActionLink href={DINGTALK_CONSOLE_LINKS.cliSettings}>
            {t('systemGeneral.imConnectors.personal.cliLink')}
          </ActionLink>
        }
      >
        {/* Said whatever the switch says: saving it on without the sidecar would look like it
            worked while nothing does. */}
        {summary && !summary.brokerConfigured ? (
          <div className={styles.inlineRow}>
            <Text type={'warning'}>{t('systemGeneral.imConnectors.personal.brokerMissing')}</Text>
            <InfraHelpButton
              hint={t('systemGeneral.imConnectors.personal.brokerMissingHelp')}
              label={t('systemGeneral.imConnectors.personal.brokerService')}
            />
          </div>
        ) : null}

        <div className={styles.fieldGrid}>
          <InfraSwitchRow
            checked={draft.personalDataEnabled}
            className={styles.tile}
            disabled={disabled}
            label={t('systemGeneral.imConnectors.personal.fields.enabled')}
            addon={
              summary ? (
                <Text type={'secondary'}>
                  {t('systemGeneral.imConnectors.personal.authorizedCount', {
                    count: summary.authorizedCount,
                  })}
                </Text>
              ) : undefined
            }
            onChange={(checked) => onPatch({ personalDataEnabled: checked })}
          />
        </div>

        <div className={styles.tileGrid}>
          {scopes.map(({ field, scope }) => (
            <InfraSwitchRow
              checked={draft[field]}
              className={styles.tile}
              disabled={scopesLocked}
              key={scope}
              label={t(`systemGeneral.imConnectors.personal.fields.${scope}` as never)}
              help={
                scope === 'write' ? t('systemGeneral.imConnectors.personal.hints.write') : undefined
              }
              onChange={(checked) => onPatch(patchScope(field, checked))}
            />
          ))}
        </div>
      </ConnectorSection>
    );
  },
);

PersonalDataSection.displayName = 'AdminImConnectorPersonalDataSection';
