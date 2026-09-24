'use client';

import { Input, InputNumber, Tag, Text } from '@lobehub/ui/base-ui';
import { memo, useId } from 'react';
import { useTranslation } from 'react-i18next';

import { InfraField, InfraSwitchRow } from '../infra/InfraField';
import { infraFormStyles as formStyles } from '../infra/styles';
import { ConnectorSection } from './ConnectorSection';
import {
  type DingTalkConnectorDraft,
  IM_CONNECTOR_IDLE_HOURS_MAX,
  IM_CONNECTOR_IDLE_HOURS_MIN,
} from './draft';
import { imConnectorStyles as styles } from './styles';

export interface ChatSectionProps {
  /** The environment's confirm-card template id — the input's placeholder once it is emptied. */
  confirmCardTemplateFallback: string | null;
  /** The confirm-card input shows the environment's template id, not a stored one. */
  confirmCardTemplatePrefilled: boolean;
  /** The card is saving (or the admin cannot write): the fields follow the rest of the form. */
  disabled: boolean;
  draft: DingTalkConnectorDraft;
  /** Field name → resolved message, from the card's own validation pass. */
  errors: Record<string, string>;
  onPatch: (next: Partial<DingTalkConnectorDraft>) => void;
}

/**
 * 机器人对话 — what the chat robot does once it is connected: whether it answers, when a
 * conversation starts over, and which interactive cards it sends.
 */
export const ChatSection = memo<ChatSectionProps>(
  ({
    confirmCardTemplateFallback,
    confirmCardTemplatePrefilled,
    disabled,
    draft,
    errors,
    onPatch,
  }) => {
    const { t } = useTranslation('admin');
    const hoursId = `im-connector-idle-hours-${useId()}`;
    const hoursErrorId = `${hoursId}-error`;
    const hoursLabel = t('systemGeneral.imConnectors.fields.idleNewTopicHours');

    return (
      <ConnectorSection title={t('systemGeneral.imConnectors.sections.chat')}>
        <div className={styles.fieldGrid}>
          <InfraSwitchRow
            checked={draft.chatEnabled}
            className={styles.tile}
            disabled={disabled}
            help={t('systemGeneral.imConnectors.hints.chatEnabled')}
            label={t('systemGeneral.imConnectors.fields.chatEnabled')}
            onChange={(checked) => onPatch({ chatEnabled: checked })}
          />
          <div className={formStyles.field}>
            <InfraSwitchRow
              checked={draft.idleNewTopicEnabled}
              className={styles.tile}
              disabled={disabled}
              help={t('systemGeneral.imConnectors.hints.idleNewTopic')}
              label={t('systemGeneral.imConnectors.fields.idleNewTopic')}
              addon={
                <>
                  <label className={styles.visuallyHidden} htmlFor={hoursId}>
                    {hoursLabel}
                  </label>
                  <InputNumber
                    aria-describedby={errors.idleNewTopicHours ? hoursErrorId : undefined}
                    aria-invalid={errors.idleNewTopicHours ? true : undefined}
                    className={styles.hoursInput}
                    // The hours only mean something while the rule is on; a disabled control says
                    // so more plainly than a number that changes nothing.
                    disabled={disabled || !draft.idleNewTopicEnabled}
                    id={hoursId}
                    max={IM_CONNECTOR_IDLE_HOURS_MAX}
                    min={IM_CONNECTOR_IDLE_HOURS_MIN}
                    size="small"
                    step={1}
                    value={draft.idleNewTopicHours}
                    onChange={(next) =>
                      onPatch({ idleNewTopicHours: typeof next === 'number' ? next : null })
                    }
                  />
                  <Text type="secondary">{t('systemGeneral.imConnectors.units.hours')}</Text>
                </>
              }
              onChange={(checked) => onPatch({ idleNewTopicEnabled: checked })}
            />
            {errors.idleNewTopicHours ? (
              <span className={formStyles.error} id={hoursErrorId}>
                {errors.idleNewTopicHours}
              </span>
            ) : null}
          </div>

          <InfraField
            error={errors.aiCardTemplateId}
            hint={t('systemGeneral.imConnectors.hints.aiCardTemplateId')}
            label={t('systemGeneral.imConnectors.fields.aiCardTemplateId')}
          >
            {(field) => (
              <Input
                {...field.control}
                autoComplete="off"
                disabled={disabled}
                value={draft.aiCardTemplateId}
                onChange={(event) => onPatch({ aiCardTemplateId: event.target.value })}
              />
            )}
          </InfraField>
          <InfraField
            error={errors.selectCardTemplateId}
            hint={t('systemGeneral.imConnectors.hints.selectCardTemplateId')}
            label={t('systemGeneral.imConnectors.fields.selectCardTemplateId')}
          >
            {(field) => (
              <Input
                {...field.control}
                autoComplete="off"
                disabled={disabled}
                value={draft.selectCardTemplateId}
                onChange={(event) => onPatch({ selectCardTemplateId: event.target.value })}
              />
            )}
          </InfraField>
          <InfraField
            error={errors.confirmCardTemplateId}
            hint={t('systemGeneral.imConnectors.hints.confirmCardTemplateId')}
            label={t('systemGeneral.imConnectors.fields.confirmCardTemplateId')}
            labelExtra={
              confirmCardTemplatePrefilled ? (
                <Tag size="small">{t('systemGeneral.imConnectors.prefill.env')}</Tag>
              ) : undefined
            }
          >
            {(field) => (
              <Input
                {...field.control}
                autoComplete="off"
                disabled={disabled}
                // Emptied, the input still says what is in force: the environment's template.
                placeholder={confirmCardTemplateFallback ?? undefined}
                value={draft.confirmCardTemplateId}
                onChange={(event) => onPatch({ confirmCardTemplateId: event.target.value })}
              />
            )}
          </InfraField>
        </div>
      </ConnectorSection>
    );
  },
);

ChatSection.displayName = 'AdminImConnectorChatSection';
