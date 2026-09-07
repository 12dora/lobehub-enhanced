/**
 * @vitest-environment happy-dom
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Header from './Header';

const mocks = vi.hoisted(() => {
  const toolState = {
    disabledBuiltinIds: [] as string[],
    setSkillEnabled: vi.fn(),
  };

  const useToolStore = Object.assign(
    vi.fn(<T,>(selector: (state: typeof toolState) => T): T => selector(toolState)),
    { getState: vi.fn(() => toolState) },
  );

  return {
    adminScope: null as null | {
      canSetSkillAvailability: (identifier: string) => boolean;
      isBuiltinSkillEnabled: (identifier: string) => boolean;
      toggleBuiltinSkill: ReturnType<typeof vi.fn>;
    },
    close: vi.fn(),
    detail: {
      identifier: 'lobe-artifacts',
      isConnected: false,
      label: 'Artifacts',
      localizedDescription: 'Generate artifacts',
      serverName: undefined as string | undefined,
    },
    handleConnect: vi.fn(),
    toolState,
    useToolStore,
  };
});

vi.mock('@lobehub/ui', () => ({
  Avatar: () => <div data-testid="avatar" />,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span data-testid="icon" />,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useModalContext: () => ({ close: mocks.close }),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button data-testid="action-button" disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('antd-style', () => ({ cssVar: new Proxy({}, { get: () => '' }) }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./styles', () => ({
  ICON_SIZE: 56,
  styles: { header: '', icon: '', title: '' },
}));

vi.mock('./DetailContext', () => ({
  useDetailContext: () => mocks.detail,
}));

vi.mock('@/features/SkillEnabledSwitch', () => ({
  default: ({
    checked,
    disabled,
    identifier,
    kind,
    label,
    onToggle,
  }: {
    checked?: boolean;
    disabled?: boolean;
    identifier: string;
    kind: string;
    label?: string;
    onToggle?: (next: boolean) => void;
  }) => (
    <button
      data-checked={String(checked)}
      data-disabled={String(Boolean(disabled))}
      data-identifier={identifier}
      data-kind={kind}
      data-label={label}
      data-testid="skill-enabled-switch"
      type="button"
      onClick={() => onToggle?.(!checked)}
    >
      switch
    </button>
  ),
}));

vi.mock('@/features/AdminToolScope', () => ({
  useAdminToolScope: () => mocks.adminScope,
}));

vi.mock('@/features/SkillStore/SkillList/LobeHub/useSkillConnect', () => ({
  useSkillConnect: () => ({
    handleConnect: mocks.handleConnect,
    isConnected: false,
    isConnecting: false,
  }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true, reason: '' }),
}));

vi.mock('@/store/tool', () => ({ useToolStore: mocks.useToolStore }));

vi.mock('@/store/tool/selectors', () => ({
  builtinToolSelectors: {
    isSkillEnabled:
      (identifier: string, kind: string) =>
      (state: typeof mocks.toolState): boolean =>
        kind === 'builtin' && !state.disabledBuiltinIds.includes(identifier),
  },
}));

describe('SkillStore detail Header', () => {
  beforeEach(() => {
    mocks.adminScope = null;
    mocks.toolState.disabledBuiltinIds = [];
    mocks.toolState.setSkillEnabled.mockClear();
    mocks.toolState.setSkillEnabled.mockResolvedValue(undefined);
  });

  it('renders the enable switch for builtin skills instead of an install button', () => {
    render(<Header type="builtin" />);

    const toggle = screen.getByTestId('skill-enabled-switch');
    expect(toggle).toHaveAttribute('data-kind', 'builtin');
    expect(toggle).toHaveAttribute('data-checked', 'true');
    expect(screen.queryByTestId('action-button')).toBeNull();
  });

  it('re-enables a disabled builtin skill through setSkillEnabled', async () => {
    mocks.toolState.disabledBuiltinIds = ['lobe-artifacts'];
    render(<Header type="builtin" />);

    expect(screen.getByTestId('skill-enabled-switch')).toHaveAttribute('data-checked', 'false');
    await userEvent.click(screen.getByTestId('skill-enabled-switch'));

    await waitFor(() => {
      expect(mocks.toolState.setSkillEnabled).toHaveBeenCalledWith({
        enabled: true,
        identifier: 'lobe-artifacts',
        kind: 'builtin',
      });
    });
  });

  it('passes the display name to the switch for its accessible name', () => {
    render(<Header type="builtin" />);

    expect(screen.getByTestId('skill-enabled-switch')).toHaveAttribute('data-label', 'Artifacts');
  });

  it('writes org-wide availability under the admin scope instead of user settings', async () => {
    const toggleBuiltinSkill = vi.fn().mockResolvedValue(undefined);
    mocks.adminScope = {
      canSetSkillAvailability: () => true,
      isBuiltinSkillEnabled: () => true,
      toggleBuiltinSkill,
    };
    render(<Header type="builtin" />);

    expect(screen.getByTestId('skill-enabled-switch')).toHaveAttribute('data-checked', 'true');
    await userEvent.click(screen.getByTestId('skill-enabled-switch'));

    await waitFor(() => {
      expect(toggleBuiltinSkill).toHaveBeenCalledWith('lobe-artifacts', false);
    });
    expect(mocks.toolState.setSkillEnabled).not.toHaveBeenCalled();
  });

  it('reads the checked state from the admin scope', () => {
    mocks.adminScope = {
      canSetSkillAvailability: () => true,
      isBuiltinSkillEnabled: () => false,
      toggleBuiltinSkill: vi.fn(),
    };
    render(<Header type="builtin" />);

    expect(screen.getByTestId('skill-enabled-switch')).toHaveAttribute('data-checked', 'false');
  });

  it('ignores the toggle when the admin cannot set skill availability', async () => {
    const toggleBuiltinSkill = vi.fn();
    mocks.adminScope = {
      canSetSkillAvailability: () => false,
      isBuiltinSkillEnabled: () => true,
      toggleBuiltinSkill,
    };
    render(<Header type="builtin" />);

    expect(screen.getByTestId('skill-enabled-switch')).toHaveAttribute('data-disabled', 'true');
    await userEvent.click(screen.getByTestId('skill-enabled-switch'));

    expect(toggleBuiltinSkill).not.toHaveBeenCalled();
    expect(mocks.toolState.setSkillEnabled).not.toHaveBeenCalled();
  });

  it('keeps the connect button for connector skills', () => {
    render(<Header type="composio" />);

    expect(screen.queryByTestId('skill-enabled-switch')).toBeNull();
    expect(screen.getByTestId('action-button')).toHaveTextContent('tools.composio.connect');
  });
});
