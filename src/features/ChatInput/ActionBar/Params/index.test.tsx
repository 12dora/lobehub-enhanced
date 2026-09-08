/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Params from './index';

const mocks = vi.hoisted(() => ({
  agentId: 'agent-1',
  isLoading: false,
  isPlatformManaged: false,
  modelLocked: undefined as boolean | undefined,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../hooks/useAgentId', () => ({ useAgentId: () => mocks.agentId }));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    isAgentConfigLoadingById: () => () => mocks.isLoading,
    // Mirrors the real selector: a managed agent is model-locked unless the server marked its
    // platform config as defaults-only (`platform.modelLocked === false`).
    isAgentModelLockedById: () => () => mocks.isPlatformManaged && mocks.modelLocked !== false,
  },
}));

// The real Action pulls in popovers, permissions and the server config store; only its
// presence and disabled state are in scope here.
vi.mock('../components/Action', () => ({
  default: ({ disabled }: { disabled?: boolean }) => (
    <button data-disabled={String(!!disabled)} data-testid="params-action" type="button" />
  ),
}));

vi.mock('./Controls', () => ({
  default: () => <div data-testid="params-controls" />,
}));

describe('Params', () => {
  beforeEach(() => {
    mocks.agentId = 'agent-1';
    mocks.isLoading = false;
    mocks.isPlatformManaged = false;
    mocks.modelLocked = undefined;
  });

  it('renders the params action for an ordinary agent', () => {
    render(<Params />);

    expect(screen.getByTestId('params-action')).toHaveAttribute('data-disabled', 'false');
  });

  it('renders a disabled action while the config is still loading', () => {
    mocks.isLoading = true;

    render(<Params />);

    expect(screen.getByTestId('params-action')).toHaveAttribute('data-disabled', 'true');
  });

  it('keeps the action for a platform-managed agent, whose chat preferences stay editable', () => {
    mocks.isPlatformManaged = true;

    render(<Params />);

    // Only the model-params section inside Controls is withheld — see Controls.test.tsx.
    expect(screen.getByTestId('params-action')).toHaveAttribute('data-disabled', 'false');
  });

  it('keeps the action when the managed agent only supplies default params', () => {
    mocks.isPlatformManaged = true;
    mocks.modelLocked = false;

    render(<Params />);

    // Nothing is withheld at all in this mode — Controls renders the full panel.
    expect(screen.getByTestId('params-action')).toHaveAttribute('data-disabled', 'false');
  });
});
