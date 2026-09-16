'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Input, InputNumber, Switch, Tag, Text, Tooltip } from '@lobehub/ui/base-ui';
import type { LucideIcon } from 'lucide-react';
import { CheckCircle2, CircleDashed, Loader, MessageSquare, XCircle } from 'lucide-react';
import { memo, useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { AdminImConnectorView } from '@/enterprise/client/services/adminImConnectors';

import { InfraField, InfraSwitchRow } from '../infra/InfraField';
import { infraFormStyles as formStyles } from '../infra/styles';
import { infraSettingsStyles as cardStyles } from '../styles';
import { BindingsSection } from './BindingsSection';
import { ConnectorSecretField } from './ConnectorSecretField';
import {
  formatConnectorTime,
  IM_CONNECTOR_IDLE_HOURS_MAX,
  IM_CONNECTOR_IDLE_HOURS_MIN,
  resolveImConnectorTestErrorKey,
} from './draft';
import { NotifyAppSection } from './NotifyAppSection';
import type {
  ImConnectorBindingsService,
  ImConnectorMutationService,
  ImConnectorNotifyAppService,
} from './service';
import { imConnectorStyles as styles } from './styles';
import { useImConnectorEditor } from './useImConnectorEditor';

/** `tone: undefined` is the neutral tag — the connector is simply not running. */
const STATUS_PRESENTATION: Record<
  string,
  { icon: LucideIcon; tone?: 'error' | 'success' | 'warning' }
> = {
  connected: { icon: CheckCircle2, tone: 'success' },
  connecting: { icon: Loader, tone: 'warning' },
  disabled: { icon: CircleDashed },
  error: { icon: XCircle, tone: 'error' },
  unknown: { icon: CircleDashed },
};

export interface DingTalkConnectorCardProps {
  /** Injectable for tests. */
  bindingsService?: ImConnectorBindingsService;
  /** SYSTEM_OPERATE. Without it the card renders the same readings, but nothing can be written. */
  canOperate: boolean;
  /** Injectable for tests — the 通知应用 probe, directory read and manual sync. */
  notifyAppService?: ImConnectorNotifyAppService;
  onSaved?: () => Promise<void> | void;
  /** Injectable for tests. */
  service?: ImConnectorMutationService;
  view: AdminImConnectorView;
}

/**
 * 钉钉 connector card.
 *
 * One card per IM platform, edited in place rather than behind a modal: the credentials, the two
 * capability switches and the session policy are one decision, and an admin provisioning the robot
 * for the first time fills them in together.
 */
export const DingTalkConnectorCard = memo<DingTalkConnectorCardProps>(
  ({ bindingsService, canOperate, notifyAppService, onSaved, service, view }) => {
    const { t } = useTranslation('admin');
    const editor = useImConnectorEditor({ canOperate, onSaved, service, view });
    const { draft, errors } = editor;
    const enableSwitchId = `im-connector-enable-${useId()}`;

    const status = STATUS_PRESENTATION[view.status.state] ?? STATUS_PRESENTATION.unknown!;
    const statusLabel = t(`systemGeneral.imConnectors.status.${view.status.state}` as never);
    const locked = !canOperate || editor.saving;
    const testResult = editor.testResult;

    const statusTag = (
      <Tag color={status.tone} icon={<Icon icon={status.icon} size={12} />} size="small">
        {statusLabel}
      </Tag>
    );

    return (
      <section className={cardStyles.card}>
        <div className={cardStyles.header}>
          <div className={cardStyles.title}>
            <Icon icon={MessageSquare} size={16} />
            <Text strong>{t('systemGeneral.imConnectors.platform.dingtalk')}</Text>
          </div>
          <div className={styles.headerControls}>
            {view.status.lastError ? (
              <Tooltip title={view.status.lastError}>{statusTag}</Tooltip>
            ) : (
              statusTag
            )}
            {view.status.lastEventAt ? (
              <Text className={styles.code} type="secondary">
                {t('systemGeneral.imConnectors.status.lastEventAt', {
                  time: formatConnectorTime(view.status.lastEventAt),
                })}
              </Text>
            ) : null}
            {/* The worker's own liveness: a frame can arrive (heartbeat, ack) long after the last
                message did, so an idle-but-healthy stream is distinguishable from a stalled one. */}
            {view.status.lastFrameAt ? (
              <Text className={styles.code} type="secondary">
                {t('systemGeneral.imConnectors.status.lastFrameAt', {
                  time: formatConnectorTime(view.status.lastFrameAt),
                })}
              </Text>
            ) : null}
            <div className={styles.switchRow}>
              <label className={formStyles.label} htmlFor={enableSwitchId}>
                {t('systemGeneral.imConnectors.fields.enabled')}
              </label>
              <Switch
                checked={draft.enabled}
                disabled={locked}
                id={enableSwitchId}
                onChange={(checked: boolean) => editor.patch({ enabled: checked })}
              />
            </div>
          </div>
        </div>

        <div className={cardStyles.cardBody}>
          {canOperate ? null : (
            <Text type="secondary">{t('systemGeneral.imConnectors.readOnly')}</Text>
          )}

          <div className={styles.section}>
            <span className={styles.sectionTitle}>
              {t('systemGeneral.imConnectors.sections.credentials')}
            </span>
            <span className={formStyles.hint}>
              {t('systemGeneral.imConnectors.hints.credentials')}
            </span>
            <div className={formStyles.fieldGrid}>
              <InfraField
                error={errors.clientId}
                label={t('systemGeneral.imConnectors.fields.clientId')}
              >
                {(field) => (
                  <Input
                    {...field.control}
                    autoComplete="off"
                    disabled={locked}
                    value={draft.clientId}
                    onChange={(event) => editor.patch({ clientId: event.target.value })}
                  />
                )}
              </InfraField>
              <ConnectorSecretField
                disabled={locked}
                error={errors.clientSecret}
                label={t('systemGeneral.imConnectors.fields.clientSecret')}
                value={draft.clientSecret}
                onChange={(next) => editor.patch({ clientSecret: next })}
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
                    disabled={locked}
                    value={draft.robotCode}
                    onChange={(event) => editor.patch({ robotCode: event.target.value })}
                  />
                )}
              </InfraField>
              <InfraField
                error={errors.corpId}
                hint={t('systemGeneral.imConnectors.hints.corpId')}
                label={t('systemGeneral.imConnectors.fields.corpId')}
              >
                {(field) => (
                  <Input
                    {...field.control}
                    autoComplete="off"
                    disabled={locked}
                    value={draft.corpId}
                    onChange={(event) => editor.patch({ corpId: event.target.value })}
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
                    disabled={locked}
                    value={draft.agentId}
                    onChange={(event) => editor.patch({ agentId: event.target.value })}
                  />
                )}
              </InfraField>
            </div>
          </div>

          {/* Under the robot's own credentials: the second app is what reaches employees who never
              opened the robot, and what the reminder recipients are read from. */}
          <NotifyAppSection
            canOperate={canOperate}
            disabled={locked}
            draft={draft}
            errors={errors}
            service={notifyAppService}
            onPatch={editor.patch}
          />

          <div className={styles.section}>
            <span className={styles.sectionTitle}>
              {t('systemGeneral.imConnectors.sections.cardTemplates')}
            </span>
            <span className={formStyles.hint}>
              {t('systemGeneral.imConnectors.hints.cardTemplates')}
            </span>
            <div className={formStyles.fieldGrid}>
              <InfraField
                error={errors.aiCardTemplateId}
                label={t('systemGeneral.imConnectors.fields.aiCardTemplateId')}
              >
                {(field) => (
                  <Input
                    {...field.control}
                    disabled={locked}
                    value={draft.aiCardTemplateId}
                    onChange={(event) => editor.patch({ aiCardTemplateId: event.target.value })}
                  />
                )}
              </InfraField>
              <InfraField
                error={errors.selectCardTemplateId}
                label={t('systemGeneral.imConnectors.fields.selectCardTemplateId')}
              >
                {(field) => (
                  <Input
                    {...field.control}
                    disabled={locked}
                    value={draft.selectCardTemplateId}
                    onChange={(event) => editor.patch({ selectCardTemplateId: event.target.value })}
                  />
                )}
              </InfraField>
            </div>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionTitle}>
              {t('systemGeneral.imConnectors.sections.capabilities')}
            </span>
            <div className={formStyles.fieldGrid}>
              <InfraSwitchRow
                checked={draft.chatEnabled}
                disabled={locked}
                hint={t('systemGeneral.imConnectors.hints.chatEnabled')}
                label={t('systemGeneral.imConnectors.fields.chatEnabled')}
                onChange={(checked) => editor.patch({ chatEnabled: checked })}
              />
              <InfraSwitchRow
                checked={draft.pushEnabled}
                disabled={locked}
                hint={t('systemGeneral.imConnectors.hints.pushEnabled')}
                label={t('systemGeneral.imConnectors.fields.pushEnabled')}
                onChange={(checked) => editor.patch({ pushEnabled: checked })}
              />
            </div>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionTitle}>
              {t('systemGeneral.imConnectors.sections.session')}
            </span>
            <div className={formStyles.fieldGrid}>
              <InfraSwitchRow
                checked={draft.idleNewTopicEnabled}
                disabled={locked}
                hint={t('systemGeneral.imConnectors.hints.idleNewTopic')}
                label={t('systemGeneral.imConnectors.fields.idleNewTopic')}
                onChange={(checked) => editor.patch({ idleNewTopicEnabled: checked })}
              />
              <InfraField
                error={errors.idleNewTopicHours}
                label={t('systemGeneral.imConnectors.fields.idleNewTopicHours')}
              >
                {(field) => (
                  <InputNumber
                    {...field.control}
                    // The hours only mean something while the rule is on; a disabled control says
                    // so more plainly than a number that changes nothing.
                    disabled={locked || !draft.idleNewTopicEnabled}
                    max={IM_CONNECTOR_IDLE_HOURS_MAX}
                    min={IM_CONNECTOR_IDLE_HOURS_MIN}
                    step={1}
                    style={{ width: '100%' }}
                    value={draft.idleNewTopicHours}
                    onChange={(next) =>
                      editor.patch({
                        idleNewTopicHours: typeof next === 'number' ? next : null,
                      })
                    }
                  />
                )}
              </InfraField>
            </div>
          </div>

          <div className={cardStyles.footer}>
            <span className={styles.stats}>
              {[
                t('systemGeneral.imConnectors.stats.linkedUsers', {
                  value: view.stats.linkedUsers,
                }),
                t('systemGeneral.imConnectors.stats.messages7d', { value: view.stats.messages7d }),
                t('systemGeneral.imConnectors.stats.pushes7d', { value: view.stats.pushes7d }),
              ].join(' · ')}
            </span>

            {testResult ? (
              <Flexbox gap={4}>
                <Text type={testResult.ok ? 'success' : 'danger'}>
                  {testResult.ok
                    ? t('systemGeneral.test.success')
                    : t(resolveImConnectorTestErrorKey(testResult.errorCode) as never)}
                  {testResult.ok && testResult.robotName
                    ? ` · ${t('systemGeneral.imConnectors.test.robotName', {
                        name: testResult.robotName,
                      })}`
                    : ''}
                </Text>
                {testResult.latencyMs === null ? null : (
                  <Text className={styles.code} type="secondary">
                    {t('systemGeneral.test.latency', { ms: testResult.latencyMs })}
                  </Text>
                )}
                {/* The mapped code says what to do about it; the provider's own words say which
                    of the several things behind that code actually happened. */}
                {testResult.errorMessage ? (
                  <Text className={styles.code} type="secondary">
                    {testResult.errorMessage}
                  </Text>
                ) : null}
              </Flexbox>
            ) : null}

            {canOperate ? (
              <div className={cardStyles.actionsRow}>
                <Button loading={editor.testing} size="small" onClick={() => void editor.test()}>
                  {t('systemGeneral.testConnection')}
                </Button>
                <Button
                  disabled={!editor.dirty}
                  loading={editor.saving}
                  size="small"
                  type="primary"
                  onClick={() => void editor.save()}
                >
                  {t('systemGeneral.edit.save')}
                </Button>
                <Button
                  disabled={!editor.dirty || editor.saving}
                  size="small"
                  onClick={editor.cancel}
                >
                  {t('systemGeneral.edit.cancel')}
                </Button>
              </div>
            ) : null}
          </div>

          {/* Last, under the counter it explains: 已绑定员工 is the length of this list. */}
          <BindingsSection
            canOperate={canOperate}
            platform={view.platform}
            service={bindingsService}
            onChanged={onSaved}
          />
        </div>
      </section>
    );
  },
);

DingTalkConnectorCard.displayName = 'AdminDingTalkConnectorCard';
