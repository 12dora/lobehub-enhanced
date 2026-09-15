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
  ChatHeader.Title = ({ title }: { title?: ReactNode }) => (
    <span data-testid="header-title">{title}</span>
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

describe('TaskDetailMobileHeader', () => {
  beforeEach(() => {
    mocks.isMobile = true;
    mocks.navigate.mockClear();
  });

  it('renders the mobile header with the task identifier as title', () => {
    render(<TaskDetailMobileHeader taskId="T-1" />);

    expect(screen.getByTestId('chat-header')).toBeInTheDocument();
    expect(screen.getByTestId('header-title')).toHaveTextContent('T-1');
  });

  it('falls back to the tasks label when the identifier is unknown', () => {
    render(<TaskDetailMobileHeader />);

    expect(screen.getByTestId('header-title')).toHaveTextContent('tab.tasks');
  });

  it('keeps the reminder settings and overflow actions reachable', () => {
    render(<TaskDetailMobileHeader taskId="T-1" />);

    expect(screen.getByTestId('reminder-settings-button')).toBeInTheDocument();
    expect(screen.getByTestId('task-detail-header-actions')).toBeInTheDocument();
  });

  it('navigates back to the task list (workspace-aware)', () => {
    render(<TaskDetailMobileHeader taskId="T-1" />);

    fireEvent.click(screen.getByTestId('back-button'));

    expect(mocks.navigate).toHaveBeenCalledWith('/tasks');
  });

  it('renders nothing on desktop', () => {
    mocks.isMobile = false;

    const { container } = render(<TaskDetailMobileHeader taskId="T-1" />);

    expect(container).toBeEmptyDOMElement();
  });
});
