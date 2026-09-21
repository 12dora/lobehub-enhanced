/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import BuiltinSkillItem from './BuiltinSkillItem';

const mocks = vi.hoisted(() => ({
  adminScopeRef: { current: null as null | Record<string, unknown> },
  toolState: { uninstalledBuiltinTools: [] as string[] },
}));

vi.mock('@lobehub/ui', () => ({
  Avatar: () => <span />,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  stopPropagation: () => {},
}));

vi.mock('antd-style', () => ({
  createStaticStyles: (
    creator: (tokens: {
      css: () => string;
      cssVar: Record<string, string>;
    }) => Record<string, string>,
  ) => creator({ css: () => '', cssVar: {} }),
  cssVar: {},
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ extra, title }: { extra?: ReactNode; title: ReactNode }) => (
    <div data-testid="nav-item">
      <span>{title}</span>
      <span data-testid="nav-extra">{extra}</span>
    </div>
  ),
}));

vi.mock('@/features/SkillEnabledSwitch', () => ({
  default: ({ identifier }: { identifier: string }) => (
    <div data-identifier={identifier} data-testid="skill-enabled-switch" />
  ),
}));

vi.mock('@/features/SkillStore/SkillDetail', () => ({
  createBuiltinSkillDetailModal: vi.fn(),
}));

vi.mock('@/features/AdminToolScope', () => ({
  useAdminToolScope: () => mocks.adminScopeRef.current,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true, reason: '' }),
}));

vi.mock('@/store/tool', () => ({
  useToolStore: <T,>(selector: (state: typeof mocks.toolState) => T): T =>
    selector(mocks.toolState),
}));

vi.mock('@/store/tool/selectors', () => ({
  builtinToolSelectors: {
    isSkillEnabled:
      (identifier: string) =>
      (state: typeof mocks.toolState): boolean =>
        !state.uninstalledBuiltinTools.includes(identifier),
  },
}));

const renderRow = (identifier: string) =>
  render(<BuiltinSkillItem identifier={identifier} title={identifier} onSelect={vi.fn()} />);

beforeEach(() => {
  mocks.adminScopeRef.current = null;
  // Everything outside RECOMMENDED_SKILLS defaults to uninstalled.
  mocks.toolState.uninstalledBuiltinTools = [
    'lobe-calculator',
    'lobe-dingtalk-approval',
    'lobe-enterprise-lookup',
  ];
});

describe('BuiltinSkillItem', () => {
  it('offers the enable switch for an ordinary uninstalled builtin tool', () => {
    renderRow('lobe-calculator');

    expect(screen.getByTestId('skill-enabled-switch').dataset.identifier).toBe('lobe-calculator');
  });

  // These tools run on the deployment capability flag and ignore the per-user
  // list, so a switch (and an "off" tag) would contradict what happens in chat.
  it.each(['lobe-dingtalk-approval', 'lobe-enterprise-lookup'])(
    'shows %s as administrator-governed with no control',
    (identifier) => {
      renderRow(identifier);

      expect(screen.queryByTestId('skill-enabled-switch')).toBeNull();
      expect(screen.getByTestId('nav-extra').textContent).toBe(
        'tools.skillEnabled.platformManaged',
      );
    },
  );

  it('renders no personal control under the admin org scope', () => {
    mocks.adminScopeRef.current = {};

    renderRow('lobe-calculator');

    expect(screen.queryByTestId('skill-enabled-switch')).toBeNull();
    expect(screen.getByTestId('nav-extra').textContent).toBe('');
  });
});
