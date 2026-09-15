'use client';

import { ActionIcon, createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { BellRingIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';

import ReminderSettingsContent from './ReminderSettingsContent';

export const openReminderSettingsModal = (): ModalInstance =>
  createModal({
    content: <ReminderSettingsContent />,
    footer: null,
    maskClosable: true,
    styles: { header: { borderBottom: 'none' } },
    title: t('task.reminder.title', { ns: 'notification' }),
    // Phones (DingTalk in-app browser, ~390px) get an effectively full-bleed
    // sheet with a 16px gutter instead of a 90vw box that clips its content.
    width: 'min(calc(100vw - 32px), 560px)',
  });

/**
 * Toolbar entry for the task reminder preferences. Uses the "ringing" bell so it
 * reads as *configure reminders* next to the inbox bell, which opens the messages
 * themselves.
 */
const ReminderSettingsButton = memo(() => {
  const { t: tNotification } = useTranslation('notification');

  const handleClick = useCallback(() => {
    openReminderSettingsModal();
  }, []);

  return (
    <ActionIcon
      icon={BellRingIcon}
      size={DESKTOP_HEADER_ICON_SMALL_SIZE}
      title={tNotification('task.reminder.entry')}
      onClick={handleClick}
    />
  );
});

ReminderSettingsButton.displayName = 'ReminderSettingsButton';

export default ReminderSettingsButton;
