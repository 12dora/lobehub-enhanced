/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DisplayContent from './DisplayContent';

vi.mock('@/features/Conversation/Markdown', () => ({
  default: ({ children }: { children?: ReactNode }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock('./ContentLoading', () => ({
  default: () => <div data-testid="content-loading" />,
}));

vi.mock('./RichContentRenderer', () => ({
  RichContentRenderer: () => <div data-testid="rich" />,
}));

describe('DisplayContent — loading placeholder', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders no ellipsis and no loader for an ended "..." placeholder', () => {
    const { container } = render(<DisplayContent content="..." generating={false} id="a1" />);

    expect(screen.queryByTestId('content-loading')).toBeNull();
    expect(screen.queryByTestId('markdown')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('shows the loader while the "..." placeholder is still generating', () => {
    render(<DisplayContent generating content="..." id="a1" />);

    expect(screen.getByTestId('content-loading')).toBeTruthy();
    expect(screen.queryByTestId('markdown')).toBeNull();
  });

  it('renders real content as markdown', () => {
    render(<DisplayContent content="模板还在" generating={false} id="a1" />);

    expect(screen.getByTestId('markdown').textContent).toBe('模板还在');
  });
});
