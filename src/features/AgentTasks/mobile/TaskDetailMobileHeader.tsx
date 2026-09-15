'use client';

import { ChatHeader } from '@lobehub/ui/mobile';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

import TaskDetailHeaderActions from '../AgentTaskDetail/TaskDetailHeaderActions';
import ReminderSettingsButton from '../ReminderSettings';

interface TaskDetailMobileHeaderProps {
  /**
   * Route key for the task. This is an opaque row id (`task_KEGabUWa1n5f`) on
   * deep links, so it is only used to look the task up — never rendered.
   */
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
  // Title comes from the *loaded* detail, not the route param: `/task/:taskId`
  // carries the row id on deep links, and `T-1` is what users recognise.
  const detail = useTaskStore(
    (s) =>
      (taskId ? s.taskDetailMap[taskId] : undefined) ?? taskDetailSelectors.activeTaskDetail(s),
  );

  if (!isMobile) return null;

  const identifier = detail?.identifier;
  const name = detail?.name;
  // While the detail is still loading there is nothing meaningful to show, so
  // fall back to the generic section label rather than leaking the row id.
  const title = identifier || name || t('tab.tasks');

  return (
    <ChatHeader
      showBackButton
      center={<ChatHeader.Title desc={identifier ? name : undefined} title={title} />}
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
