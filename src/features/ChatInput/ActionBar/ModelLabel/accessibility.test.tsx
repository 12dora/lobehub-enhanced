/**
 * @vitest-environment happy-dom
 *
 * Keyboard/screen-reader contract of the platform-managed model label, exercised against
 * the REAL Tooltip: a mocked tooltip would not prove that the wrapper it clones keeps the
 * focusability and the aria wiring the explanation depends on.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import chatCopy from '@/locales/default/chat';

import ModelLabel from './index';

const mocks = vi.hoisted(() => ({
  agentId: 'agent-1',
  displayName: 'GPT-5.5' as string | undefined,
  isModelCatalogReady: true,
  isPlatformManaged: true,
  model: 'gpt-5.5',
  modelLocked: undefined as boolean | undefined,
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
    // Mirrors the real selector: a managed agent is model-locked unless the server marked its
    // platform config as defaults-only (`platform.modelLocked === false`).
    isAgentModelLockedById: () => () => mocks.isPlatformManaged && mocks.modelLocked !== false,
  },
}));

vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: {
    getEnabledModelById: () => () =>
      mocks.displayName ? { displayName: mocks.displayName } : undefined,
  },
  aiProviderSelectors: {
    isInitAiProviderRuntimeState: () => mocks.isModelCatalogReady,
  },
  useAiInfraStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/features/ModelSwitchPanel', () => ({
  default: ({ children }: { children?: ReactNode }) => (
    <div data-testid="model-switch-panel">{children}</div>
  ),
}));

describe('ModelLabel managed accessibility', () => {
  beforeEach(() => {
    mocks.agentId = 'agent-1';
    mocks.displayName = 'GPT-5.5';
    mocks.isModelCatalogReady = true;
    mocks.isPlatformManaged = true;
    mocks.model = 'gpt-5.5';
    mocks.modelLocked = undefined;
    mocks.permission = { allowed: true, reason: undefined };
  });

  it('puts the managed label in the tab order', async () => {
    render(<ModelLabel />);

    const trigger = screen.getByRole('button');
    expect(trigger).toHaveAttribute('tabindex', '0');

    await userEvent.tab();

    expect(trigger).toHaveFocus();
  });

  it('names the label after the model and describes why it is fixed', () => {
    render(<ModelLabel />);

    const trigger = screen.getByRole('button');
    expect(trigger).toHaveAccessibleName('GPT-5.5');
    expect(trigger).toHaveAccessibleDescription(chatCopy['modelSwitch.managedByAdmin']);
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
  });

  it('adds no tab stop for an unmanaged agent', () => {
    mocks.isPlatformManaged = false;

    const { container } = render(<ModelLabel />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('[tabindex]')).toBeNull();
  });

  it('adds no tab stop when the managed agent only supplies a default model', () => {
    mocks.modelLocked = false;

    const { container } = render(<ModelLabel />);

    expect(screen.getByTestId('model-switch-panel')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('[tabindex]')).toBeNull();
  });
});
