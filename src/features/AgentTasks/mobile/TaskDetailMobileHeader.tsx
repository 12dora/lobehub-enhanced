'use client';

import { ChatHeader } from '@lobehub/ui/mobile';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useIsMobile } from '@/hooks/useIsMobile';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

import TaskDetailHeaderActions from '../AgentTaskDetail/TaskDetailHeaderActions';
import ReminderSettingsButton from '../ReminderSettings';

interface TaskDetailMobileHeaderProps {
  /** Task identifier from the route (e.g. `T-1`). */
  taskId?: string;
}

/**
 * Mobile chrome for `/task/:taskId` (and `/agent/:aid/task/:taskId`). The desktop
 * `NavHeader` only carries a breadcrumb, which leaves the in-app browser (DingTalk)
 * with no back affordance at all. Renders nothing on desktop.
 *
 * `useWorkspaceAwareNavigate` re-prefixes `/tasks` with the active workspace slug,
 * so the back target stays inside the current workspace.
 */
const TaskDetailMobileHeader = memo<TaskDetailMobileHeaderProps>(({ taskId }) => {
  const isMobile = useIsMobile();
  const { t } = useTranslation(['common', 'chat']);
  const navigate = useWorkspaceAwareNavigate();

  if (!isMobile) return null;

  return (
    <ChatHeader
      showBackButton
      center={<ChatHeader.Title title={taskId || t('tab.tasks')} />}
      data-testid={'task-detail-mobile-header'}
      style={mobileHeaderSticky}
      right={
        <>
          <ReminderSettingsButton />
          <TaskDetailHeaderActions />
        </>
      }
      onBackClick={() => navigate('/tasks')}
    />
  );
});

TaskDetailMobileHeader.displayName = 'TaskDetailMobileHeader';

export default TaskDetailMobileHeader;
