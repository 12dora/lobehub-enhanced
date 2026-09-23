/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ContentLoading from './ContentLoading';

const state = vi.hoisted(() => ({ runningOp: undefined as unknown }));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/chat/selectors', () => ({
  operationSelectors: {
    getDeepestRunningOperationByMessage: () => () => state.runningOp,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/BubblesLoading', () => ({
  default: () => <div data-testid="bubbles" />,
}));

vi.mock('@/components/NeuralNetworkLoading', () => ({ default: () => null }));

describe('ContentLoading', () => {
  afterEach(() => {
    cleanup();
    state.runningOp = undefined;
  });

  it('renders nothing once no operation is running for the message (run ended)', () => {
    const { container } = render(<ContentLoading id="a1" />);

    expect(screen.queryByTestId('bubbles')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('renders the dot loader while an unlabelled operation is running', () => {
    state.runningOp = { metadata: {}, type: 'someInternalOp' };
    render(<ContentLoading id="a1" />);

    expect(screen.getByTestId('bubbles')).toBeTruthy();
  });
});
