// @vitest-environment happy-dom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ReauthModule from '@/enterprise/client/features/admin/reauth/requestAdminReauth';
import type {
  AdminStatusAlertsService,
  AdminStatusApiRotateResult,
  AdminStatusApiService,
  AdminStatusApiView,
} from '@/enterprise/client/services/adminSystem';

import { AlertSettingsDrawer } from './AlertSettingsDrawer';

/* ─── i18n / styles ───────────────────────────────────────────────────────── */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: () => '' }),
  cssVar: new Proxy({}, { get: () => '' }),
}));

/* ─── data seams ──────────────────────────────────────────────────────────── */

/** A tiny SWR: fetch once per non-null key, `mutate(data)` writes, `mutate()` refetches. */
const swrGlobal = vi.hoisted(() => ({
  mutate: vi.fn(async (_matcher: unknown) => [] as unknown[]),
}));

vi.mock('@/libs/swr', async () => {
  const React = await import('react');
  return {
    mutate: swrGlobal.mutate,
    useClientDataSWR: (key: unknown[] | null, fetcher: () => Promise<unknown>) => {
      const [state, setState] = React.useState<{ data?: unknown; error?: unknown }>({});
      const fetcherRef = React.useRef(fetcher);
      fetcherRef.current = fetcher;
      const keyString = key ? JSON.stringify(key) : null;
      const load = React.useCallback(async () => {
        try {
          const data = await fetcherRef.current();
          setState({ data });
          return data;
        } catch (error) {
          setState((current) => ({ ...current, error }));
          return undefined;
        }
      }, []);
      React.useEffect(() => {
        if (keyString) void load();
      }, [keyString, load]);
      const mutate = React.useCallback(
        async (data?: unknown, options?: { revalidate?: boolean }) => {
          if (data !== undefined) {
            setState({ data });
            if (options?.revalidate === false) return data;
          }
          return load();
        },
        [load],
      );
      return { data: keyString ? state.data : undefined, error: state.error, mutate };
    },
  };
});

vi.mock('@/enterprise/client/providers/AdminAccessProvider', () => ({
  useAdminAccess: () => ({ authMethod: 'better-auth' }),
}));

/**
 * The real retry-once logic, with only the interactive popup replaced: `reauth.outcome` decides
 * whether the operator completes or cancels the sign-in.
 */
const reauth = vi.hoisted(() => ({ calls: 0, outcome: 'success' as 'cancel' | 'success' }));
vi.mock('@/enterprise/client/features/admin/reauth/requestAdminReauth', async (importOriginal) => {
  const actual = await importOriginal<typeof ReauthModule>();
  return {
    ...actual,
    withAdminReauthRetry: <T,>(
      fn: () => Promise<T>,
      options?: Parameters<typeof actual.withAdminReauthRetry>[1],
    ) =>
      actual.withAdminReauthRetry(fn, {
        ...options,
        requestReauth: async () => {
          reauth.calls += 1;
          if (reauth.outcome === 'cancel') throw new actual.AdminReauthCancelledError();
        },
      }),
  };
});

interface ConfirmOptions {
  content: ReactNode;
  onConfirm: () => Promise<void> | void;
  title: string;
}

const confirm = vi.hoisted(() => ({ last: undefined as ConfirmOptions | undefined }));
vi.mock('@/enterprise/client/features/admin/primitives/DangerConfirm', () => ({
  openDangerConfirm: (options: ConfirmOptions) => {
    confirm.last = options;
  },
}));

vi.mock('@/enterprise/client/features/admin/pages/AdminStateSurfaces', () => ({
  AdminLoadingSurface: () => <div data-testid="loading" />,
}));

// The 告警 tab is covered by AlertSettingsDrawer.test.tsx; only its reset seam matters here.
vi.mock('./AlertsTab', () => ({ AlertsTab: () => <div data-testid="alerts-tab" /> }));
vi.mock('./useAlertSettingsEditor', () => ({
  useAlertSettingsEditor: () => ({
    dirty: false,
    draft: null,
    errors: {},
    loadError: undefined,
    reset: () => undefined,
    saving: false,
    view: undefined,
  }),
}));

/* ─── UI kit ──────────────────────────────────────────────────────────────── */

vi.mock('@lobehub/ui', () => ({
  CopyButton: ({ content }: { content: string }) => (
    <button data-content={content} type="button">
      copy
    </button>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
  Tooltip: ({ children, title }: { children?: ReactNode; title?: ReactNode }) => (
    <>
      {children}
      <span data-testid="tooltip">{title}</span>
    </>
  ),
}));

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock('@lobehub/ui/base-ui', () => ({
  Alert: ({ action, title }: { action?: ReactNode; title?: ReactNode }) => (
    <div role="alert">
      {title}
      {action}
    </div>
  ),
  Button: ({
    children,
    danger: _danger,
    icon: _icon,
    loading,
    size: _size,
    type: _type,
    ...rest
  }: Record<string, any>) => (
    <button data-loading={loading ? 'true' : undefined} type="button" {...rest}>
      {children}
    </button>
  ),
  Drawer: ({
    children,
    footer,
    onClose,
    open,
    title,
  }: {
    children?: ReactNode;
    footer?: ReactNode;
    onClose?: () => void;
    open?: boolean;
    title?: ReactNode;
  }) =>
    open ? (
      <div role="dialog">
        <h1>{title}</h1>
        {children}
        <div data-testid="drawer-footer">{footer}</div>
        <button type="button" onClick={onClose}>
          close-drawer
        </button>
      </div>
    ) : null,
  Input: ({ onChange, value, ...rest }: Record<string, any>) => (
    <input {...rest} value={value ?? ''} onChange={onChange} />
  ),
  Tabs: ({
    activeKey,
    items,
    onChange,
  }: {
    activeKey?: string;
    items: { key: string; label: ReactNode }[];
    onChange?: (key: string) => void;
  }) => (
    <div role="tablist">
      {items.map((item) => (
        <button
          aria-selected={item.key === activeKey}
          key={item.key}
          role="tab"
          type="button"
          onClick={() => onChange?.(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({
    'as': As = 'span',
    children,
    'data-testid': testId,
  }: {
    'as'?: 'h3' | 'span';
    'children'?: ReactNode;
    'data-testid'?: string;
  }) => <As data-testid={testId}>{children}</As>,
  toast,
}));

/* ─── fixtures ────────────────────────────────────────────────────────────── */

const buildStatusApi = (overrides: Partial<AdminStatusApiView> = {}): AdminStatusApiView =>
  ({
    createdAt: null,
    endpoints: {
      events: 'https://hub.example.com/api/status/v1/events',
      health: 'https://hub.example.com/api/status/v1/health',
      summary: 'https://hub.example.com/api/status/v1/summary',
    },
    envTokenConfigured: false,
    tokenHint: null,
    tokenSet: false,
    ...overrides,
  }) as AdminStatusApiView;

const TOKEN = `sk-status-${'A1b2C3d4'.repeat(4)}`;

const ISSUED: AdminStatusApiRotateResult = {
  token: TOKEN,
  view: buildStatusApi({
    createdAt: '2026-09-25T08:00:00.000Z',
    tokenHint: 'sk-status-…C3d4',
    tokenSet: true,
  }),
};

const REAUTH_REQUIRED = { data: { errorData: { code: 'ADMIN_REAUTH_REQUIRED' } } };

const createService = (statusApi: AdminStatusApiView = buildStatusApi()) =>
  ({
    getAlertSettings: vi.fn(),
    getStatusApi: vi.fn().mockResolvedValue(statusApi),
    revokeStatusApiToken: vi.fn().mockResolvedValue(buildStatusApi()),
    rotateStatusApiToken: vi.fn().mockResolvedValue(ISSUED),
    testAlertChannel: vi.fn(),
    updateAlertSettings: vi.fn(),
  }) satisfies AdminStatusAlertsService & AdminStatusApiService;

const renderDrawer = (
  service = createService(),
  props: Partial<{ canOperate: boolean; onClose: () => void }> = {},
) => {
  const onClose = props.onClose ?? vi.fn();
  const element = (open: boolean) => (
    <AlertSettingsDrawer
      canRead
      canOperate={props.canOperate ?? true}
      open={open}
      service={service}
      onClose={onClose}
    />
  );
  const utils = render(element(true));
  return {
    ...utils,
    onClose,
    service,
    setOpen: (open: boolean) => utils.rerender(element(open)),
  };
};

const openStatusApiTab = async () => {
  fireEvent.click(screen.getByRole('tab', { name: 'system.alerts.tabs.statusApi' }));
  return screen.findAllByTestId('status-api-endpoint');
};

const tokenState = () => screen.getByTestId('status-api-token-state').textContent;

/* ─── tests ───────────────────────────────────────────────────────────────── */

describe('AlertSettingsDrawer → 状态 API', () => {
  beforeEach(() => {
    confirm.last = undefined;
    swrGlobal.mutate.mockClear();
    reauth.calls = 0;
    reauth.outcome = 'success';
    toast.error.mockReset();
    toast.success.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('lists the three endpoints with copy buttons and the token state', async () => {
    renderDrawer(createService(buildStatusApi({ envTokenConfigured: true })));

    const rows = await openStatusApiTab();
    expect(rows).toHaveLength(3);
    for (const [index, url] of [
      'https://hub.example.com/api/status/v1/summary',
      'https://hub.example.com/api/status/v1/events',
      'https://hub.example.com/api/status/v1/health',
    ].entries()) {
      expect(rows[index].textContent).toContain(url);
      expect(within(rows[index]).getByRole('button', { name: 'copy' }).dataset.content).toBe(url);
    }
    expect(tokenState()).toBe('system.statusApi.token.notSet');
    expect(screen.getByText('system.statusApi.token.envConfigured')).toBeTruthy();
  });

  it('shows a generated token exactly once', async () => {
    const { onClose, service, setOpen } = renderDrawer();
    await openStatusApiTab();

    // First token: nothing to invalidate, so no confirmation.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'system.statusApi.token.generate' }));
    });
    expect(confirm.last).toBeUndefined();
    expect(service.rotateStatusApiToken).toHaveBeenCalledTimes(1);

    const revealed = screen.getByTestId('status-api-revealed-token');
    expect((within(revealed).getByRole('textbox') as HTMLInputElement).value).toBe(TOKEN);
    expect(within(revealed).getByRole('textbox').hasAttribute('readonly')).toBe(true);
    expect(within(revealed).getByText('system.statusApi.token.once')).toBeTruthy();
    expect(within(revealed).getByRole('button', { name: 'copy' }).dataset.content).toBe(TOKEN);
    expect(tokenState()).toContain('sk-status-…C3d4');

    // Switching tabs keeps it; closing the drawer drops it for good.
    fireEvent.click(screen.getByRole('tab', { name: 'system.alerts.tabs.alerts' }));
    fireEvent.click(screen.getByRole('tab', { name: 'system.alerts.tabs.statusApi' }));
    expect(screen.getByTestId('status-api-revealed-token')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'close-drawer' }));
    expect(onClose).toHaveBeenCalled();
    setOpen(false);
    setOpen(true);
    await openStatusApiTab();
    expect(screen.queryByTestId('status-api-revealed-token')).toBeNull();
  });

  it('never re-shows a token whose request finished after the drawer closed', async () => {
    const service = createService();
    let finishRotate: (value: AdminStatusApiRotateResult) => void = () => undefined;
    service.rotateStatusApiToken.mockReturnValueOnce(
      new Promise<AdminStatusApiRotateResult>((resolve) => {
        finishRotate = resolve;
      }),
    );
    const { setOpen } = renderDrawer(service);
    await openStatusApiTab();

    fireEvent.click(screen.getByRole('button', { name: 'system.statusApi.token.generate' }));
    fireEvent.click(screen.getByRole('button', { name: 'close-drawer' }));
    setOpen(false);
    await act(async () => {
      finishRotate(ISSUED);
    });

    setOpen(true);
    await openStatusApiTab();
    expect(screen.queryByTestId('status-api-revealed-token')).toBeNull();
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it('regenerates and revokes behind a confirmation', async () => {
    const service = createService(
      buildStatusApi({
        createdAt: '2026-09-20T00:00:00.000Z',
        tokenHint: 'sk-status-…zz99',
        tokenSet: true,
      }),
    );
    renderDrawer(service);
    await openStatusApiTab();
    expect(screen.queryByRole('button', { name: 'system.statusApi.token.generate' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'system.statusApi.token.rotate' }));
    expect(confirm.last?.title).toBe('system.statusApi.modal.rotate.title');
    expect(service.rotateStatusApiToken).not.toHaveBeenCalled();
    await act(async () => {
      await confirm.last?.onConfirm();
    });
    expect(service.rotateStatusApiToken).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('status-api-revealed-token')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('system.statusApi.toast.rotated');

    fireEvent.click(screen.getByRole('button', { name: 'system.statusApi.token.revoke' }));
    expect(confirm.last?.title).toBe('system.statusApi.modal.revoke.title');
    await act(async () => {
      await confirm.last?.onConfirm();
    });
    expect(service.revokeStatusApiToken).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('system.statusApi.toast.revoked');
    expect(screen.queryByTestId('status-api-revealed-token')).toBeNull();
    expect(tokenState()).toBe('system.statusApi.token.notSet');
  });

  it('re-reads 告警设置 after a token write so an open form gets the new revision', async () => {
    const service = createService(buildStatusApi({ tokenHint: 'sk-status-…zz99', tokenSet: true }));
    renderDrawer(service);
    await openStatusApiTab();

    const alertsMatcher = () => {
      const matcher = swrGlobal.mutate.mock.calls.at(-1)?.[0] as (key: unknown) => boolean;
      expect(matcher(['admin.system.alerts.get'])).toBe(true);
      expect(matcher(['admin.system.statusApi.get'])).toBe(false);
    };

    fireEvent.click(screen.getByRole('button', { name: 'system.statusApi.token.rotate' }));
    await act(async () => {
      await confirm.last?.onConfirm();
    });
    expect(swrGlobal.mutate).toHaveBeenCalledTimes(1);
    alertsMatcher();

    fireEvent.click(screen.getByRole('button', { name: 'system.statusApi.token.revoke' }));
    await act(async () => {
      await confirm.last?.onConfirm();
    });
    expect(swrGlobal.mutate).toHaveBeenCalledTimes(2);
    alertsMatcher();
  });

  it('re-authenticates and retries once when the server asks for it', async () => {
    const service = createService();
    service.rotateStatusApiToken.mockRejectedValueOnce(REAUTH_REQUIRED);
    renderDrawer(service);
    await openStatusApiTab();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'system.statusApi.token.generate' }));
    });

    expect(reauth.calls).toBe(1);
    expect(service.rotateStatusApiToken).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('status-api-revealed-token')).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('says so, without revealing anything, when re-authentication is cancelled', async () => {
    const service = createService();
    service.rotateStatusApiToken.mockRejectedValueOnce(REAUTH_REQUIRED);
    reauth.outcome = 'cancel';
    renderDrawer(service);
    await openStatusApiTab();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'system.statusApi.token.generate' }));
    });

    expect(reauth.calls).toBe(1);
    expect(service.rotateStatusApiToken).toHaveBeenCalledTimes(1);
    // A neutral message: there is no form whose content was "kept".
    expect(toast.error).toHaveBeenCalledWith('system.actions.reauthCancelled');
    expect(screen.queryByTestId('status-api-revealed-token')).toBeNull();
  });

  it('reports any other failure without revealing anything', async () => {
    const service = createService();
    service.rotateStatusApiToken.mockRejectedValueOnce(new Error('boom'));
    renderDrawer(service);
    await openStatusApiTab();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'system.statusApi.token.generate' }));
    });

    expect(reauth.calls).toBe(0);
    expect(toast.error).toHaveBeenCalledWith('system.statusApi.toast.failed');
    expect(screen.queryByTestId('status-api-revealed-token')).toBeNull();
  });

  it('hides token actions from read-only users', async () => {
    renderDrawer(createService(buildStatusApi({ tokenHint: 'sk-status-…zz99', tokenSet: true })), {
      canOperate: false,
    });
    await openStatusApiTab();

    expect(screen.queryByRole('button', { name: 'system.statusApi.token.rotate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'system.statusApi.token.revoke' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'system.statusApi.token.generate' })).toBeNull();
  });
});
