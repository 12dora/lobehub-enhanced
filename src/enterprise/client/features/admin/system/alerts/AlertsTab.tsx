'use client';

import { Flexbox } from '@lobehub/ui';
import {
  Alert,
  CheckboxGroup,
  Input,
  InputNumber,
  Segmented,
  Select,
  Text,
} from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  InfraField,
  InfraHelpButton,
  InfraSwitchRow,
} from '@/enterprise/client/features/admin/systemGeneral/infra/InfraField';
import { infraFormStyles } from '@/enterprise/client/features/admin/systemGeneral/infra/styles';
import { useModuleEnabled } from '@/enterprise/client/hooks/useModuleEnabled';
import type {
  AdminStatusAlertChannel,
  AdminStatusAlertsView,
} from '@/enterprise/client/services/adminSystem';

import { ChannelBlock, type ChannelUnavailable } from './ChannelBlock';
import { CredentialField } from './CredentialField';
import {
  ALERT_FIELD_CHANNEL,
  ALERT_LIMITS,
  ALERT_RECIPIENT_ROLES,
  ALERT_RULE_KEYS,
  type AlertDraftField,
  type AlertRecipientMode,
  type AlertRuleKey,
  type AlertSettingsDraft,
  findInvalidEmail,
  isRobotBodyVisible,
  normalizeEmailRecipients,
} from './draft';
import { RecipientUsersField } from './RecipientUsersField';
import { alertSettingsStyles as styles } from './styles';
import { type AlertSettingsEditor, isAlertChannelAvailable } from './useAlertSettingsEditor';

/** Where each missing delivery backend is configured. */
export const IM_CONNECTORS_PATH = '/admin/system/general?tab=im-connectors';
export const INFRASTRUCTURE_PATH = '/admin/system/general?tab=infrastructure';
export const MODULES_PATH = '/admin/system/modules';

const WEBHOOK_PLACEHOLDER = 'https://oapi.dingtalk.com/robot/send?access_token=…';

export interface AlertsTabProps {
  canOperate: boolean;
  draft: AlertSettingsDraft;
  editor: AlertSettingsEditor;
  view: AdminStatusAlertsView;
}

/** 告警设置 → 告警: master switch, delivery channels, and which problems raise an alert. */
export const AlertsTab = memo<AlertsTabProps>(({ canOperate, draft, editor, view }) => {
  const { t } = useTranslation('admin');
  // Work notices go out through the notify app, which a module switch can take away entirely.
  const notifyModuleEnabled = useModuleEnabled('dingtalkNotify');
  const readOnly = !canOperate || editor.saving;

  const errorText = (field: AlertDraftField) => {
    // The server's own words win: they name the rule a rejected save broke.
    const serverMessage = editor.fieldMessages[field];
    if (serverMessage) return serverMessage;
    const key = editor.errors[field];
    if (!key) return undefined;
    if (key === 'emailInvalid') {
      return t('system.alerts.errors.emailInvalid', {
        value: findInvalidEmail(draft.email.recipients) ?? '',
      });
    }
    if (key === 'emailTooMany') {
      return t('system.alerts.errors.emailTooMany', { max: ALERT_LIMITS.EMAIL_MAX });
    }
    if (key === 'secretInvalid') {
      return t('system.alerts.errors.secretInvalid', { max: ALERT_LIMITS.ROBOT_SECRET_MAX });
    }
    return t(`system.alerts.errors.${key}` as never);
  };
  const channelInvalid = (channel: AdminStatusAlertChannel) =>
    (
      [...Object.keys(editor.errors), ...Object.keys(editor.fieldMessages)] as AlertDraftField[]
    ).some((field) => ALERT_FIELD_CHANNEL[field] === channel);

  const patchWorkNotice = (next: Partial<AlertSettingsDraft['workNotice']>) =>
    editor.patch((current) => ({ ...current, workNotice: { ...current.workNotice, ...next } }));
  const patchRobot = (next: Partial<AlertSettingsDraft['robot']>) =>
    editor.patch((current) => ({ ...current, robot: { ...current.robot, ...next } }));
  const patchEmail = (next: Partial<AlertSettingsDraft['email']>) =>
    editor.patch((current) => ({ ...current, email: { ...current.email, ...next } }));

  const workNoticeUnavailable: ChannelUnavailable | undefined = !notifyModuleEnabled
    ? { reason: t('system.alerts.channels.notifyModuleOff'), to: MODULES_PATH }
    : isAlertChannelAvailable(view, 'workNotice')
      ? undefined
      : { reason: t('system.alerts.channels.notifyAppMissing'), to: IM_CONNECTORS_PATH };
  const emailUnavailable: ChannelUnavailable | undefined = isAlertChannelAvailable(view, 'email')
    ? undefined
    : { reason: t('system.alerts.channels.mailMissing'), to: INFRASTRUCTURE_PATH };

  // Stored robot credentials stay reachable (to replace or clear) while the robot is off.
  const robotExpanded = isRobotBodyVisible(draft);
  // The threshold only matters while the DingTalk API usage rule is on.
  const thresholdDisabled = readOnly || !draft.rules.dingtalkApiBudget;
  const thresholdPlaceholder =
    view.settings.dingtalkApiDailyThreshold === null
      ? t('system.alerts.rules.thresholdPlaceholder', {
          value: view.effectiveDingtalkApiDailyThreshold,
        })
      : t('system.alerts.rules.thresholdDefault');

  return (
    <div className={styles.panel}>
      {canOperate ? null : <Alert showIcon title={t('system.alerts.readOnly')} type="info" />}
      {view.envDisabled ? (
        <Alert
          showIcon
          type="warning"
          title={
            <span className={styles.inlineRow}>
              {t('system.alerts.envDisabled')}
              <InfraHelpButton
                hint={t('system.alerts.envDisabledHelp')}
                label={t('system.alerts.enabled')}
              />
            </span>
          }
        />
      ) : null}

      <InfraSwitchRow
        checked={draft.enabled}
        disabled={readOnly || view.envDisabled}
        label={t('system.alerts.enabled')}
        onChange={(enabled) => editor.patch((current) => ({ ...current, enabled }))}
      />

      <section className={styles.section}>
        <Text as="h3" className={styles.groupTitle}>
          {t('system.alerts.channels.title')}
        </Text>

        <ChannelBlock
          channel="workNotice"
          disabled={readOnly}
          editor={editor}
          enabled={draft.workNotice.enabled}
          help={t('system.alerts.channels.workNoticeHelp')}
          invalid={channelInvalid('workNotice')}
          label={t('system.alerts.channels.workNotice')}
          unavailable={workNoticeUnavailable}
          onToggle={(enabled) => patchWorkNotice({ enabled })}
        >
          <InfraField error={errorText('recipients')} label={t('system.alerts.recipients.label')}>
            {(field) => (
              <Flexbox gap={8}>
                <div aria-labelledby={field.labelId} role="group">
                  <Segmented
                    disabled={readOnly}
                    value={draft.workNotice.recipientMode}
                    options={[
                      { label: t('system.alerts.recipients.roles'), value: 'roles' },
                      { label: t('system.alerts.recipients.users'), value: 'users' },
                    ]}
                    onChange={(mode) =>
                      patchWorkNotice({ recipientMode: mode as AlertRecipientMode })
                    }
                  />
                </div>
                {draft.workNotice.recipientMode === 'roles' ? (
                  <CheckboxGroup
                    horizontal
                    aria-labelledby={field.labelId}
                    disabled={readOnly}
                    gap={12}
                    style={{ flexWrap: 'wrap' }}
                    value={draft.workNotice.roles}
                    options={ALERT_RECIPIENT_ROLES.map((role) => ({
                      label: t(`users.roles.${role}` as never),
                      value: role,
                    }))}
                    onChange={(next) =>
                      patchWorkNotice({
                        roles: ALERT_RECIPIENT_ROLES.filter((role) => next.includes(role)),
                      })
                    }
                  />
                ) : (
                  <RecipientUsersField
                    disabled={readOnly}
                    labelId={field.labelId}
                    users={draft.workNotice.users}
                    onChange={(users) => patchWorkNotice({ users })}
                  />
                )}
              </Flexbox>
            )}
          </InfraField>
        </ChannelBlock>

        <ChannelBlock
          channel="dingtalkRobot"
          disabled={readOnly}
          editor={editor}
          enabled={draft.robot.enabled}
          expanded={robotExpanded}
          invalid={channelInvalid('dingtalkRobot')}
          label={t('system.alerts.channels.robot')}
          onToggle={(enabled) => patchRobot({ enabled })}
        >
          <CredentialField
            disabled={readOnly}
            error={errorText('webhook')}
            label={t('system.alerts.robot.webhookUrl')}
            maxLength={ALERT_LIMITS.WEBHOOK_MAX}
            placeholder={WEBHOOK_PLACEHOLDER}
            storedHint={draft.robot.webhookHint}
            value={draft.robot.webhook}
            onChange={(webhook) => patchRobot({ webhook })}
          />
          <CredentialField
            disabled={readOnly}
            error={errorText('robotSecret')}
            hint={t('system.alerts.robot.secretHelp')}
            label={t('system.alerts.robot.secret')}
            maxLength={ALERT_LIMITS.ROBOT_SECRET_MAX}
            value={draft.robot.secret}
            onChange={(secret) => patchRobot({ secret })}
          />
          <InfraField
            hint={t('system.alerts.robot.keywordHelp')}
            label={t('system.alerts.robot.keyword')}
          >
            {(field) => (
              <Input
                {...field.control}
                autoComplete="off"
                disabled={readOnly}
                maxLength={ALERT_LIMITS.KEYWORD_MAX}
                placeholder={t('system.alerts.robot.optional')}
                value={draft.robot.keyword}
                onChange={(event) => patchRobot({ keyword: event.target.value })}
              />
            )}
          </InfraField>
        </ChannelBlock>

        <ChannelBlock
          channel="email"
          disabled={readOnly}
          editor={editor}
          enabled={draft.email.enabled}
          invalid={channelInvalid('email')}
          label={t('system.alerts.channels.email')}
          unavailable={emailUnavailable}
          onToggle={(enabled) => patchEmail({ enabled })}
        >
          <InfraField
            error={errorText('emailRecipients')}
            label={t('system.alerts.email.recipients')}
          >
            {(field) => (
              <Select
                disabled={readOnly}
                id={field.control.id}
                mode="tags"
                placeholder={t('system.alerts.email.placeholder')}
                style={{ width: '100%' }}
                tokenSeparators={[',', ';', ' ', '，', '；']}
                value={draft.email.recipients}
                options={draft.email.recipients.map((address) => ({
                  label: address,
                  value: address,
                }))}
                onChange={(next) =>
                  patchEmail({
                    recipients: normalizeEmailRecipients(Array.isArray(next) ? next : []),
                  })
                }
              />
            )}
          </InfraField>
        </ChannelBlock>
      </section>

      <section className={styles.section}>
        <Text as="h3" className={styles.groupTitle}>
          {t('system.alerts.rules.title')}
        </Text>
        <CheckboxGroup
          horizontal
          aria-label={t('system.alerts.rules.title')}
          disabled={readOnly}
          gap={12}
          style={{ flexWrap: 'wrap' }}
          value={ALERT_RULE_KEYS.filter((key) => draft.rules[key])}
          options={ALERT_RULE_KEYS.map((key) => ({
            label: t(`system.alerts.rules.${key}` as never),
            value: key,
          }))}
          onChange={(next) =>
            editor.patch((current) => ({
              ...current,
              rules: Object.fromEntries(
                ALERT_RULE_KEYS.map((key) => [key, next.includes(key)]),
              ) as Record<AlertRuleKey, boolean>,
            }))
          }
        />
        <div className={infraFormStyles.fieldGrid}>
          <InfraField
            error={errorText('threshold')}
            hint={t('system.alerts.rules.thresholdHelp')}
            label={t('system.alerts.rules.threshold')}
          >
            {(field) => (
              <InputNumber
                {...field.control}
                disabled={thresholdDisabled}
                max={ALERT_LIMITS.THRESHOLD_MAX}
                min={0}
                placeholder={thresholdPlaceholder}
                step={100}
                style={{ width: '100%' }}
                value={draft.threshold}
                onChange={(threshold) => editor.patch((current) => ({ ...current, threshold }))}
              />
            )}
          </InfraField>
          <InfraField
            error={errorText('repeatIntervalHours')}
            hint={t('system.alerts.rules.repeatIntervalHelp')}
            label={t('system.alerts.rules.repeatInterval')}
          >
            {(field) => (
              <InputNumber
                {...field.control}
                disabled={readOnly}
                max={ALERT_LIMITS.REPEAT_INTERVAL_HOURS_MAX}
                min={ALERT_LIMITS.REPEAT_INTERVAL_HOURS_MIN}
                step={1}
                style={{ width: '100%' }}
                value={draft.repeatIntervalHours}
                onChange={(repeatIntervalHours) =>
                  editor.patch((current) => ({ ...current, repeatIntervalHours }))
                }
              />
            )}
          </InfraField>
        </div>
        <InfraSwitchRow
          checked={draft.notifyOnRecovery}
          disabled={readOnly}
          label={t('system.alerts.rules.notifyOnRecovery')}
          onChange={(notifyOnRecovery) =>
            editor.patch((current) => ({ ...current, notifyOnRecovery }))
          }
        />
      </section>
    </div>
  );
});

AlertsTab.displayName = 'AdminSystemAlertsTab';
