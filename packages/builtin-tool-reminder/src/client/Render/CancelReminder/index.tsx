'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleSlashIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { CancelReminderParams, CancelReminderState } from '../../../types';

const styles = createStaticStyles(({ css }) => ({
  row: css`
    display: flex;
    gap: 6px;
    align-items: center;
  `,
}));

/** `cancelReminder` result: a single confirmation line. */
export const CancelReminderRender = memo<
  BuiltinRenderProps<CancelReminderParams, CancelReminderState>
>(({ args, pluginState }) => {
  const { t } = useTranslation('plugin');

  const taskId = pluginState?.taskId ?? args?.taskId;

  if (!pluginState?.success && !taskId) return null;

  return (
    <div className={styles.row}>
      <Icon icon={CircleSlashIcon} size={14} style={{ color: cssVar.colorTextSecondary }} />
      <Text fontSize={13}>{t('builtins.lobe-reminder.render.cancel.done')}</Text>
    </div>
  );
});

CancelReminderRender.displayName = 'CancelReminderRender';

export default CancelReminderRender;
