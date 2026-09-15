'use client';

import { Flexbox, toast } from '@lobehub/ui';
import { Button, Switch, Text, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback, useMemo, useState } from 'react';
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
import { useDingTalkPushAvailable } from './useDingTalkPushAvailable';

const styles = createStaticStyles(({ css }) => ({
  channelRow: css`
    display: flex;
    gap: 16px;
    align-items: flex-start;
    justify-content: space-between;

    padding-block: 12px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  eventRow: css`
    display: flex;
    gap: 16px;
    align-items: flex-start;
    justify-content: space-between;

    padding-block: 12px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
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
  sectionTitle: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

interface ReminderSettingsContentProps {
  /** Injected in tests; production closes through the imperative modal context. */
  onClose?: () => void;
}

const ReminderSettingsContent = memo<ReminderSettingsContentProps>(({ onClose }) => {
  const { t } = useTranslation('notification');
  const modal = useModalContext();
  const close = onClose ?? modal?.close;

  const notification = useUserStore(settingsSelectors.currentNotificationSettings);
  const setSettings = useUserStore((s) => s.setSettings);
  const { available: dingtalkAvailable } = useDingTalkPushAvailable();

  const [draft, setDraft] = useState(() => buildReminderDraft(notification));
  const [saving, setSaving] = useState(false);

  const channelLabel: Record<ReminderChannelId, string> = useMemo(
    () => ({
      dingtalk: t('task.reminder.channel.dingtalk'),
      inbox: t('task.reminder.channel.inbox'),
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
    if (saving) return;
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
  }, [close, draft, notification, saving, setSettings, t]);

  return (
    <Flexbox gap={20}>
      <Flexbox gap={4}>
        <Text className={styles.sectionTitle}>{t('task.reminder.section.channels')}</Text>
        <div>
          {REMINDER_CHANNELS.map((channel) => {
            // An unprovisioned channel reads as off and cannot be touched, but the draft
            // keeps whatever the user chose before: if the admin turns DingTalk push back
            // on, their original preference comes back instead of a silent opt-out.
            const unavailable = channel === 'dingtalk' && !dingtalkAvailable;

            return (
              <div className={styles.channelRow} data-channel={channel} key={channel}>
                <Flexbox gap={2}>
                  <Text>{channelLabel[channel]}</Text>
                  <Text fontSize={12} type={'secondary'}>
                    {unavailable
                      ? t('task.reminder.channel.dingtalkUnavailable')
                      : t(`task.reminder.channel.${channel}Desc` as never)}
                  </Text>
                </Flexbox>
                <Switch
                  aria-label={channelLabel[channel]}
                  checked={!unavailable && draft[channel].enabled}
                  disabled={unavailable || saving}
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
            <div className={styles.eventRow} style={{ borderBlockStart: 'none' }}>
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
              <div className={styles.eventRow} data-event={type} key={type}>
                <Flexbox gap={2}>
                  <Text>{t(`task.event.${type}` as never)}</Text>
                  <Text fontSize={12} type={'secondary'}>
                    {t(`task.event.${type}Desc` as never)}
                  </Text>
                </Flexbox>
                <div className={styles.eventSwitches}>
                  {activeChannels.map((channel) => (
                    <span key={channel}>
                      <Switch
                        aria-label={`${channelLabel[channel]} ${t(`task.event.${type}` as never)}`}
                        checked={draft[channel].items[type]}
                        disabled={saving}
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
        <Button disabled={saving} onClick={handleReset}>
          {t('task.reminder.reset')}
        </Button>
        <Button loading={saving} type={'primary'} onClick={handleSave}>
          {t('task.reminder.save')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

ReminderSettingsContent.displayName = 'ReminderSettingsContent';

export default ReminderSettingsContent;
