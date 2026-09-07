/**
 * @vitest-environment happy-dom
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Item from './Item';

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
      canSetBuiltinSkillDistribution: (identifier: string) => boolean;
      isBuiltinSkillEnabled: (identifier: string) => boolean;
      toggleBuiltinSkill: ReturnType<typeof vi.fn>;
    },
    permissions: { create_content: true, edit_own_content: true },
    toolState,
    useToolStore,
  };
});

vi.mock('@lobehub/ui', () => ({
  Avatar: () => <div data-testid="avatar" />,
  Block: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <div onClick={onClick}>{children}</div>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  stopPropagation: () => {},
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Tag: ({ children }: { children?: ReactNode }) => <span data-testid="tag">{children}</span>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../style', () => ({
  itemStyles: { container: '', description: '', title: '' },
}));

vi.mock('@/features/SkillEnabledSwitch', () => ({
  default: ({
    checked,
    identifier,
    kind,
    onToggle,
  }: {
    checked?: boolean;
    identifier: string;
    kind: string;
    onToggle?: (next: boolean) => void;
  }) => (
    <button
      data-checked={String(checked)}
      data-identifier={identifier}
      data-kind={kind}
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

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: 'create_content' | 'edit_own_content') => ({
    allowed: mocks.permissions[action],
    reason: '',
  }),
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

describe('SkillStore builtin Item', () => {
  beforeEach(() => {
    mocks.adminScope = null;
    mocks.toolState.disabledBuiltinIds = [];
    mocks.toolState.setSkillEnabled.mockClear();
    mocks.toolState.setSkillEnabled.mockResolvedValue(undefined);
  });

  it('renders the enable switch instead of install / uninstall actions', () => {
    render(<Item identifier="lobe-artifacts" title="Artifacts" />);

    const toggle = screen.getByTestId('skill-enabled-switch');
    expect(toggle).toHaveAttribute('data-kind', 'builtin');
    expect(toggle).toHaveAttribute('data-checked', 'true');
    expect(screen.queryByTestId('tag')).toBeNull();
  });

  it('disables the skill through setSkillEnabled with kind builtin', async () => {
    render(<Item identifier="lobe-artifacts" title="Artifacts" />);

    await userEvent.click(screen.getByTestId('skill-enabled-switch'));

    await waitFor(() => {
      expect(mocks.toolState.setSkillEnabled).toHaveBeenCalledWith({
        enabled: false,
        identifier: 'lobe-artifacts',
        kind: 'builtin',
      });
    });
  });

  it('marks a disabled skill with a tag', () => {
    mocks.toolState.disabledBuiltinIds = ['lobe-artifacts'];
    render(<Item identifier="lobe-artifacts" title="Artifacts" />);

    expect(screen.getByTestId('skill-enabled-switch')).toHaveAttribute('data-checked', 'false');
    expect(screen.getByTestId('tag')).toHaveTextContent('tools.skillEnabled.off');
  });

  it('writes org-wide availability under the admin scope', async () => {
    const toggleBuiltinSkill = vi.fn().mockResolvedValue(undefined);
    mocks.adminScope = {
      canSetBuiltinSkillDistribution: () => true,
      isBuiltinSkillEnabled: () => true,
      toggleBuiltinSkill,
    };
    render(<Item identifier="lobe-artifacts" title="Artifacts" />);

    await userEvent.click(screen.getByTestId('skill-enabled-switch'));

    await waitFor(() => {
      expect(toggleBuiltinSkill).toHaveBeenCalledWith('lobe-artifacts', false);
    });
    expect(mocks.toolState.setSkillEnabled).not.toHaveBeenCalled();
  });

  it('ignores the toggle when the admin lacks the builtin override permission', async () => {
    const toggleBuiltinSkill = vi.fn();
    mocks.adminScope = {
      canSetBuiltinSkillDistribution: () => false,
      isBuiltinSkillEnabled: () => true,
      toggleBuiltinSkill,
    };
    render(<Item identifier="lobe-artifacts" title="Artifacts" />);

    await userEvent.click(screen.getByTestId('skill-enabled-switch'));

    expect(toggleBuiltinSkill).not.toHaveBeenCalled();
  });
});
