'use client';

import { Button, Input, Text, toast } from '@lobehub/ui/base-ui';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAdminAccess } from '@/enterprise/client/providers/AdminAccessProvider';
import type { AdminImConnectorTestOutput } from '@/enterprise/client/services/adminImConnectors';

import { runAdminMutation } from '../../primitives/runAdminMutation';
import { useAdminImConnectorDirectoryStatus } from '../hooks';
import { InfraField, InfraSwitchRow } from '../infra/InfraField';
import { infraFormStyles as formStyles } from '../infra/styles';
import { ConnectorSecretField } from './ConnectorSecretField';
import type { DingTalkConnectorDraft } from './draft';
import {
  formatConnectorTime,
  resolveImConnectorTestErrorKey,
  toDingTalkNotifyTestInput,
} from './draft';
import { type ImConnectorNotifyAppService, imConnectorNotifyAppService } from './service';
import { imConnectorStyles as styles } from './styles';

export interface NotifyAppSectionProps {
  /** SYSTEM_OPERATE. Without it the block is a reading: no probe, no manual sync. */
  canOperate: boolean;
  /** The card is saving (or the admin cannot write): the fields follow the rest of the form. */
  disabled: boolean;
  draft: DingTalkConnectorDraft;
  /** Field name → resolved message, from the card's own validation pass. */
  errors: Record<string, string>;
  onPatch: (next: Partial<DingTalkConnectorDraft>) => void;
  /** Injectable for tests. */
  service?: ImConnectorNotifyAppService;
}

/**
 * 通知应用（服务号） — the second DingTalk app beside the chat robot.
 *
 * It exists for two jobs the robot cannot do: sending 工作通知 (task notices and scheduled
 * reminders reach every employee, not only the ones who ever talked to the robot) and reading the
 * contacts directory that reminder recipients are picked from. Its three fields are part of the
 * connector row, so they are saved through the card's own 保存 — only the probe and the manual
 * sync act on their own, because both are about the credentials as they are stored right now.
 */
export const NotifyAppSection = memo<NotifyAppSectionProps>(
  ({ canOperate, disabled, draft, errors, onPatch, service = imConnectorNotifyAppService }) => {
    const { t } = useTranslation('admin');
    const { authMethod } = useAdminAccess();

    const directory = useAdminImConnectorDirectoryStatus(true, service);
    const status = directory.data;
    const directoryError = directory.error;
    const { mutate } = directory;

    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<AdminImConnectorTestOutput | undefined>();
    const [syncing, setSyncing] = useState(false);

    const runProbe = useCallback(async () => {
      if (!canOperate || testing) return;
      setTesting(true);
      try {
        // The probe runs against the draft so credentials are verified before they are written.
        setTestResult(await service.testNotifyApp(toDingTalkNotifyTestInput(draft)));
      } catch {
        setTestResult({
          errorCode: 'unknown',
          errorMessage: null,
          latencyMs: null,
          ok: false,
          robotName: null,
        });
      } finally {
        setTesting(false);
      }
    }, [canOperate, draft, service, testing]);

    const running = status?.state === 'running';

    const sync = useCallback(async () => {
      if (!canOperate || syncing) return;
      setSyncing(true);
      try {
        await runAdminMutation({
          authMethod,
          mapErrorKey: () => 'systemGeneral.imConnectors.notifyApp.directory.syncFailed',
          run: async () => {
            const result = await service.syncDirectory();
            // The mutation answers with the status it reached, but a sync that is still running
            // keeps changing: the counters come from the polled read rather than from this answer.
            await mutate();
            if (result.state === 'ok') {
              toast.success(t('systemGeneral.imConnectors.notifyApp.directory.synced'));
            } else if (result.state === 'running') {
              // Another sync holds the lock: not an error, the polled status will catch up.
              toast.info(t('systemGeneral.imConnectors.notifyApp.directory.syncing'));
            } else {
              toast.error(
                result.lastError
                  ? t('systemGeneral.imConnectors.notifyApp.directory.error', {
                      message: result.lastError,
                    })
                  : t('systemGeneral.imConnectors.notifyApp.directory.syncFailed'),
              );
            }
          },
        });
      } finally {
        setSyncing(false);
      }
    }, [authMethod, canOperate, mutate, service, syncing, t]);

    const directoryLine = status?.lastRunAt
      ? t('systemGeneral.imConnectors.notifyApp.directory.summary', {
          departments: status.departments,
          time: formatConnectorTime(status.lastRunAt),
          users: status.users,
        })
      : t('systemGeneral.imConnectors.notifyApp.directory.never');

    return (
      <div className={styles.section}>
        <span className={styles.sectionTitle}>
          {t('systemGeneral.imConnectors.sections.notifyApp')}
        </span>
        <span className={formStyles.hint}>{t('systemGeneral.imConnectors.hints.notifyApp')}</span>
        <div className={formStyles.fieldGrid}>
          <InfraField
            error={errors.notifyAppKey}
            label={t('systemGeneral.imConnectors.fields.notifyAppKey')}
          >
            {(field) => (
              <Input
                {...field.control}
                autoComplete="off"
                disabled={disabled}
                value={draft.notifyAppKey}
                onChange={(event) => onPatch({ notifyAppKey: event.target.value })}
              />
            )}
          </InfraField>
          <ConnectorSecretField
            disabled={disabled}
            error={errors.notifyAppSecret}
            label={t('systemGeneral.imConnectors.fields.notifyAppSecret')}
            storedPlaceholder={t('systemGeneral.imConnectors.notifyApp.secretPlaceholder')}
            value={draft.notifyAppSecret}
            onChange={(next) => onPatch({ notifyAppSecret: next })}
          />
          <InfraField
            error={errors.notifyAgentId}
            hint={t('systemGeneral.imConnectors.hints.notifyAgentId')}
            label={t('systemGeneral.imConnectors.fields.notifyAgentId')}
          >
            {(field) => (
              <Input
                {...field.control}
                autoComplete="off"
                disabled={disabled}
                value={draft.notifyAgentId}
                onChange={(event) => onPatch({ notifyAgentId: event.target.value })}
              />
            )}
          </InfraField>
          <InfraSwitchRow
            checked={draft.notifyWorkNoticeEnabled}
            disabled={disabled}
            hint={t('systemGeneral.imConnectors.hints.notifyWorkNoticeEnabled')}
            label={t('systemGeneral.imConnectors.fields.notifyWorkNoticeEnabled')}
            onChange={(checked) => onPatch({ notifyWorkNoticeEnabled: checked })}
          />
          <InfraSwitchRow
            checked={draft.notifyRobotEnabled}
            disabled={disabled}
            hint={t('systemGeneral.imConnectors.hints.notifyRobotEnabled')}
            label={t('systemGeneral.imConnectors.fields.notifyRobotEnabled')}
            onChange={(checked) => onPatch({ notifyRobotEnabled: checked })}
          />
        </div>

        {canOperate ? (
          <div className={styles.notifyRow}>
            <Button loading={testing} size="small" onClick={() => void runProbe()}>
              {t('systemGeneral.imConnectors.notifyApp.test')}
            </Button>
            {testResult ? (
              <Text type={testResult.ok ? 'success' : 'danger'}>
                {testResult.ok
                  ? t('systemGeneral.test.success')
                  : t(resolveImConnectorTestErrorKey(testResult.errorCode) as never)}
              </Text>
            ) : null}
            {/* The provider's own words say which of the several things behind that code happened. */}
            {testResult && !testResult.ok && testResult.errorMessage ? (
              <Text className={styles.code} type="secondary">
                {testResult.errorMessage}
              </Text>
            ) : null}
          </div>
        ) : null}

        <div className={styles.notifyRow}>
          {directoryError && !status ? (
            <>
              <Text type="danger">
                {t('systemGeneral.imConnectors.notifyApp.directory.loadFailed')}
              </Text>
              <Button size="small" onClick={() => void mutate()}>
                {t('systemGeneral.retry')}
              </Button>
            </>
          ) : (
            <Text type="secondary">{directoryLine}</Text>
          )}
          {status?.state === 'error' && status.lastError ? (
            <Text type="danger">
              {t('systemGeneral.imConnectors.notifyApp.directory.error', {
                message: status.lastError,
              })}
            </Text>
          ) : null}
          {canOperate ? (
            <Button
              // A sync is a single-flight job server-side; while one runs the button would only
              // queue a no-op, so it says so instead.
              disabled={running || syncing}
              loading={running || syncing}
              size="small"
              onClick={() => void sync()}
            >
              {t('systemGeneral.imConnectors.notifyApp.directory.sync')}
            </Button>
          ) : null}
        </div>
      </div>
    );
  },
);

NotifyAppSection.displayName = 'AdminImConnectorNotifyAppSection';
