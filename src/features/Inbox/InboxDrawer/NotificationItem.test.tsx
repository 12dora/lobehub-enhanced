/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NotificationItem from './NotificationItem';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openDetail: vi.fn(),
}));

vi.mock('./NotificationDetailModal', () => ({
  createNotificationDetailModal: mocks.openDetail,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick }: { onClick?: (e: unknown) => void }) => (
    <button aria-label="archive" type="button" onClick={onClick} />
  ),
  Block: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <div onClick={onClick}>{children}</div>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <i />,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Tag: ({ children, color }: { children?: ReactNode; color?: string }) => (
    <span data-color={color ?? ''} data-testid="type-tag">
      {children}
    </span>
  ),
}));

/** The app installs dayjs' relativeTime plugin globally; the suite only needs a stable string. */
vi.mock('dayjs', () => ({
  default: () => ({ fromNow: () => 'just now' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const renderItem = (overrides: Record<string, unknown> = {}) =>
  render(
    <NotificationItem
      content={'Daily digest ready'}
      createdAt={new Date('2026-09-15T00:00:00Z')}
      id={'n1'}
      isRead={false}
      title={'每日晨报'}
      type={'task_run_completed'}
      onArchive={vi.fn()}
      onMarkAsRead={vi.fn()}
      {...(overrides as any)}
    />,
  );

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.openDetail.mockReset();
});

describe('NotificationItem', () => {
  it('labels a task row with its event type', () => {
    renderItem({ category: 'task' });

    expect(screen.getByTestId('type-tag').textContent).toBe('task.event.task_run_completed');
    expect(screen.getByText('每日晨报')).toBeTruthy();
    expect(screen.getByText('Daily digest ready')).toBeTruthy();
  });

  it('colors failure and waiting rows so they stand out', () => {
    renderItem({ category: 'task', type: 'task_run_failed' });
    expect(screen.getByTestId('type-tag').getAttribute('data-color')).toBe('error');

    screen.getByTestId('type-tag').remove();
    renderItem({ category: 'task', type: 'task_waiting_for_user' });
    expect(screen.getByTestId('type-tag').getAttribute('data-color')).toBe('warning');
  });

  it('does not chip a non-task category or an unknown task type', () => {
    renderItem({ category: 'generation', type: 'image_generation_completed' });
    expect(screen.queryByTestId('type-tag')).toBeNull();

    renderItem({ category: 'task', type: 'task_made_up' });
    expect(screen.queryByTestId('type-tag')).toBeNull();
  });

  it('keeps the existing detail-modal flow, with the action routed to actionUrl', () => {
    const onMarkAsRead = vi.fn();
    renderItem({ actionUrl: '/task/T-7', category: 'task', onMarkAsRead });

    fireEvent.click(screen.getByText('每日晨报'));

    expect(onMarkAsRead).toHaveBeenCalledWith('n1');
    expect(mocks.openDetail).toHaveBeenCalledTimes(1);
    mocks.openDetail.mock.calls[0][0].onAction();
    expect(mocks.navigate).toHaveBeenCalledWith('/task/T-7');
  });
});
