// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PLATFORM_PERMISSIONS } from '@/const/platform/permissions';

import SkillListPage from './SkillListPage';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  data: { items: [{ id: 's1' }], nextCursor: 'next-cursor' } as any,
  error: undefined as unknown,
  filterResultMode: null as 'error' | 'loading' | null,
  inputs: [] as unknown[],
  isLoading: false,
  mutate: vi.fn(),
  openCreate: vi.fn(),
  pageErrorOnCursor: false,
  permissions: [] as string[],
  refreshLists: vi.fn(),
  setEnabled: vi.fn(),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: () => '' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/enterprise/client/providers/AdminAccessProvider', () => ({
  useAdminAccess: () => ({ authMethod: null, permissions: mocks.permissions }),
}));

vi.mock('@/enterprise/client/services/adminSkills', () => ({
  adminSkillsService: { create: mocks.create, setEnabled: mocks.setEnabled },
}));

vi.mock('./openCreateSkillModal', () => ({ openCreateSkillModal: mocks.openCreate }));

vi.mock('./hooks/useAdminSkills', () => ({
  refreshAdminSkillLists: mocks.refreshLists,
  useFetchAdminSkills: (input: unknown) => {
    mocks.inputs.push(structuredClone(input));
    const cursor = (input as { cursor?: string }).cursor;
    const filtered = (input as { status?: string }).status === 'draft';
    return {
      data: filtered && mocks.filterResultMode ? undefined : mocks.data,
      error:
        filtered && mocks.filterResultMode === 'error'
          ? new Error('filter offline')
          : mocks.pageErrorOnCursor && cursor
            ? new Error('page offline')
            : mocks.error,
      isLoading: filtered && mocks.filterResultMode === 'loading' ? true : mocks.isLoading,
      mutate: mocks.mutate,
    };
  },
}));

vi.mock('@lobehub/ui', () => ({
  Alert: ({ extra, message }: { extra?: ReactNode; message?: ReactNode }) => (
    <div role="alert">
      {message}
      {extra}
    </div>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Input: ({ allowClear: _allowClear, ...props }: any) => <input {...props} />,
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Switch: ({ checked, disabled, loading, onChange, size: _size, title }: any) => (
    <button
      aria-busy={Boolean(loading)}
      aria-checked={Boolean(checked)}
      aria-label={title}
      disabled={disabled}
      role="switch"
      onClick={() => onChange?.(!checked)}
    />
  ),
  Select: ({ 'aria-label': ariaLabel, onChange, options, value }: any) => (
    <select
      aria-label={ariaLabel}
      value={value ?? ''}
      onChange={(event) => onChange?.(event.target.value || undefined)}
    >
      <option value="">all</option>
      {options.map((option: any) => (
        <option key={String(option.value)} value={String(option.value)}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  toast: { success: vi.fn() },
}));

vi.mock('../primitives/AdminPageTemplate', () => ({
  default: ({
    actions,
    children,
    toolbar,
  }: {
    actions?: ReactNode;
    children?: ReactNode;
    toolbar?: ReactNode;
  }) => (
    <main>
      {actions}
      {toolbar}
      {children}
    </main>
  ),
}));

vi.mock('../primitives/StatusBadge', () => ({ default: () => null }));

vi.mock('../primitives/DataTable', () => ({
  default: ({
    columns,
    cursorPagination,
    dataSource,
    emptyDescription,
    error,
    loading,
    onChange,
    onRetry,
    toolbar,
  }: any) => {
    if (loading) return <div role="status">loading</div>;
    if (error)
      return (
        <div role="alert">
          error<button onClick={onRetry}>retry</button>
        </div>
      );
    const filters = (columns ?? [])
      .filter((column: { filters?: unknown[] }) => column.filters)
      .map(
        (column: {
          filters: Array<{ text: string; value: string }>;
          filteredValue?: Array<string | number> | null;
          key: string;
          title: string;
        }) => (
          <select
            aria-label={column.title}
            key={column.key}
            value={column.filteredValue?.[0] ?? ''}
            onChange={(event) =>
              onChange?.({
                filters: { [column.key]: event.target.value ? [event.target.value] : null },
                pagination: false,
                sorter: {},
              })
            }
          >
            <option value="">all</option>
            {column.filters.map((option) => (
              <option key={option.value} value={option.value}>
                {option.text}
              </option>
            ))}
          </select>
        ),
      );
    if (!dataSource?.length)
      return (
        <div>
          {toolbar}
          {filters}
          {emptyDescription}
        </div>
      );
    const availability = (columns ?? []).find(
      (column: { key: string }) => column.key === 'enabled',
    );
    return (
      <div>
        {toolbar}
        {filters}
        {dataSource.map((item: any, index: number) => (
          <div data-testid={`row-${item.id}`} key={item.id}>
            {availability?.render?.(item.enabled, item, index)}
          </div>
        ))}
        <button disabled={!cursorPagination.hasNext} onClick={cursorPagination.onNext}>
          next
        </button>
        <button disabled={!cursorPagination.hasPrevious} onClick={cursorPagination.onPrevious}>
          previous
        </button>
      </div>
    );
  },
}));

const ExternalFilterLink = () => {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/admin/skills?status=draft')}>external-filter</button>;
};

describe('SkillListPage', () => {
  beforeEach(() => {
    mocks.data = {
      items: [
        {
          displayName: 'Skill One',
          enabled: true,
          id: 's1',
          skillKey: 'skill.one',
          status: 'published',
        },
      ],
      nextCursor: 'next-cursor',
    };
    mocks.create.mockReset();
    mocks.error = undefined;
    mocks.filterResultMode = null;
    mocks.inputs.length = 0;
    mocks.isLoading = false;
    mocks.mutate.mockReset();
    mocks.openCreate.mockReset();
    mocks.pageErrorOnCursor = false;
    mocks.permissions = [PLATFORM_PERMISSIONS.SKILL_READ];
    mocks.refreshLists.mockReset();
    mocks.refreshLists.mockResolvedValue(undefined);
    mocks.setEnabled.mockReset();
    mocks.setEnabled.mockResolvedValue({ enabled: false, skillKey: 'skill.one' });
  });

  it('invalidates an old cursor before an external URL filter navigation can fetch', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/skills']}>
        <ExternalFilterLink />
        <SkillListPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('next'));
    await waitFor(() => expect(mocks.inputs.at(-1)).toMatchObject({ cursor: 'next-cursor' }));

    const mark = mocks.inputs.length;
    fireEvent.click(screen.getByText('external-filter'));
    await waitFor(() => expect(mocks.inputs.at(-1)).toMatchObject({ status: 'draft' }));
    const externalCalls = mocks.inputs.slice(mark) as { cursor?: string; status?: string }[];
    expect(externalCalls.some((input) => input.status === 'draft')).toBe(true);
    expect(
      externalCalls
        .filter((input) => input.status === 'draft')
        .every((input) => input.cursor === undefined),
    ).toBe(true);
  });

  it.each(['loading', 'error'] as const)(
    'does not show previous rows while a new external filter is %s',
    async (mode) => {
      mocks.filterResultMode = mode;
      render(
        <MemoryRouter initialEntries={['/admin/skills']}>
          <ExternalFilterLink />
          <SkillListPage />
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByText('next'));
      await waitFor(() => expect(mocks.inputs.at(-1)).toMatchObject({ cursor: 'next-cursor' }));
      fireEvent.click(screen.getByText('external-filter'));

      if (mode === 'loading') {
        await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
      } else {
        await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
        expect(screen.queryByText('skillCatalog.list.error.page')).toBeNull();
      }
      expect(screen.queryByText('next')).toBeNull();
      expect(mocks.inputs.at(-1)).toMatchObject({ cursor: undefined, status: 'draft' });
    },
  );

  it('keeps prior rows and Previous available when a later cursor page fails', async () => {
    mocks.pageErrorOnCursor = true;
    render(
      <MemoryRouter>
        <SkillListPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('next'));

    await waitFor(() => expect(screen.getByText('skillCatalog.list.error.page')).toBeTruthy());
    expect(screen.getByText('previous')).not.toHaveProperty('disabled', true);
    expect(screen.getByText('next')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByText('skillCatalog.actions.retry'));
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it('ignores rapid double-clicks on Next so the cursor stack does not duplicate', async () => {
    mocks.isLoading = true;
    render(
      <MemoryRouter>
        <SkillListPage />
      </MemoryRouter>,
    );
    // Retained page data + in-flight load: Next is disabled.
    const next = screen.getByText('next');
    expect(next).toHaveProperty('disabled', true);
    fireEvent.click(next);
    fireEvent.click(next);
    expect(mocks.inputs.every((input) => !(input as { cursor?: string }).cursor)).toBe(true);

    // When not loading, rapid clicks still only advance once (idempotent stack append).
    mocks.isLoading = false;
    mocks.inputs.length = 0;
    render(
      <MemoryRouter>
        <SkillListPage />
      </MemoryRouter>,
    );
    const enabledNext = screen.getAllByText('next').at(-1)!;
    fireEvent.click(enabledNext);
    fireEvent.click(enabledNext);
    fireEvent.click(enabledNext);
    await waitFor(() => expect(mocks.inputs.at(-1)).toMatchObject({ cursor: 'next-cursor' }));
    const cursorAdvances = mocks.inputs.filter(
      (input) => (input as { cursor?: string }).cursor === 'next-cursor',
    );
    // SWR may re-render, but the active cursor value stays a single next-cursor (not stacked twice).
    expect(cursorAdvances.length).toBeGreaterThan(0);
    expect(
      mocks.inputs.some((input) => {
        // No deeper nested duplicate path — list only ever requests the first next cursor.
        return (
          (input as { cursor?: string }).cursor &&
          (input as { cursor?: string }).cursor !== 'next-cursor'
        );
      }),
    ).toBe(false);
  });

  it('sends every URL filter and cursor to the server hook', async () => {
    render(
      <MemoryRouter>
        <SkillListPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('skillCatalog.list.columns.status'), {
      target: { value: 'published' },
    });
    fireEvent.change(screen.getByLabelText('skillCatalog.list.columns.distribution'), {
      target: { value: 'mandatory' },
    });
    fireEvent.change(screen.getByLabelText('skillCatalog.list.columns.enabled'), {
      target: { value: 'true' },
    });

    await waitFor(() =>
      expect(mocks.inputs.at(-1)).toMatchObject({
        distribution: 'mandatory',
        enabled: true,
        status: 'published',
      }),
    );

    fireEvent.click(screen.getByText('next'));
    await waitFor(() => expect(mocks.inputs.at(-1)).toMatchObject({ cursor: 'next-cursor' }));

    // Changing status resets cursor stack (filter fingerprint change).
    fireEvent.change(screen.getByLabelText('skillCatalog.list.columns.status'), {
      target: { value: 'draft' },
    });
    await waitFor(() => expect((mocks.inputs.at(-1) as any).cursor).toBeUndefined());

    fireEvent.change(screen.getByLabelText('skillCatalog.list.filters.query'), {
      target: { value: ' documentation ' },
    });
    await waitFor(() =>
      expect(mocks.inputs.at(-1)).toMatchObject({ cursor: undefined, query: 'documentation' }),
    );
  });

  it('keeps first-load error distinct from empty and wires retry', () => {
    mocks.data = undefined;
    mocks.error = new Error('offline');
    const { unmount } = render(
      <MemoryRouter>
        <SkillListPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByText('retry'));
    expect(mocks.mutate).toHaveBeenCalledTimes(1);

    mocks.error = undefined;
    mocks.data = { items: [], nextCursor: null };
    unmount();
    render(
      <MemoryRouter>
        <SkillListPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('skillCatalog.list.empty.default')).toBeTruthy();
  });

  it('closes the create operation after commit and exposes independent refresh retry', async () => {
    mocks.permissions = [PLATFORM_PERMISSIONS.SKILL_READ, PLATFORM_PERMISSIONS.SKILL_CREATE];
    mocks.create.mockResolvedValue({ draft: { id: 'created-1' }, draftToken: 'x'.repeat(64) });
    mocks.refreshLists.mockRejectedValueOnce(new Error('refresh offline'));
    render(
      <MemoryRouter initialEntries={['/admin/skills']}>
        <SkillListPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('skillCatalog.create.submit'));
    const modal = mocks.openCreate.mock.calls[0][0];
    await act(() => modal.onSubmit({}));

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(screen.getByText('skillCatalog.create.refreshFailed')).toBeTruthy();
    expect(screen.getByText('skillCatalog.create.submit')).toHaveProperty('disabled', true);

    mocks.refreshLists.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByText('skillCatalog.actions.retry'));
    await waitFor(() => expect(mocks.refreshLists).toHaveBeenCalledTimes(2));
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  describe('availability column', () => {
    const renderList = () =>
      render(
        <MemoryRouter>
          <SkillListPage />
        </MemoryRouter>,
      );

    it('writes setEnabled inline and refreshes the page plus the shared catalog', async () => {
      mocks.permissions = [
        PLATFORM_PERMISSIONS.SKILL_READ,
        PLATFORM_PERMISSIONS.SKILL_UPDATE,
        PLATFORM_PERMISSIONS.SKILL_PUBLISH,
      ];
      renderList();

      const availability = screen.getByRole('switch');
      expect(availability.getAttribute('aria-checked')).toBe('true');

      fireEvent.click(availability);

      await waitFor(() =>
        expect(mocks.setEnabled).toHaveBeenCalledWith({ enabled: false, skillKey: 'skill.one' }),
      );
      await waitFor(() => expect(mocks.mutate).toHaveBeenCalled());
      expect(mocks.refreshLists).toHaveBeenCalled();
    });

    it('renders read-only without both the update and publish permissions', () => {
      mocks.permissions = [PLATFORM_PERMISSIONS.SKILL_READ, PLATFORM_PERMISSIONS.SKILL_UPDATE];
      renderList();

      expect(screen.getByRole('switch')).toHaveProperty('disabled', true);
      fireEvent.click(screen.getByRole('switch'));
      expect(mocks.setEnabled).not.toHaveBeenCalled();
    });

    it('names the switch after the skill and its current state', () => {
      mocks.permissions = [
        PLATFORM_PERMISSIONS.SKILL_READ,
        PLATFORM_PERMISSIONS.SKILL_UPDATE,
        PLATFORM_PERMISSIONS.SKILL_PUBLISH,
      ];
      renderList();

      expect(
        screen.getByRole('switch', { name: 'Skill One: skillCatalog.boolean.true' }),
      ).toBeTruthy();
    });

    it('locks a builtin override row for create-only holders (rows need update)', () => {
      mocks.permissions = [
        PLATFORM_PERMISSIONS.SKILL_READ,
        PLATFORM_PERMISSIONS.SKILL_CREATE,
        PLATFORM_PERMISSIONS.SKILL_PUBLISH,
      ];
      mocks.data = {
        items: [
          {
            displayName: 'Artifacts',
            enabled: true,
            id: 's1',
            skillKey: 'lobe-artifacts',
            source: 'builtin',
            status: 'published',
          },
        ],
        nextCursor: null,
      };
      renderList();

      expect(screen.getByRole('switch')).toHaveProperty('disabled', true);
      fireEvent.click(screen.getByRole('switch'));
      expect(mocks.setEnabled).not.toHaveBeenCalled();
    });

    it('shows archived rows as off and locked even when the row says enabled', () => {
      mocks.permissions = [
        PLATFORM_PERMISSIONS.SKILL_READ,
        PLATFORM_PERMISSIONS.SKILL_UPDATE,
        PLATFORM_PERMISSIONS.SKILL_PUBLISH,
      ];
      mocks.data = {
        items: [{ enabled: true, id: 's1', skillKey: 'skill.one', status: 'archived' }],
        nextCursor: null,
      };
      renderList();

      const availability = screen.getByRole('switch');
      expect(availability.getAttribute('aria-checked')).toBe('false');
      expect(availability).toHaveProperty('disabled', true);
    });
  });
});
