/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import InboxButton from './InboxButton';

const mocks = vi.hoisted(() => ({
  hook: { enabled: true, unreadCount: 0 },
}));

vi.mock('./useInboxUnreadCount', () => ({
  useInboxUnreadCount: () => mocks.hook,
}));

vi.mock('./InboxDrawer', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="inbox-drawer" /> : null),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick, title }: { onClick?: () => void; title?: string }) => (
    <button aria-label={title} type="button" onClick={onClick} />
  ),
}));

vi.mock('antd', () => ({
  Badge: ({ children, dot }: { children?: ReactNode; dot?: boolean }) => (
    <span data-dot={String(Boolean(dot))}>{children}</span>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  mocks.hook = { enabled: true, unreadCount: 0 };
});

describe('InboxButton', () => {
  /**
   * `enabled` is now login-only (see useInboxUnreadCount) — this asserts the button
   * itself has no second gate that would hide the bell from non-business deployments.
   */
  it('renders the bell whenever the inbox hook reports enabled', () => {
    render(<InboxButton />);

    expect(screen.getByRole('button', { name: 'inbox.title' })).toBeTruthy();
  });

  it('renders nothing for a signed-out visitor', () => {
    mocks.hook = { enabled: false, unreadCount: 0 };

    const { container } = render(<InboxButton />);

    expect(container.innerHTML).toBe('');
  });

  it('marks the badge only when there is something unread', () => {
    const read = render(<InboxButton />);
    expect(read.container.querySelector('[data-dot]')?.getAttribute('data-dot')).toBe('false');
    read.unmount();

    mocks.hook = { enabled: true, unreadCount: 3 };
    const unread = render(<InboxButton />);
    expect(unread.container.querySelector('[data-dot]')?.getAttribute('data-dot')).toBe('true');
  });

  it('toggles the drawer on click', () => {
    render(<InboxButton />);

    expect(screen.queryByTestId('inbox-drawer')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'inbox.title' }));
    expect(screen.getByTestId('inbox-drawer')).toBeTruthy();
  });
});
