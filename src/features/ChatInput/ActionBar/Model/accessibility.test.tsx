/**
 * @vitest-environment happy-dom
 *
 * Keyboard/screen-reader contract of the platform-managed model pill, exercised against
 * the REAL Tooltip: a mocked tooltip would not prove that the wrapper it clones keeps the
 * focusability and the aria wiring the explanation depends on.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import chatCopy from '@/locales/default/chat';

import ModelSwitch from './index';

const mocks = vi.hoisted(() => ({
  agentId: 'agent-1',
  isPlatformManaged: true,
  model: 'gpt-5.5',
  permission: { allowed: true, reason: undefined as string | undefined },
  provider: 'openai',
  updateAgentConfigById: vi.fn(),
}));

vi.mock('react-i18next', async () => {
  const chat = (await import('@/locales/default/chat')).default as Record<string, string>;

  return {
    useTranslation: () => ({ t: (key: string) => chat[key] ?? key }),
  };
});

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => mocks.permission,
}));

vi.mock('../../hooks/useAgentId', () => ({ useAgentId: () => mocks.agentId }));

vi.mock('@/business/client/hooks/useBusinessAgentMode', () => ({
  useBusinessModelModeConfig: () => (params: unknown) => params,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) =>
    selector({ updateAgentConfigById: mocks.updateAgentConfigById }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentModelById: () => () => mocks.model,
    getAgentModelProviderById: () => () => mocks.provider,
    isAgentPlatformManagedById: () => () => mocks.isPlatformManaged,
  },
}));

vi.mock('@/features/ModelSwitchPanel', () => ({
  default: ({ children }: { children?: ReactNode }) => (
    <div data-testid="model-switch-panel">{children}</div>
  ),
}));

vi.mock('@lobehub/icons', () => ({
  ModelIcon: () => <svg data-testid="model-icon" />,
}));

describe('ModelSwitch managed accessibility', () => {
  beforeEach(() => {
    mocks.agentId = 'agent-1';
    mocks.isPlatformManaged = true;
    mocks.model = 'gpt-5.5';
    mocks.permission = { allowed: true, reason: undefined };
  });

  it('puts the managed pill in the tab order', async () => {
    render(<ModelSwitch />);

    const trigger = screen.getByRole('button');
    expect(trigger).toHaveAttribute('tabindex', '0');

    await userEvent.tab();

    expect(trigger).toHaveFocus();
  });

  it('names the pill after the model and describes why it is fixed', () => {
    render(<ModelSwitch />);

    const trigger = screen.getByRole('button');
    expect(trigger).toHaveAccessibleName('gpt-5.5');
    expect(trigger).toHaveAccessibleDescription(chatCopy['modelSwitch.managedByAdmin']);
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
  });

  it('adds no tab stop for an unmanaged agent', () => {
    mocks.isPlatformManaged = false;

    const { container } = render(<ModelSwitch />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('[tabindex]')).toBeNull();
  });
});
