/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TaskNavMenuButton from './TaskNavMenuButton';

interface MenuEntry {
  key: string;
  label: ReactNode;
}

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  showMarket: true,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  ActionIcon: ({ onClick, title }: { onClick?: () => void; title?: string }) => (
    <button data-testid="nav-menu-trigger" title={title} type="button" onClick={onClick}>
      {title}
    </button>
  ),
  Drawer: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? <div data-testid="nav-drawer">{children}</div> : null,
}));

vi.mock('antd-style', () => ({
  cssVar: new Proxy({}, { get: () => 'var(--mock)' }),
}));

vi.mock('@/components/Menu', () => ({
  default: ({
    items,
    onClick,
  }: {
    items: MenuEntry[];
    onClick?: (info: { key: string }) => void;
  }) => (
    <ul data-testid="nav-menu">
      {items.map((item) => (
        <li key={item.key}>
          <button
            data-testid={`nav-entry-${item.key}`}
            type="button"
            onClick={() => onClick?.(item)}
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: (state: unknown) => state,
  useServerConfigStore: (selector: (state: unknown) => unknown) =>
    selector({ showMarket: mocks.showMarket }),
}));

describe('TaskNavMenuButton', () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
    mocks.showMarket = true;
  });

  it('opens a drawer listing the main app entries', () => {
    render(<TaskNavMenuButton />);

    expect(screen.queryByTestId('nav-drawer')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('nav-menu-trigger'));

    expect(screen.getByTestId('nav-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('nav-entry-chat')).toHaveTextContent('tab.chat');
    expect(screen.getByTestId('nav-entry-tasks')).toHaveTextContent('tab.tasks');
    expect(screen.getByTestId('nav-entry-community')).toHaveTextContent('tab.community');
    expect(screen.getByTestId('nav-entry-me')).toHaveTextContent('tab.me');
  });

  it('hides the community entry when the marketplace flag is off', () => {
    mocks.showMarket = false;
    render(<TaskNavMenuButton />);

    fireEvent.click(screen.getByTestId('nav-menu-trigger'));

    expect(screen.queryByTestId('nav-entry-community')).not.toBeInTheDocument();
  });

  it('navigates workspace-aware and escapes for the personal Me tab', () => {
    render(<TaskNavMenuButton />);
    fireEvent.click(screen.getByTestId('nav-menu-trigger'));

    fireEvent.click(screen.getByTestId('nav-entry-chat'));
    expect(mocks.navigate).toHaveBeenCalledWith('/agent', undefined);

    fireEvent.click(screen.getByTestId('nav-menu-trigger'));
    fireEvent.click(screen.getByTestId('nav-entry-me'));
    expect(mocks.navigate).toHaveBeenCalledWith('/me', { escape: true });
  });

  it('closes the drawer after picking an entry', () => {
    render(<TaskNavMenuButton />);
    fireEvent.click(screen.getByTestId('nav-menu-trigger'));

    fireEvent.click(screen.getByTestId('nav-entry-tasks'));

    expect(screen.queryByTestId('nav-drawer')).not.toBeInTheDocument();
  });
});
