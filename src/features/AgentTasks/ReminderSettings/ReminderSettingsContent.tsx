'use client';

import { Flexbox, toast } from '@lobehub/ui';
import { Button, Switch, Text, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_NOTIFICATION_SETTINGS } from '@/const/settings';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { TASK_NOTIFICATION_TYPES, type TaskNotificationType } from '@/types/user/settings';

import {
  buildReminderDraft,
  mergeReminderDraft,
  REMINDER_CHANNELS,
  type ReminderChannelId,
  setChannelEnabled,
  setChannelItem,
} from './draft';
import { type DingTalkPushStatus, useDingTalkPushAvailable } from './useDingTalkPushAvailable';

const styles = createStaticStyles(({ css }) => ({
  // Each column is the same fixed width as its header so the switches line up
  // under the channel names without a table layout.
  eventSwitches: css`
    display: flex;
    flex-shrink: 0;
    gap: 8px;
    align-items: center;

    > * {
      display: flex;
      justify-content: center;
      width: 72px;
    }
  `,
  row: css`
    display: flex;
    gap: 16px;
    align-items: flex-start;
    justify-content: space-between;

    padding-block: 12px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  sectionTitle: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

/**
 * Explicit type → i18n key maps. Building the key by template literal would need an
 * `as never` cast and silently survive a renamed or missing key.
 */
const CHANNEL_LABEL_KEY = {
  dingtalk: 'task.reminder.channel.dingtalk',
  inbox: 'task.reminder.channel.inbox',
} as const satisfies Record<ReminderChannelId, string>;

const EVENT_LABEL_KEY = {
  task_completed: 'task.event.task_completed',
  task_run_completed: 'task.event.task_run_completed',
  task_run_failed: 'task.event.task_run_failed',
  task_waiting_for_user: 'task.event.task_waiting_for_user',
} as const satisfies Record<TaskNotificationType, string>;

const EVENT_DESC_KEY = {
  task_completed: 'task.event.task_completedDesc',
  task_run_completed: 'task.event.task_run_completedDesc',
  task_run_failed: 'task.event.task_run_failedDesc',
  task_waiting_for_user: 'task.event.task_waiting_for_userDesc',
} as const satisfies Record<TaskNotificationType, string>;

const DINGTALK_HINT_KEY = {
  available: 'task.reminder.channel.dingtalkDesc',
  error: 'task.reminder.channel.dingtalkCheckFailed',
  loading: 'task.reminder.channel.dingtalkChecking',
  unavailable: 'task.reminder.channel.dingtalkUnavailable',
} as const satisfies Record<DingTalkPushStatus, string>;

interface ReminderSettingsContentProps {
  /** Injected in tests; production closes through the imperative modal context. */
  onClose?: () => void;
}

const ReminderSettingsContent = memo<ReminderSettingsContentProps>(({ onClose }) => {
  const { t } = useTranslation('notification');
  const modal = useModalContext();
  const close = onClose ?? modal?.close;

  const notification = useUserStore(settingsSelectors.currentNotificationSettings);
  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const setSettings = useUserStore((s) => s.setSettings);
  const {
    available: dingtalkAvailable,
    retry: retryDingTalk,
    status: dingtalkStatus,
  } = useDingTalkPushAvailable();

  const [draft, setDraft] = useState(() => buildReminderDraft(notification));
  const [saving, setSaving] = useState(false);

  // Opening the modal before the user state hydrates would seed the draft from the
  // all-on defaults, and saving that would overwrite real stored opt-outs. Re-seed once
  // the first authoritative snapshot lands; the form is inert until then.
  const hydratedRef = useRef(isUserStateInit);
  useEffect(() => {
    if (hydratedRef.current || !isUserStateInit) return;
    hydratedRef.current = true;
    setDraft(buildReminderDraft(notification));
  }, [isUserStateInit, notification]);

  const locked = saving || !isUserStateInit;

  const channelLabel: Record<ReminderChannelId, string> = useMemo(
    () => ({
      dingtalk: t(CHANNEL_LABEL_KEY.dingtalk),
      inbox: t(CHANNEL_LABEL_KEY.inbox),
    }),
    [t],
  );

  // A channel that the platform cannot deliver on is not a column: the matrix must
  // only offer switches that change a real delivery.
  const activeChannels = useMemo(
    () =>
      REMINDER_CHANNELS.filter(
        (channel) => draft[channel].enabled && (channel !== 'dingtalk' || dingtalkAvailable),
      ),
    [dingtalkAvailable, draft],
  );

  const handleChannelToggle = useCallback((channel: ReminderChannelId, next: boolean) => {
    setDraft((prev) => setChannelEnabled(prev, channel, next));
  }, []);

  const handleItemToggle = useCallback(
    (channel: ReminderChannelId, type: TaskNotificationType, next: boolean) => {
      setDraft((prev) => setChannelItem(prev, channel, type, next));
    },
    [],
  );

  const handleReset = useCallback(() => {
    setDraft(buildReminderDraft(DEFAULT_NOTIFICATION_SETTINGS));
  }, []);

  const handleSave = useCallback(async () => {
    if (locked) return;
    setSaving(true);
    try {
      await setSettings({ notification: mergeReminderDraft(draft, notification) });
      toast.success(t('task.reminder.saved'));
      close?.();
    } catch {
      toast.error(t('task.reminder.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [close, draft, locked, notification, setSettings, t]);

  return (
    <Flexbox gap={20}>
      <Flexbox gap={4}>
        <Text className={styles.sectionTitle}>{t('task.reminder.section.channels')}</Text>
        <div>
          {REMINDER_CHANNELS.map((channel) => {
            // An unconfirmed channel reads as off and cannot be touched, but the draft
            // keeps whatever the user chose before: if the admin turns DingTalk push back
            // on, their original preference comes back instead of a silent opt-out.
            const isDingTalk = channel === 'dingtalk';
            const blocked = isDingTalk && !dingtalkAvailable;

            return (
              <div className={styles.row} data-channel={channel} key={channel}>
                <Flexbox gap={2}>
                  <Text>{channelLabel[channel]}</Text>
                  <Flexbox horizontal align={'center'} gap={6}>
                    <Text fontSize={12} type={'secondary'}>
                      {isDingTalk
                        ? t(DINGTALK_HINT_KEY[dingtalkStatus])
                        : t('task.reminder.channel.inboxDesc')}
                    </Text>
                    {isDingTalk && dingtalkStatus === 'error' && (
                      <Button outdent size={'small'} type={'link'} onClick={retryDingTalk}>
                        {t('task.reminder.channel.dingtalkRetry')}
                      </Button>
                    )}
                  </Flexbox>
                </Flexbox>
                <Switch
                  aria-label={channelLabel[channel]}
                  checked={!blocked && draft[channel].enabled}
                  disabled={blocked || locked}
                  onChange={(next) => handleChannelToggle(channel, next)}
                />
              </div>
            );
          })}
        </div>
      </Flexbox>

      <Flexbox gap={4}>
        <Text className={styles.sectionTitle}>{t('task.reminder.section.events')}</Text>
        {activeChannels.length === 0 ? (
          <Text fontSize={12} type={'secondary'}>
            {t('task.reminder.noChannel')}
          </Text>
        ) : (
          <div>
            <div className={styles.row}>
              <span />
              <div className={styles.eventSwitches}>
                {activeChannels.map((channel) => (
                  <Text fontSize={12} key={channel} type={'secondary'}>
                    {channelLabel[channel]}
                  </Text>
                ))}
              </div>
            </div>
            {TASK_NOTIFICATION_TYPES.map((type) => (
              <div className={styles.row} data-event={type} key={type}>
                <Flexbox gap={2}>
                  <Text>{t(EVENT_LABEL_KEY[type])}</Text>
                  <Text fontSize={12} type={'secondary'}>
                    {t(EVENT_DESC_KEY[type])}
                  </Text>
                </Flexbox>
                <div className={styles.eventSwitches}>
                  {activeChannels.map((channel) => (
                    <span key={channel}>
                      <Switch
                        aria-label={`${channelLabel[channel]} ${t(EVENT_LABEL_KEY[type])}`}
                        checked={draft[channel].items[type]}
                        disabled={locked}
                        onChange={(next) => handleItemToggle(channel, type, next)}
                      />
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Flexbox>

      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={locked} onClick={handleReset}>
          {t('task.reminder.reset')}
        </Button>
        <Button disabled={!isUserStateInit} loading={saving} type={'primary'} onClick={handleSave}>
          {t('task.reminder.save')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

ReminderSettingsContent.displayName = 'ReminderSettingsContent';

export default ReminderSettingsContent;
