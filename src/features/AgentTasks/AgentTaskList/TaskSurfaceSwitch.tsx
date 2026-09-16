'use client';

import { Icon } from '@lobehub/ui';
import { Segmented } from '@lobehub/ui/base-ui';
import { AlarmClockIcon, ListChecksIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/** Which surface of the tasks page is shown: the task board or 定时提醒. */
export type TaskSurface = 'reminders' | 'tasks';

interface TaskSurfaceSwitchProps {
  onChange: (value: TaskSurface) => void;
  value: TaskSurface;
}

/**
 * Top-level switch between the task list/board and the scheduled reminders.
 * Reminders are a separate object from tasks, so they get a sibling surface
 * rather than another task view mode.
 */
const TaskSurfaceSwitch = memo<TaskSurfaceSwitchProps>(({ onChange, value }) => {
  const { t } = useTranslation('chat');

  const options = useMemo(
    () => [
      {
        icon: <Icon icon={ListChecksIcon} size={14} />,
        label: t('reminderList.tab.tasks'),
        value: 'tasks' as const,
      },
      {
        icon: <Icon icon={AlarmClockIcon} size={14} />,
        label: t('reminderList.tab.reminders'),
        value: 'reminders' as const,
      },
    ],
    [t],
  );

  return (
    <Segmented
      aria-label={t('reminderList.tab.reminders')}
      options={options}
      size={'small'}
      value={value}
      onChange={(next) => onChange(next as TaskSurface)}
    />
  );
});

TaskSurfaceSwitch.displayName = 'TaskSurfaceSwitch';

export default TaskSurfaceSwitch;
