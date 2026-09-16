import { ActionIcon, Flexbox } from '@lobehub/ui';
import { Plus } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { InboxButton } from '@/features/Inbox';
import NavHeader from '@/features/NavHeader';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useIsMobile } from '@/hooks/useIsMobile';
import { usePermission } from '@/hooks/usePermission';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';
import type { TaskViewMode } from '@/store/task/slices/list/initialState';

import { createTaskModal } from '../CreateTaskModal';
import TaskListMobileHeader from '../mobile/TaskListMobileHeader';
import ReminderList from '../ReminderList';
import ReminderSettingsButton from '../ReminderSettings';
import Breadcrumb from '../shared/Breadcrumb';
import { taskDetailPath } from '../shared/taskDetailPath';
import CreateTaskInlineEntry from './CreateTaskInlineEntry';
import EmptyState from './EmptyState';
import KanbanBoard from './KanbanBoard';
import type { TaskListViewOptions } from './listViewOptions';
import { normalizeTaskListViewOptions } from './listViewOptions';
import { shouldRenderTaskAgentPanelToggle } from './taskAgentPanelToggle';
import TaskList from './TaskList';
import TaskListVisibilityFilter from './TaskListVisibilityFilter';
import TasksGroupConfig from './TasksGroupConfig';
import type { TaskSurface } from './TaskSurfaceSwitch';
import TaskSurfaceSwitch from './TaskSurfaceSwitch';

interface TaskCreateActionBehaviorParams {
  canCreateTask: boolean;
  inlineCollapsed: boolean;
  viewMode: TaskViewMode;
}

export const getTaskCreateActionBehavior = ({
  canCreateTask,
  inlineCollapsed,
  viewMode,
}: TaskCreateActionBehaviorParams) => {
  const shouldExpandInline = inlineCollapsed && viewMode === 'list';

  return {
    disabled: shouldExpandInline ? false : !canCreateTask,
    mode: shouldExpandInline ? 'inline' : 'modal',
  } as const;
};

interface AgentTasksPageProps {
  /**
   * When provided, the page is scoped to a single agent's tasks; otherwise it
   * shows tasks across all agents.
   */
  agentId?: string;
}

const AgentTasksPage = memo<AgentTasksPageProps>(({ agentId }) => {
  const navigate = useWorkspaceAwareNavigate();
  const isMobile = useIsMobile();
  // 定时提醒 is a sibling surface of the task list, not another task view mode:
  // it lists reminder objects, so none of the task view options apply to it.
  const [surface, setSurface] = useState<TaskSurface>('tasks');
  const isReminderSurface = surface === 'reminders';
  const { allowed: canCreateTask, reason } = usePermission('create_content');
  const viewMode = useTaskStore(taskListSelectors.viewMode);
  const useFetchTaskList = useTaskStore((s) => s.useFetchTaskList);
  // Keep the SWR handle only for `error` + `mutate` (the error/Retry state).
  const { error, isLoading, mutate } = useFetchTaskList(
    agentId ? { agentId } : { allAgents: true },
  );
  // Drive the loading/empty boundary off the store's own init flag, NOT SWR's
  // per-key `data`. On a scope (agent ↔ all) or visibility switch the store
  // resets `tasks` + `isTaskListInit` together (`scopeChangeResetState`), but
  // SWR still holds cached `data` for the target key — so keying `hasSettled`
  // off SWR `data` made it `true` while `tasks` was empty and flashed the "no
  // tasks" empty during the refetch. `isTaskListInit` flips true only on the
  // current scope's success and resets in lockstep with `tasks`, so the settled
  // signal never disagrees with the emptiness signal. Still resets to false on a
  // failed first load, so we surface loading only while there's no error (below).
  const isTaskListInit = useTaskStore(taskListSelectors.isTaskListInit);
  const isEmptyHero = useTaskStore(taskListSelectors.isListEmpty);
  const rawViewOptions = useGlobalStore(systemStatusSelectors.taskListViewOptions);
  const viewOptions = useMemo(() => normalizeTaskListViewOptions(rawViewOptions), [rawViewOptions]);
  const inlineCollapsed = useGlobalStore(systemStatusSelectors.taskCreateInlineCollapsed);
  const [showTaskAgentPanel, toggleTaskAgentPanel] = useGlobalStore((s) => [
    systemStatusSelectors.showTaskAgentPanel(s),
    s.toggleTaskAgentPanel,
  ]);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const routeScope = agentId ? 'agent' : 'global';
  const setViewOptions = useCallback(
    (updater: (prev: TaskListViewOptions) => TaskListViewOptions) => {
      const next = normalizeTaskListViewOptions(updater(viewOptions));
      updateSystemStatus({ taskListViewOptions: next }, 'updateTaskListViewOptions');
    },
    [updateSystemStatus, viewOptions],
  );

  const createActionBehavior = useMemo(
    () =>
      getTaskCreateActionBehavior({
        canCreateTask,
        inlineCollapsed,
        viewMode,
      }),
    [canCreateTask, inlineCollapsed, viewMode],
  );

  const handleCreateTask = useCallback(() => {
    if (createActionBehavior.mode === 'inline') {
      updateSystemStatus({ taskCreateInlineCollapsed: false }, 'expandTaskCreateInline');
      return;
    }

    if (!canCreateTask) return;
    createTaskModal({
      agentId,
      lockAssignee: !!agentId,
      onCreated: (task) => {
        navigate(taskDetailPath(task.identifier, agentId ? task.agentId : undefined));
      },
    });
  }, [agentId, canCreateTask, createActionBehavior.mode, navigate, updateSystemStatus]);

  const handleShowHiddenCompleted = useCallback(() => {
    setViewOptions((prev) => ({ ...prev, hideCompleted: false }));
  }, [setViewOptions]);

  const showTaskAgentPanelToggle = shouldRenderTaskAgentPanelToggle(isMobile);

  // Shown in the desktop breadcrumb row and, on mobile, in place of the header
  // title — the segment already names the visible surface.
  const surfaceSwitch = <TaskSurfaceSwitch value={surface} onChange={setSurface} />;

  // Same toolbar on both shells — the reminder bell and the inbox bell stay
  // reachable on mobile, they just move into the mobile ChatHeader's right slot.
  // The task-only view controls hide while 定时提醒 is the active surface.
  const headerActions = (
    <Flexbox horizontal align={'center'} gap={4}>
      {!isReminderSurface && !agentId && <TaskListVisibilityFilter />}
      {!isReminderSurface && (inlineCollapsed || viewMode === 'kanban') && (
        <ActionIcon
          disabled={createActionBehavior.disabled}
          icon={Plus}
          size={DESKTOP_HEADER_ICON_SMALL_SIZE}
          title={createActionBehavior.disabled ? reason : undefined}
          onClick={handleCreateTask}
        />
      )}
      {!isReminderSurface && <TasksGroupConfig options={viewOptions} setOptions={setViewOptions} />}
      <ReminderSettingsButton />
      <InboxButton />
      {showTaskAgentPanelToggle && (
        <ToggleRightPanelButton
          hideWhenExpanded
          expand={showTaskAgentPanel}
          onToggle={() => toggleTaskAgentPanel()}
        />
      )}
    </Flexbox>
  );

  return (
    <Flexbox flex={1} height={'100%'}>
      <TaskListMobileHeader actions={headerActions} tabs={surfaceSwitch} />
      {!isMobile && (
        <NavHeader
          right={headerActions}
          left={
            <Flexbox horizontal align={'center'} gap={8}>
              <Breadcrumb />
              {surfaceSwitch}
            </Flexbox>
          }
          styles={{
            left: {
              paddingLeft: 4,
              gap: 8,
            },
          }}
        />
      )}
      {isReminderSurface ? (
        <ReminderList />
      ) : isEmptyHero ? (
        <EmptyState agentId={agentId} />
      ) : viewMode === 'kanban' ? (
        <Flexbox flex={1} style={{ overflowX: 'auto', overflowY: 'hidden' }}>
          <KanbanBoard agentId={agentId} routeScope={routeScope} />
        </Flexbox>
      ) : (
        <WideScreenContainer
          gap={16}
          paddingBlock={16}
          wrapperStyle={{ flex: 1, overflowY: 'auto' }}
        >
          {!inlineCollapsed && <CreateTaskInlineEntry agentId={agentId} lockAssignee={!!agentId} />}
          <TaskList
            data={isTaskListInit || undefined}
            error={error}
            isLoading={isLoading || (!isTaskListInit && !error)}
            options={viewOptions}
            routeScope={routeScope}
            onRetry={() => mutate()}
            onShowHiddenCompleted={handleShowHiddenCompleted}
          />
        </WideScreenContainer>
      )}
    </Flexbox>
  );
});

export default AgentTasksPage;
