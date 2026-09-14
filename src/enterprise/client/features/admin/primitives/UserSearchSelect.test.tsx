/**
 * Out-of-order remote search responses must not overwrite the latest query.
 * Typed text must not silently become a userId unless `allowRawId` is picked.
 * @vitest-environment happy-dom
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import UserSearchSelect from './UserSearchSelect';

const search = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { defaultValue?: string; id?: string }) =>
      opts?.defaultValue ?? (opts?.id ? `${k}:${opts.id}` : k),
  }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: () => '' }),
  cssVar: {},
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  AutoComplete: ({
    onChange,
    options,
    value,
  }: {
    onChange?: (v: string) => void;
    options?: { label: ReactNode; value: string }[];
    value?: string;
  }) => (
    <div>
      <input
        data-testid="user-search-input"
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
      />
      <ul data-testid="user-search-options">
        {(options ?? []).map((o) => (
          <li data-testid={`opt-${o.value}`} key={o.value} onClick={() => onChange?.(o.value)}>
            {o.label}
          </li>
        ))}
      </ul>
    </div>
  ),
}));

vi.mock('@/enterprise/client/services/adminUsers', () => ({
  adminUsersService: {
    search: (...args: unknown[]) => search(...args),
  },
}));

describe('UserSearchSelect request sequencing', () => {
  beforeEach(() => {
    search.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps only the latest query options when responses resolve out of order', async () => {
    const resolvers: Record<string, (v: unknown) => void> = {};

    search.mockImplementation(({ q }: { q: string }) => {
      return new Promise((resolve) => {
        resolvers[q] = resolve;
      });
    });

    render(<UserSearchSelect enabled onChange={vi.fn()} />);

    const input = screen.getByTestId('user-search-input');
    fireEvent.change(input, { target: { value: 'alice' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    fireEvent.change(input, { target: { value: 'bob' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(search).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolvers.bob!({
        items: [{ email: 'bob@ex.com', fullName: 'Bob', id: 'user-bob', username: 'bob' }],
      });
    });
    expect(screen.getByTestId('opt-user-bob')).toBeTruthy();

    await act(async () => {
      resolvers.alice!({
        items: [{ email: 'alice@ex.com', fullName: 'Alice', id: 'user-alice', username: 'alice' }],
      });
    });

    expect(screen.getByTestId('opt-user-bob')).toBeTruthy();
    expect(screen.queryByTestId('opt-user-alice')).toBeNull();
  });

  it('does not request when enabled is false', async () => {
    render(<UserSearchSelect enabled={false} onChange={vi.fn()} />);
    const input = screen.getByTestId('user-search-input');
    fireEvent.change(input, { target: { value: 'alice' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(search).not.toHaveBeenCalled();
    expect(screen.getByText(/userSearch.noPermission|No permission/i)).toBeTruthy();
  });

  it('does not silently commit typed text as a user id', async () => {
    const onChange = vi.fn();
    search.mockResolvedValue({ items: [] });
    render(<UserSearchSelect enabled onChange={onChange} />);

    fireEvent.change(screen.getByTestId('user-search-input'), { target: { value: 'alice' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('opt-__use_typed__:alice')).toBeNull();
  });

  it('exposes an explicit use-id option only when allowRawId is set', async () => {
    const onChange = vi.fn();
    search.mockResolvedValue({ items: [] });
    render(<UserSearchSelect allowRawId enabled onChange={onChange} />);

    fireEvent.change(screen.getByTestId('user-search-input'), { target: { value: 'alice' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    const option = screen.getByTestId('opt-__use_typed__:alice');
    expect(option).toBeTruthy();
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith('alice');
  });
});
