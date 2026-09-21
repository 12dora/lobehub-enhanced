// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiCallStatsSection,
  IM_CONNECTOR_API_STATS_TOP,
  type ImConnectorApiCallStats,
  type ImConnectorApiStatsService,
} from './ApiCallStatsSection';

const mocks = vi.hoisted(() => ({
  data: undefined as unknown,
  error: undefined as unknown,
  loading: false,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${Object.values(options).join(',')}` : key,
  }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: () => '' }),
  cssVar: new Proxy({}, { get: () => '' }),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Text: ({ children, type }: { children?: ReactNode; type?: string }) => (
    <span data-type={type}>{children}</span>
  ),
}));

// The module reaches the TRPC client; the section always runs against an injected service here.
vi.mock('@/enterprise/client/services/adminImConnectors', () => ({
  adminImConnectorsService: {},
}));

/** Resolve SWR from the fixtures, but still run the fetcher so the injected service is exercised. */
vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (key: unknown, fetcher: () => Promise<unknown>) => {
    if (key) void fetcher();
    return {
      data: mocks.data,
      error: mocks.error,
      isLoading: mocks.loading,
      mutate: vi.fn(),
    };
  },
}));

const stats = (overrides: Partial<ImConnectorApiCallStats> = {}): ImConnectorApiCallStats => ({
  days: [
    {
      byApi: [
        { api: 'topapi/processinstance/get', count: 60 },
        { api: 'v1.0/todo/users/tasks', count: 30 },
      ],
      date: '2026-09-20',
      total: 90,
    },
    {
      byApi: [{ api: 'topapi/processinstance/get', count: 40 }],
      date: '2026-09-21',
      total: 120,
    },
  ],
  total: 210,
  ...overrides,
});

const service = (result: ImConnectorApiCallStats = stats()) =>
  ({ apiCallStats: vi.fn().mockResolvedValue(result) }) as ImConnectorApiStatsService & {
    apiCallStats: ReturnType<typeof vi.fn>;
  };

beforeEach(() => {
  mocks.data = undefined;
  mocks.error = undefined;
  mocks.loading = false;
});

afterEach(() => cleanup());

describe('ApiCallStatsSection', () => {
  it('asks for the 30-day window', () => {
    const stub = service();
    render(<ApiCallStatsSection service={stub} />);

    expect(stub.apiCallStats).toHaveBeenCalledWith({ days: 30 });
  });

  it('shows a loading line before the first answer', () => {
    mocks.loading = true;
    render(<ApiCallStatsSection service={service()} />);

    expect(screen.getByText('systemGeneral.imConnectors.apiStats.loading')).toBeTruthy();
  });

  it('never reads a failed load as zero calls', () => {
    mocks.error = new Error('boom');
    render(<ApiCallStatsSection service={service()} />);

    const message = screen.getByText('systemGeneral.imConnectors.apiStats.loadFailed');
    expect(message.getAttribute('data-type')).toBe('danger');
    expect(screen.queryByText(/apiStats\.total/)).toBeNull();
  });

  it('says 暂无数据 when nothing was called in the window', () => {
    mocks.data = stats({ days: [], total: 0 });
    render(<ApiCallStatsSection service={service()} />);

    expect(screen.getByText('systemGeneral.imConnectors.apiStats.empty')).toBeTruthy();
  });

  it('reports the window total beside today’s, taking today from the latest date', () => {
    mocks.data = stats();
    render(<ApiCallStatsSection service={service()} />);

    // The fixture lists the days out of order on purpose: 2026-09-21 is still today.
    expect(
      screen.getByText(
        'systemGeneral.imConnectors.apiStats.total:30,210 · systemGeneral.imConnectors.apiStats.today:120',
      ),
    ).toBeTruthy();
  });

  it('lists today’s busiest APIs with their counts', () => {
    mocks.data = stats();
    render(<ApiCallStatsSection service={service()} />);

    expect(screen.getByText('systemGeneral.imConnectors.apiStats.column.api')).toBeTruthy();
    expect(screen.getByText('topapi/processinstance/get')).toBeTruthy();
    expect(screen.getByText('40')).toBeTruthy();
    // Yesterday's APIs are not today's.
    expect(screen.queryByText('v1.0/todo/users/tasks')).toBeNull();
  });

  it('keeps the API table to the top 8', () => {
    mocks.data = stats({
      days: [
        {
          byApi: Array.from({ length: 12 }, (_, index) => ({
            api: `api/${index}`,
            count: 12 - index,
          })),
          date: '2026-09-21',
          total: 78,
        },
      ],
      total: 78,
    });
    render(<ApiCallStatsSection service={service()} />);

    expect(screen.getByText(`api/${IM_CONNECTOR_API_STATS_TOP - 1}`)).toBeTruthy();
    expect(screen.queryByText(`api/${IM_CONNECTOR_API_STATS_TOP}`)).toBeNull();
  });

  it('says so when the window has calls but today has none', () => {
    mocks.data = stats({
      days: [{ byApi: [], date: '2026-09-21', total: 0 }],
      total: 210,
    });
    render(<ApiCallStatsSection service={service()} />);

    expect(screen.getByText('systemGeneral.imConnectors.apiStats.emptyToday')).toBeTruthy();
  });

  it('offers the per-day breakdown newest first, behind a disclosure', () => {
    mocks.data = stats();
    const { container } = render(<ApiCallStatsSection service={service()} />);

    const details = container.querySelector('details');
    expect(details).toBeTruthy();
    expect(details!.open).toBe(false);
    expect(screen.getByText('systemGeneral.imConnectors.apiStats.expand:30')).toBeTruthy();

    const dates = [...details!.querySelectorAll('tbody td')]
      .map((cell) => cell.textContent)
      .filter((text) => text?.startsWith('2026-'));
    expect(dates).toEqual(['2026-09-21', '2026-09-20']);
  });
});
