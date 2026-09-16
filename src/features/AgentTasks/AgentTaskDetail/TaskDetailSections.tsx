import { isReminderTaskConfig } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import TaskActivities from './TaskActivities';
import TaskArtifacts from './TaskArtifacts';
import TaskDetailAssignee from './TaskDetailAssignee';
import TaskDetailRunPauseAction from './TaskDetailRunPauseAction';
import TaskDetailTitleInput from './TaskDetailTitleInput';
import TaskInstruction from './TaskInstruction';
import TaskModelConfig from './TaskModelConfig';
import TaskParentBar from './TaskParentBar';
import TaskProperties from './TaskProperties';
import TaskReminderPanel from './TaskReminderPanel';
import TaskSubtasks from './TaskSubtasks';
import TaskVerifyConfig from './TaskVerifyConfig';

/**
 * The scrollable body sections of a task detail, shared by the full-page
 * `/task/[tid]` route and the chat-side Portal (and by mobile, which only swaps
 * the header chrome). All children read the active task from the task store, so
 * the host is responsible for setting `activeTaskId` (e.g. via `setActiveTaskId`)
 * before rendering this.
 *
 * A reminder task (`config.reminder`) is delivered by the scheduler tick without
 * ever running an agent, so the assignee / model / verify / run controls are
 * replaced by `TaskReminderPanel` rather than shown as dead controls.
 */
const TaskDetailSections = memo(() => {
  // Desktop keeps the two-column header (controls left, properties pinned right).
  // A phone cannot fit 200px of properties next to a 200px model picker, so the
  // whole header collapses into a single stack under the title.
  const isMobile = useIsMobile();
  const isReminder = useTaskStore((s) =>
    isReminderTaskConfig(taskDetailSelectors.activeTaskDetail(s)?.config),
  );

  const headerControls = isReminder ? null : (
    <Flexbox
      horizontal
      align={'center'}
      gap={8}
      style={isMobile ? { flexWrap: 'wrap' } : undefined}
    >
      <TaskDetailAssignee />
      <TaskModelConfig />
    </Flexbox>
  );

  return (
    <>
      <Flexbox gap={4} style={{ paddingBlock: '24px 36px' }}>
        <TaskDetailTitleInput />
        {isMobile ? (
          <Flexbox align={'stretch'} gap={12} style={{ width: '100%' }}>
            <TaskParentBar />
            {headerControls}
            <TaskProperties />
            {!isReminder && (
              <Flexbox align={'stretch'}>
                <TaskDetailRunPauseAction />
              </Flexbox>
            )}
          </Flexbox>
        ) : (
          <Flexbox horizontal align={'flex-start'} gap={16} justify={'space-between'}>
            <Flexbox align={'flex-start'} flex={1} gap={16}>
              <TaskParentBar />
              {headerControls}
              {!isReminder && <TaskDetailRunPauseAction />}
            </Flexbox>
            <TaskProperties />
          </Flexbox>
        )}
      </Flexbox>
      <Flexbox gap={24} style={{ paddingBottom: 120 }}>
        {isReminder && <TaskReminderPanel />}
        <TaskInstruction />
        {!isReminder && <TaskVerifyConfig />}
        <TaskSubtasks />
        <TaskArtifacts />
        <TaskActivities />
      </Flexbox>
    </>
  );
});

export default TaskDetailSections;
