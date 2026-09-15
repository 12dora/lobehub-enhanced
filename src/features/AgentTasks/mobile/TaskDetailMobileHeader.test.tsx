/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TaskDetailMobileHeader from './TaskDetailMobileHeader';

const mocks = vi.hoisted(() => ({
  isMobile: true,
  navigate: vi.fn(),
  taskDetailMap: {} as Record<string, { identifier?: string; name?: string } | undefined>,
}));

vi.mock('@lobehub/ui/mobile', () => {
  const ChatHeader = ({
    center,
    onBackClick,
    right,
    showBackButton,
  }: {
    center?: ReactNode;
    onBackClick?: () => void;
    right?: ReactNode;
    showBackButton?: boolean;
  }) => (
    <header data-testid="chat-header">
      {showBackButton && (
        <button data-testid="back-button" type="button" onClick={() => onBackClick?.()}>
          back
        </button>
      )}
      <div data-testid="header-center">{center}</div>
      <div data-testid="header-right">{right}</div>
    </header>
  );
  ChatHeader.Title = ({ desc, title }: { desc?: ReactNode; title?: ReactNode }) => (
    <>
      <span data-testid="header-title">{title}</span>
      {desc ? <span data-testid="header-desc">{desc}</span> : null}
    </>
  );

  return { ChatHeader };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: () => mocks.isMobile,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('../AgentTaskDetail/TaskDetailHeaderActions', () => ({
  default: () => <div data-testid="task-detail-header-actions" />,
}));

vi.mock('../ReminderSettings', () => ({
  default: () => <div data-testid="reminder-settings-button" />,
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ activeTaskId: undefined, taskDetailMap: mocks.taskDetailMap }),
}));

vi.mock('@/store/task/selectors', () => ({
  taskDetailSelectors: {
    activeTaskDetail: (s: { activeTaskId?: string; taskDetailMap: Record<string, unknown> }) =>
      s.activeTaskId ? s.taskDetailMap[s.activeTaskId] : undefined,
  },
}));

describe('TaskDetailMobileHeader', () => {
  beforeEach(() => {
    mocks.isMobile = true;
    mocks.navigate.mockClear();
    mocks.taskDetailMap = {
      task_KEGabUWa1n5f: { identifier: 'T-1', name: '移动端布局检查' },
    };
  });

  it('titles the header with the loaded identifier, never the raw route id', () => {
    render(<TaskDetailMobileHeader taskId="task_KEGabUWa1n5f" />);

    expect(screen.getByTestId('chat-header')).toBeInTheDocument();
    expect(screen.getByTestId('header-title')).toHaveTextContent('T-1');
    expect(screen.getByTestId('header-title')).not.toHaveTextContent('task_KEGabUWa1n5f');
    expect(screen.queryByText('task_KEGabUWa1n5f')).not.toBeInTheDocument();
  });

  it('renders the task name as the secondary line', () => {
    render(<TaskDetailMobileHeader taskId="task_KEGabUWa1n5f" />);

    expect(screen.getByTestId('header-desc')).toHaveTextContent('移动端布局检查');
  });

  it('shows the generic tasks label while the detail is still loading', () => {
    mocks.taskDetailMap = {};

    render(<TaskDetailMobileHeader taskId="task_KEGabUWa1n5f" />);

    expect(screen.getByTestId('header-title')).toHaveTextContent('tab.tasks');
    expect(screen.queryByTestId('header-desc')).not.toBeInTheDocument();
  });

  it('falls back to the task name when the detail carries no identifier', () => {
    mocks.taskDetailMap = { task_KEGabUWa1n5f: { name: '移动端布局检查' } };

    render(<TaskDetailMobileHeader taskId="task_KEGabUWa1n5f" />);

    expect(screen.getByTestId('header-title')).toHaveTextContent('移动端布局检查');
    expect(screen.queryByTestId('header-desc')).not.toBeInTheDocument();
  });

  it('falls back to the active task detail when no route key is given', () => {
    render(<TaskDetailMobileHeader />);

    expect(screen.getByTestId('header-title')).toHaveTextContent('tab.tasks');
  });

  it('keeps the reminder settings and overflow actions reachable', () => {
    render(<TaskDetailMobileHeader taskId="task_KEGabUWa1n5f" />);

    expect(screen.getByTestId('reminder-settings-button')).toBeInTheDocument();
    expect(screen.getByTestId('task-detail-header-actions')).toBeInTheDocument();
  });

  it('navigates back to the task list (workspace-aware)', () => {
    render(<TaskDetailMobileHeader taskId="task_KEGabUWa1n5f" />);

    fireEvent.click(screen.getByTestId('back-button'));

    expect(mocks.navigate).toHaveBeenCalledWith('/tasks');
  });

  it('renders nothing on desktop', () => {
    mocks.isMobile = false;

    const { container } = render(<TaskDetailMobileHeader taskId="task_KEGabUWa1n5f" />);

    expect(container).toBeEmptyDOMElement();
  });
});
