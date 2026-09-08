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
    isAgentPlatformManagedById: () => () => mocks.isPlatformManaged,
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

  it('renders nothing for a platform-managed agent, whose params the admin owns', () => {
    mocks.isPlatformManaged = true;

    const { container } = render(<Params />);

    expect(container).toBeEmptyDOMElement();
  });

  it('withholds the action for a managed agent even while loading', () => {
    mocks.isLoading = true;
    mocks.isPlatformManaged = true;

    const { container } = render(<Params />);

    expect(container).toBeEmptyDOMElement();
  });
});
