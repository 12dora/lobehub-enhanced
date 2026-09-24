/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import InterventionBatchHeader from './InterventionBatchHeader';

// Assert on keys + interpolation values: they are what has to stay in sync with
// `packages/locales/src/default/chat.ts`.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `t:${key}:${JSON.stringify(options)}` : `t:${key}`,
  }),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    disabled,
    loading,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    loading?: boolean;
    onClick?: () => void;
  }) => (
    <button
      data-loading={loading ? 'true' : undefined}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  ),
}));

const renderHeader = (props: Partial<ComponentProps<typeof InterventionBatchHeader>> = {}) => {
  const handlers = { onApproveAll: vi.fn(), onRejectAll: vi.fn(), onStop: vi.fn() };
  render(<InterventionBatchHeader count={3} {...handlers} {...props} />);
  return handlers;
};

describe('InterventionBatchHeader', () => {
  it('shows the pending count with approve-all and reject-all', () => {
    const { onApproveAll, onRejectAll } = renderHeader();

    expect(
      screen.getByText('t:tool.intervention.batch.pendingCount:{"count":3}'),
    ).toBeInTheDocument();
    expect(screen.queryByText('t:tool.intervention.batch.stop')).toBeNull();

    fireEvent.click(screen.getByText('t:tool.intervention.batch.approveAll'));
    fireEvent.click(screen.getByText('t:tool.intervention.batch.rejectAll'));

    expect(onApproveAll).toHaveBeenCalledTimes(1);
    expect(onRejectAll).toHaveBeenCalledTimes(1);
  });

  it('shows approve progress, locks both buttons and offers stop', () => {
    const { onStop } = renderHeader({ progress: { current: 2, mode: 'approve', total: 3 } });

    expect(
      screen.getByText('t:tool.intervention.batch.approving:{"current":2,"total":3}'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('t:tool.intervention.batch.approveAll').closest('button'),
    ).toBeDisabled();
    expect(
      screen.getByText('t:tool.intervention.batch.rejectAll').closest('button'),
    ).toBeDisabled();

    fireEvent.click(screen.getByText('t:tool.intervention.batch.stop'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('keeps Enter on a header button away from the page-level approval hotkeys', () => {
    renderHeader();
    const pageHotkeys = vi.fn();
    window.addEventListener('keydown', pageHotkeys);

    try {
      fireEvent.keyDown(screen.getByText('t:tool.intervention.batch.rejectAll'), { key: 'Enter' });
      expect(pageHotkeys).not.toHaveBeenCalled();

      fireEvent.keyDown(screen.getByText('t:tool.intervention.batch.rejectAll'), { key: '1' });
      expect(pageHotkeys).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', pageHotkeys);
    }
  });

  it('shows reject progress without a stop button', () => {
    renderHeader({ progress: { current: 1, mode: 'reject', total: 3 } });

    expect(
      screen.getByText('t:tool.intervention.batch.rejecting:{"current":1,"total":3}'),
    ).toBeInTheDocument();
    expect(screen.queryByText('t:tool.intervention.batch.stop')).toBeNull();
    expect(
      screen.getByText('t:tool.intervention.batch.rejectAll').closest('button'),
    ).toBeDisabled();
  });
});
