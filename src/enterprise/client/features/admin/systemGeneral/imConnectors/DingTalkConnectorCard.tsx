'use client';

import { Icon } from '@lobehub/ui';
import { Button, Switch, Tag, Text, Tooltip } from '@lobehub/ui/base-ui';
import type { LucideIcon } from 'lucide-react';
import { CheckCircle2, CircleDashed, Loader, MessageSquare, XCircle } from 'lucide-react';
import { memo, useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { AdminImConnectorView } from '@/enterprise/client/services/adminImConnectors';

import { infraFormStyles as formStyles } from '../infra/styles';
import { infraSettingsStyles as cardStyles } from '../styles';
import { ApiCallStatsSection, type ImConnectorApiStatsService } from './ApiCallStatsSection';
import { BindingsSection } from './BindingsSection';
import { ChatSection } from './ChatSection';
import { CollapsibleConnectorSection } from './ConnectorSection';
import { CredentialsSection } from './CredentialsSection';
import {
  formatConnectorTime,
  readDingTalkFallbacks,
  readDingTalkPersonalSummary,
  resolveImConnectorTestErrorKey,
} from './draft';
import { NotifyAppSection } from './NotifyAppSection';
import { PersonalDataSection } from './PersonalDataSection';
import type {
  ImConnectorBindingsService,
  ImConnectorMutationService,
  ImConnectorNotifyAppService,
} from './service';
import { imConnectorStyles as styles } from './styles';
import { useDingTalkConnectorModules } from './useDingTalkConnectorModules';
import { useImConnectorEditor } from './useImConnectorEditor';
import {
  type ImConnectorWorkspaceService,
  WorkspaceCapabilitiesSection,
} from './WorkspaceCapabilitiesSection';

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
  /** Injectable for tests — the 接口调用量 reading. */
  apiStatsService?: ImConnectorApiStatsService;
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
  /** Injectable for tests — the 工作台能力 permission probe. */
  workspaceService?: ImConnectorWorkspaceService;
}

/**
 * 钉钉 connector card.
 *
 * One card per IM platform, edited in place rather than behind a modal. The groups follow the
 * order they depend on each other — 连接凭据 → 机器人对话 → 通知应用 → 工作台能力 (runs on the
 * notification app) → 个人数据授权 → 已绑定用户, then the folded 接口调用量 reading — and a group
 * whose module is not installed is neither rendered nor validated (its stored values are sent back
 * unchanged). One 保存 writes the whole row; it appears in a bar pinned to the bottom of the
 * viewport as soon as anything is changed.
 */
export const DingTalkConnectorCard = memo<DingTalkConnectorCardProps>(
  ({
    apiStatsService,
    bindingsService,
    canOperate,
    notifyAppService,
    onSaved,
    service,
    view,
    workspaceService,
  }) => {
    const { t } = useTranslation('admin');
    const modules = useDingTalkConnectorModules();
    // A group this deployment has not installed is neither rendered nor validated; the save sends
    // its fields exactly as the server holds them.
    const editor = useImConnectorEditor({ canOperate, groups: modules, onSaved, service, view });
    const { draft, errors } = editor;
    const enableSwitchId = `im-connector-enable-${useId()}`;

    const status = STATUS_PRESENTATION[view.status.state] ?? STATUS_PRESENTATION.unknown!;
    const statusLabel = t(`systemGeneral.imConnectors.status.${view.status.state}` as never);
    const locked = !canOperate || editor.saving;
    const testResult = editor.testResult;
    // Which inputs show the server's untouched fallback rather than a stored value (contract
    // §1.2). Decided by the editor against the newest reading and the one the draft was seeded
    // from, so a tag never outlives the save that ended it.
    const fallbacks = readDingTalkFallbacks(editor.serverView);
    const corpIdPrefilled = editor.untouchedFallbacks.has('corpId');
    const confirmCardTemplatePrefilled = editor.untouchedFallbacks.has('confirmCardTemplateId');

    // The status tag carries its own details: the provider's last error, then when the worker last
    // saw a message and — its own liveness — a frame (heartbeat/ack), so an idle-but-healthy stream
    // reads differently from a stalled one.
    const statusDetails = [
      view.status.lastError,
      view.status.lastEventAt
        ? t('systemGeneral.imConnectors.status.lastEventAt', {
            time: formatConnectorTime(view.status.lastEventAt),
          })
        : null,
      view.status.lastFrameAt
        ? t('systemGeneral.imConnectors.status.lastFrameAt', {
            time: formatConnectorTime(view.status.lastFrameAt),
          })
        : null,
    ].filter((line): line is string => Boolean(line));

    const statusTag = (
      <Tag color={status.tone} icon={<Icon icon={status.icon} size={12} />} size="small">
        {statusLabel}
      </Tag>
    );

    const showWorkspaceSection = modules.approval || modules.workspace;

    return (
      <section className={cardStyles.card}>
        <div className={styles.header}>
          <div className={styles.headerMain}>
            <div className={styles.headerTitle}>
              <Icon icon={MessageSquare} size={16} />
              <Text strong>{t('systemGeneral.imConnectors.platform.dingtalk')}</Text>
              {statusDetails.length > 0 ? (
                <Tooltip
                  title={
                    <div>
                      {statusDetails.map((line) => (
                        <div key={line}>{line}</div>
                      ))}
                    </div>
                  }
                >
                  {statusTag}
                </Tooltip>
              ) : (
                statusTag
              )}
            </div>
            <span className={styles.stats}>
              {[
                t('systemGeneral.imConnectors.stats.linkedUsers', {
                  value: view.stats.linkedUsers,
                }),
                t('systemGeneral.imConnectors.stats.messages7d', { value: view.stats.messages7d }),
                t('systemGeneral.imConnectors.stats.pushes7d', { value: view.stats.pushes7d }),
              ].join(' · ')}
            </span>
          </div>
          <div className={styles.headerControls}>
            {canOperate ? (
              <Button loading={editor.testing} size="small" onClick={() => void editor.test()}>
                {t('systemGeneral.testConnection')}
              </Button>
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

        {testResult ? (
          <div className={styles.inlineRow}>
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
            {/* The mapped code says what to do about it; the provider's own words say which of the
                several things behind that code actually happened. */}
            {testResult.errorMessage ? (
              <Text className={styles.code} type="secondary">
                {testResult.errorMessage}
              </Text>
            ) : null}
          </div>
        ) : null}

        {canOperate ? null : (
          <Text type="secondary">{t('systemGeneral.imConnectors.readOnly')}</Text>
        )}

        <CredentialsSection
          corpIdFallback={fallbacks.corpId}
          corpIdPrefilled={corpIdPrefilled}
          disabled={locked}
          draft={draft}
          errors={errors}
          robotNameFallback={fallbacks.robotDisplayName}
          onPatch={editor.patch}
        />

        {modules.chat ? (
          <ChatSection
            confirmCardTemplateFallback={fallbacks.confirmCardTemplateId}
            confirmCardTemplatePrefilled={confirmCardTemplatePrefilled}
            disabled={locked}
            draft={draft}
            errors={errors}
            onPatch={editor.patch}
          />
        ) : null}

        {/* The second app: it reaches employees who never opened the robot, and the reminder
            recipients are read from its contacts directory. */}
        {modules.notify ? (
          <NotifyAppSection
            canOperate={canOperate}
            disabled={locked}
            draft={draft}
            errors={errors}
            service={notifyAppService}
            onPatch={editor.patch}
          />
        ) : null}

        {/* Right after the app they run on: every workspace call is made with its token. */}
        {showWorkspaceSection ? (
          <WorkspaceCapabilitiesSection
            canOperate={canOperate}
            disabled={locked}
            draft={draft}
            service={workspaceService}
            showApproval={modules.approval}
            showWorkspace={modules.workspace}
            onPatch={editor.patch}
          />
        ) : null}

        {/* Both act as the member's own DingTalk identity — this one through the member's own
            authorization rather than the notification app. */}
        {modules.personal ? (
          <PersonalDataSection
            disabled={locked}
            draft={draft}
            showDocs={modules.docs}
            summary={readDingTalkPersonalSummary(view)}
            onPatch={editor.patch}
          />
        ) : null}

        {/* Last: 已绑定员工 in the header is the length of this list. */}
        <BindingsSection
          canOperate={canOperate}
          platform={view.platform}
          service={bindingsService}
          onChanged={onSaved}
        />

        {/* Every DingTalk call this deployment makes (robot, SSO, notification app, directory,
            workbench) is billed per app, so the reading belongs to the connector as a whole. It is
            a reading, not a setting: folded, and not requested until opened. */}
        <CollapsibleConnectorSection
          help={t('systemGeneral.imConnectors.apiStats.description')}
          title={t('systemGeneral.imConnectors.apiStats.title')}
        >
          <ApiCallStatsSection service={apiStatsService} />
        </CollapsibleConnectorSection>

        {canOperate && (editor.dirty || editor.saving) ? (
          <div
            aria-label={t('systemGeneral.imConnectors.unsaved')}
            className={styles.saveBar}
            role="region"
          >
            <span className={styles.saveBarText}>{t('systemGeneral.imConnectors.unsaved')}</span>
            <Button disabled={editor.saving} size="small" onClick={editor.cancel}>
              {t('systemGeneral.edit.cancel')}
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
          </div>
        ) : null}
      </section>
    );
  },
);

DingTalkConnectorCard.displayName = 'AdminDingTalkConnectorCard';
