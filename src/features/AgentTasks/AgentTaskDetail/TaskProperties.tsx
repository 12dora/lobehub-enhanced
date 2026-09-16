import { isReminderTaskConfig, type TaskPriority, type TaskStatus } from '@lobechat/types';
import { Block, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import TaskPriorityTag from '../features/TaskPriorityTag';
import TaskStatusTag from '../features/TaskStatusTag';
import TaskTriggerTag from '../features/TaskTriggerTag';
import TaskScheduleConfig from './TaskScheduleConfig';

interface StatusMeta {
  labelKey: string;
}

const STATUS_META: Record<TaskStatus, StatusMeta> = {
  backlog: { labelKey: 'status.backlog' },
  canceled: { labelKey: 'status.canceled' },
  completed: { labelKey: 'status.completed' },
  failed: { labelKey: 'status.failed' },
  paused: { labelKey: 'status.paused' },
  running: { labelKey: 'status.running' },
  scheduled: { labelKey: 'status.scheduled' },
};

interface PriorityMeta {
  labelKey: string;
}

const PRIORITY_META: Record<TaskPriority, PriorityMeta> = {
  0: { labelKey: 'priority.none' },
  1: { labelKey: 'priority.urgent' },
  2: { labelKey: 'priority.high' },
  3: { labelKey: 'priority.normal' },
  4: { labelKey: 'priority.low' },
};

const TaskProperties = memo(() => {
  const { t } = useTranslation(['chat', 'common']);
  // Mobile stacks the properties panel under the title instead of pinning it to
  // a fixed 200px right column that would be pushed off a ~390px viewport.
  const isMobile = useIsMobile();

  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const status = useTaskStore(taskDetailSelectors.activeTaskStatus) as TaskStatus | undefined;
  const priority = useTaskStore(taskDetailSelectors.activeTaskPriority);
  const heartbeatInterval = useTaskStore(taskDetailSelectors.activeTaskPeriodicInterval);
  const automationMode = useTaskStore(taskDetailSelectors.activeTaskAutomationMode);
  const schedulePattern = useTaskStore(taskDetailSelectors.activeTaskSchedulePattern);
  const scheduleTimezone = useTaskStore(taskDetailSelectors.activeTaskScheduleTimezone);
  // A reminder task owns its schedule through the reminder panel (and the body
  // the assistant re-interprets), so the cron editor must not be reachable here.
  const isReminder = useTaskStore((s) =>
    isReminderTaskConfig(taskDetailSelectors.activeTaskDetail(s)?.config),
  );

  if (!taskId) return null;

  const statusMeta = status ? STATUS_META[status] : STATUS_META.backlog;
  const priorityMeta = PRIORITY_META[priority as TaskPriority] ?? PRIORITY_META[0];

  return (
    <Block
      data-testid={'task-properties'}
      gap={4}
      padding={4}
      variant={'outlined'}
      width={isMobile ? '100%' : 200}
    >
      <TaskStatusTag status={status} taskIdentifier={taskId}>
        <Block
          clickable
          horizontal
          align="center"
          gap={10}
          paddingBlock={4}
          paddingInline={8}
          variant={'borderless'}
        >
          <TaskStatusTag disableDropdown size={16} status={status} taskIdentifier={taskId} />
          <Text weight={500}>{t(`taskDetail.${statusMeta.labelKey}` as never)}</Text>
        </Block>
      </TaskStatusTag>

      <TaskPriorityTag priority={priority} taskIdentifier={taskId}>
        <Block
          clickable
          horizontal
          align="center"
          gap={10}
          paddingBlock={4}
          paddingInline={8}
          variant={'borderless'}
        >
          <TaskPriorityTag disableDropdown priority={priority} size={16} taskIdentifier={taskId} />
          <Text weight={500}>{t(`taskDetail.${priorityMeta.labelKey}` as never)}</Text>
        </Block>
      </TaskPriorityTag>

      {isReminder ? (
        <Block
          horizontal
          align="center"
          gap={10}
          paddingBlock={4}
          paddingInline={8}
          variant={'borderless'}
        >
          <TaskTriggerTag
            automationMode={automationMode}
            heartbeatInterval={heartbeatInterval}
            mode="inline"
            schedulePattern={schedulePattern}
            scheduleTimezone={scheduleTimezone}
          />
        </Block>
      ) : (
        <TaskScheduleConfig>
          <Block
            clickable
            horizontal
            align="center"
            gap={10}
            paddingBlock={4}
            paddingInline={8}
            variant={'borderless'}
          >
            <TaskTriggerTag
              automationMode={automationMode}
              heartbeatInterval={heartbeatInterval}
              mode="inline"
              schedulePattern={schedulePattern}
              scheduleTimezone={scheduleTimezone}
            />
          </Block>
        </TaskScheduleConfig>
      )}
    </Block>
  );
});

export default TaskProperties;
