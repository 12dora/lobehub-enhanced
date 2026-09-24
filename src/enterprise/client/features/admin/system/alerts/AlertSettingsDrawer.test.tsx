// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AdminStatusAlertsService,
  AdminStatusAlertsView,
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

/**
 * A tiny SWR: fetch once per non-null key, `mutate(data)` writes, `mutate()` refetches. The global
 * `mutate(matcher)` revalidates every mounted key the matcher accepts, like the scoped one.
 */
const swr = vi.hoisted(() => ({
  mounted: new Map<string, { key: unknown[]; load: () => Promise<unknown> }>(),
}));

vi.mock('@/libs/swr', async () => {
  const React = await import('react');
  return {
    mutate: async (matcher: (key: unknown) => boolean) => {
      const hits = [...swr.mounted.values()].filter((entry) => matcher(entry.key));
      return Promise.all(hits.map((entry) => entry.load()));
    },
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
        if (!keyString) return;
        swr.mounted.set(keyString, { key: JSON.parse(keyString), load });
        void load();
        return () => {
          swr.mounted.delete(keyString);
        };
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
  useAdminAccess: () => ({ authMethod: null }),
}));

const modules = vi.hoisted(() => ({ state: {} as Record<string, boolean> }));
vi.mock('@/enterprise/client/hooks/useModuleEnabled', () => ({
  useModuleEnabled: (id: string) => modules.state[id] ?? true,
}));

vi.mock('@/enterprise/client/features/admin/reauth/requestAdminReauth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  withAdminReauthRetry: (operation: () => Promise<unknown>) => operation(),
}));

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

vi.mock('@/enterprise/client/features/admin/primitives/UserSearchSelect', () => ({
  default: ({ onChange }: { onChange: (id?: string, ref?: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onChange('u9', { avatar: null, email: null, fullName: '王五', id: 'u9', username: null })
      }
    >
      pick-user
    </button>
  ),
}));

vi.mock('react-router', () => ({
  Link: ({ children, to }: { children?: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

/* ─── UI kit ──────────────────────────────────────────────────────────────── */

vi.mock('@lobehub/ui', () => ({
  Block: ({
    children,
    ...rest
  }: {
    'children'?: ReactNode;
    'data-invalid'?: string;
    'data-testid'?: string;
  }) => (
    <div data-invalid={rest['data-invalid']} data-testid={rest['data-testid']}>
      {children}
    </div>
  ),
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
  CheckboxGroup: ({
    'aria-label': ariaLabel,
    disabled,
    onChange,
    options,
    value,
  }: {
    'aria-label'?: string;
    'disabled'?: boolean;
    'onChange'?: (next: string[]) => void;
    'options': { label: ReactNode; value: string }[];
    'value': string[];
  }) => (
    <div aria-label={ariaLabel} role="group">
      {options.map((option) => (
        <label key={option.value}>
          <input
            checked={value.includes(option.value)}
            disabled={disabled}
            type="checkbox"
            onChange={(event) =>
              onChange?.(
                event.target.checked
                  ? [...value, option.value]
                  : value.filter((entry) => entry !== option.value),
              )
            }
          />
          {option.label}
        </label>
      ))}
    </div>
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
  InputNumber: ({
    disabled,
    id,
    onChange,
    placeholder,
    value,
  }: {
    disabled?: boolean;
    id?: string;
    onChange?: (next: number | null) => void;
    placeholder?: string;
    value?: number | null;
  }) => (
    <input
      disabled={disabled}
      id={id}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(event) =>
        onChange?.(event.target.value === '' ? null : Number(event.target.value))
      }
    />
  ),
  InputPassword: ({ onChange, value, ...rest }: Record<string, any>) => (
    <input type="password" {...rest} value={value ?? ''} onChange={onChange} />
  ),
  Segmented: ({
    disabled,
    onChange,
    options,
  }: {
    disabled?: boolean;
    onChange?: (next: string) => void;
    options: { label: string; value: string }[];
  }) => (
    <div>
      {options.map((option) => (
        <button
          disabled={disabled}
          key={option.value}
          type="button"
          onClick={() => onChange?.(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
  Select: ({
    disabled,
    id,
    onChange,
    value,
  }: {
    disabled?: boolean;
    id?: string;
    onChange?: (next: string[]) => void;
    value?: string[];
  }) => (
    <input
      disabled={disabled}
      id={id}
      value={(value ?? []).join(',')}
      onChange={(event) => onChange?.(event.target.value.split(','))}
    />
  ),
  Switch: ({
    checked,
    disabled,
    id,
    onChange,
  }: {
    checked?: boolean;
    disabled?: boolean;
    id?: string;
    onChange?: (next: boolean) => void;
  }) => (
    <button
      aria-checked={checked}
      disabled={disabled}
      id={id}
      role="switch"
      type="button"
      onClick={() => onChange?.(!checked)}
    />
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
  Tag: ({
    children,
    closable,
    icon,
    onClose,
  }: {
    children?: ReactNode;
    closable?: boolean;
    icon?: ReactNode;
    onClose?: () => void;
  }) => (
    <span>
      {icon}
      {children}
      {closable ? (
        <button type="button" onClick={onClose}>
          remove
        </button>
      ) : null}
    </span>
  ),
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

const WEBHOOK = 'https://oapi.dingtalk.com/robot/send?access_token=abc123';
const WEBHOOK_HINT = 'https://oapi.dingtalk.com/robot/send?access_token=…c123';

/** The server's view: the webhook is write-only (`webhookUrl` always null + a masked hint). */
const buildView = (overrides: Partial<AdminStatusAlertsView> = {}): AdminStatusAlertsView =>
  ({
    dingtalkRobotSecretSet: false,
    dingtalkRobotWebhook: { hint: null, set: false },
    effectiveDingtalkApiDailyThreshold: 5000,
    envDisabled: false,
    mailConfigured: true,
    notifyAppConfigured: true,
    recipientUsers: [],
    revision: 4,
    settings: {
      channels: {
        dingtalkRobot: { enabled: false, keyword: null, webhookUrl: null },
        email: { enabled: false, recipients: [] },
        workNotice: {
          enabled: true,
          recipientMode: 'roles',
          roles: ['super_admin', 'user_admin', 'ai_admin', 'identity_admin', 'auditor'],
          userIds: [],
        },
      },
      dingtalkApiDailyThreshold: null,
      enabled: true,
      notifyOnRecovery: true,
      repeatIntervalHours: 6,
      rules: {
        capabilities: true,
        dependencies: true,
        dingtalkApiBudget: true,
        runtimeErrors: true,
        workers: true,
      },
    },
    updatedAt: null,
    ...overrides,
  }) as AdminStatusAlertsView;

const buildStatusApi = (): AdminStatusApiView =>
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
  }) as AdminStatusApiView;

/** Applies a credential action the way the server does, for the returned view. */
const storedAfter = (stored: boolean, action?: { action: string }) =>
  action?.action === 'replace' ? true : action?.action === 'clear' ? false : stored;

const createService = (view: AdminStatusAlertsView = buildView()) =>
  ({
    getAlertSettings: vi.fn().mockResolvedValue(view),
    getStatusApi: vi.fn().mockResolvedValue(buildStatusApi()),
    revokeStatusApiToken: vi.fn(),
    rotateStatusApiToken: vi.fn(),
    testAlertChannel: vi.fn().mockResolvedValue({ delivered: 3, error: null, ok: true }),
    updateAlertSettings: vi.fn().mockImplementation(async (input: any) => {
      const webhookSet = storedAfter(view.dingtalkRobotWebhook.set, input.robotWebhook);
      return {
        ...view,
        dingtalkRobotSecretSet: storedAfter(view.dingtalkRobotSecretSet, input.robotSecret),
        dingtalkRobotWebhook: { hint: webhookSet ? WEBHOOK_HINT : null, set: webhookSet },
        revision: view.revision + 1,
        settings: input.settings,
      };
    }),
  }) satisfies AdminStatusAlertsService & AdminStatusApiService;

const renderDrawer = (
  service = createService(),
  props: Partial<{ canOperate: boolean; onClose: () => void }> = {},
) => {
  const onClose = props.onClose ?? vi.fn();
  const utils = render(
    <AlertSettingsDrawer
      canRead
      open
      canOperate={props.canOperate ?? true}
      service={service}
      onClose={onClose}
    />,
  );
  return { ...utils, onClose, service };
};

const channel = (name: 'dingtalkRobot' | 'email' | 'workNotice') =>
  screen.getByTestId(`alert-channel-${name}`);

const saveButton = () => screen.getByRole('button', { name: 'system.alerts.save' });

const loaded = () => screen.findByRole('switch', { name: 'system.alerts.enabled' });

const testButton = (name: 'dingtalkRobot' | 'email' | 'workNotice') =>
  within(channel(name)).getByRole('button', {
    name: 'system.alerts.test.action',
  }) as HTMLButtonElement;

/* ─── tests ───────────────────────────────────────────────────────────────── */

describe('AlertSettingsDrawer → 告警', () => {
  beforeEach(() => {
    confirm.last = undefined;
    modules.state = {};
    toast.error.mockReset();
    toast.success.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('renders both tabs and the stored settings', async () => {
    renderDrawer();

    expect(screen.getByRole('heading', { name: 'system.actions.alertSettings' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'system.alerts.tabs.alerts' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'system.alerts.tabs.statusApi' })).toBeTruthy();

    const master = await loaded();
    expect(master.getAttribute('aria-checked')).toBe('true');
    expect(within(channel('workNotice')).getByRole('switch').getAttribute('aria-checked')).toBe(
      'true',
    );
    // All five platform admin roles, labelled with the existing role names.
    for (const role of ['super_admin', 'user_admin', 'ai_admin', 'identity_admin', 'auditor']) {
      expect(
        (within(channel('workNotice')).getByLabelText(`users.roles.${role}`) as HTMLInputElement)
          .checked,
      ).toBe(true);
    }
    // Threshold placeholder shows the effective default.
    expect(
      (screen.getByLabelText('system.alerts.rules.threshold') as HTMLInputElement).placeholder,
    ).toBe('system.alerts.rules.thresholdPlaceholder:{"value":5000}');
    // Nothing changed yet → nothing to save.
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('blocks the save and outlines the robot channel when its webhook is missing', async () => {
    const { service } = renderDrawer();
    await loaded();

    fireEvent.click(within(channel('dingtalkRobot')).getByRole('switch'));
    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(service.updateAlertSettings).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('system.alerts.errors.invalid');
    expect(
      within(channel('dingtalkRobot')).getByText('system.alerts.errors.webhookRequired'),
    ).toBeTruthy();
    expect(channel('dingtalkRobot').dataset.invalid).toBe('true');
    expect(channel('email').dataset.invalid).toBeUndefined();
  });

  it('does not let a switched-off channel block the save', async () => {
    const { service } = renderDrawer();
    await loaded();

    // Type a bad address, then switch email back off: its field is hidden again.
    fireEvent.click(within(channel('email')).getByRole('switch'));
    fireEvent.change(screen.getByLabelText('system.alerts.email.recipients'), {
      target: { value: 'ops@example.com,ops@corp' },
    });
    fireEvent.click(within(channel('email')).getByRole('switch'));
    fireEvent.click(screen.getByLabelText('system.alerts.rules.workers'));

    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(service.updateAlertSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          channels: expect.objectContaining({
            email: { enabled: false, recipients: ['ops@example.com'] },
          }),
        }),
      }),
    );
  });

  it('saves the edited document against the revision it was loaded from', async () => {
    const { service } = renderDrawer();
    await loaded();

    fireEvent.click(within(channel('dingtalkRobot')).getByRole('switch'));
    const webhook = screen.getByLabelText('system.alerts.robot.webhookUrl') as HTMLInputElement;
    // The webhook carries an access token: masked like a secret.
    expect(webhook.type).toBe('password');
    fireEvent.change(webhook, { target: { value: WEBHOOK } });
    fireEvent.change(screen.getByLabelText('system.alerts.robot.keyword'), {
      target: { value: '告警' },
    });
    fireEvent.click(screen.getByLabelText('system.alerts.rules.workers'));
    fireEvent.change(screen.getByLabelText('system.alerts.rules.threshold'), {
      target: { value: '0' },
    });
    fireEvent.change(screen.getByLabelText('system.alerts.rules.repeatInterval'), {
      target: { value: '12' },
    });

    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(service.updateAlertSettings).toHaveBeenCalledWith({
      expectedRevision: 4,
      robotSecret: { action: 'keep' },
      robotWebhook: { action: 'replace', value: WEBHOOK },
      settings: expect.objectContaining({
        channels: expect.objectContaining({
          // The token never travels inside `settings`.
          dingtalkRobot: { enabled: true, keyword: '告警', webhookUrl: null },
        }),
        dingtalkApiDailyThreshold: 0,
        repeatIntervalHours: 12,
        rules: {
          capabilities: true,
          dependencies: true,
          dingtalkApiBudget: true,
          runtimeErrors: true,
          workers: false,
        },
      }),
    });
    expect(toast.success).toHaveBeenCalledWith('system.alerts.toast.saved');
    // The accepted document is the new baseline; the stored webhook shows only its masked hint.
    await waitFor(() => expect((saveButton() as HTMLButtonElement).disabled).toBe(true));
    const saved = screen.getByLabelText('system.alerts.robot.webhookUrl') as HTMLInputElement;
    expect(saved.value).toBe('');
    expect(
      within(channel('dingtalkRobot')).getByText(
        `system.alerts.credential.stored:{"hint":"${WEBHOOK_HINT}"}`,
      ),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain('access_token=abc123');
  });

  it('keeps / replaces / clears the webhook and the signing secret', async () => {
    const view = buildView({
      dingtalkRobotSecretSet: true,
      dingtalkRobotWebhook: { hint: WEBHOOK_HINT, set: true },
    });
    view.settings.channels.dingtalkRobot = { enabled: true, keyword: null, webhookUrl: null };
    const { service } = renderDrawer(createService(view));
    await loaded();

    const secret = () => screen.getByLabelText('system.alerts.robot.secret') as HTMLInputElement;
    const webhook = () =>
      screen.getByLabelText('system.alerts.robot.webhookUrl') as HTMLInputElement;
    expect(secret().placeholder).toBe('systemGeneral.secret.storedPlaceholder');
    expect(webhook().placeholder).toBe('systemGeneral.secret.storedPlaceholder');

    // Replace the secret; the stored webhook is kept.
    fireEvent.change(secret(), { target: { value: 'SECnew' } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(service.updateAlertSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        robotSecret: { action: 'replace', value: 'SECnew' },
        robotWebhook: { action: 'keep' },
      }),
    );

    // Clear the secret (the saved view still reports one stored).
    await waitFor(() => expect(secret().value).toBe(''));
    fireEvent.click(
      within(secret().parentElement!).getByRole('button', { name: 'systemGeneral.secret.clear' }),
    );
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(service.updateAlertSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedRevision: 5, robotSecret: { action: 'clear' } }),
    );
  });

  it('rejects a whitespace-only signing secret instead of sending it', async () => {
    const view = buildView({ dingtalkRobotWebhook: { hint: WEBHOOK_HINT, set: true } });
    view.settings.channels.dingtalkRobot = { enabled: true, keyword: null, webhookUrl: null };
    const { service } = renderDrawer(createService(view));
    await loaded();

    const secret = screen.getByLabelText('system.alerts.robot.secret') as HTMLInputElement;
    expect(secret.maxLength).toBe(200);
    fireEvent.change(secret, { target: { value: '   ' } });
    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(service.updateAlertSettings).not.toHaveBeenCalled();
    expect(screen.getByText('system.alerts.errors.secretInvalid:{"max":200}')).toBeTruthy();
  });

  it('merges only my edits onto a concurrent change, keeping theirs on save', async () => {
    const service = createService();
    service.updateAlertSettings.mockRejectedValueOnce({
      data: { errorData: { code: 'PLATFORM_REVISION_CONFLICT' } },
    });
    // Meanwhile another admin set a threshold and added an email recipient (rev 9).
    const theirs = buildView({ revision: 9 });
    theirs.settings.dingtalkApiDailyThreshold = 20_000;
    theirs.settings.channels.email = { enabled: true, recipients: ['ops@example.com'] };
    service.getAlertSettings.mockResolvedValueOnce(buildView()).mockResolvedValueOnce(theirs);
    renderDrawer(service);
    await loaded();

    fireEvent.click(screen.getByLabelText('system.alerts.rules.workers'));
    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(toast.error).toHaveBeenCalledWith('system.alerts.toast.conflict');
    expect(service.getAlertSettings).toHaveBeenCalledTimes(2);
    // My edit survives and is still pending; their untouched-by-me fields are on screen.
    await waitFor(() => expect((saveButton() as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByLabelText('system.alerts.rules.workers') as HTMLInputElement).checked).toBe(
      false,
    );
    expect((screen.getByLabelText('system.alerts.rules.threshold') as HTMLInputElement).value).toBe(
      '20000',
    );

    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(service.updateAlertSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedRevision: 9,
        settings: expect.objectContaining({
          channels: expect.objectContaining({
            email: { enabled: true, recipients: ['ops@example.com'] },
          }),
          dingtalkApiDailyThreshold: 20_000,
          rules: expect.objectContaining({ workers: false }),
        }),
      }),
    );
  });

  it('retries silently when only a non-settings write moved the revision', async () => {
    const service = createService();
    service.updateAlertSettings.mockRejectedValueOnce({
      data: { errorData: { code: 'PLATFORM_REVISION_CONFLICT' } },
    });
    service.getAlertSettings
      .mockResolvedValueOnce(buildView({ revision: 0 }))
      .mockResolvedValueOnce(buildView({ revision: 1 }));
    renderDrawer(service);
    await loaded();

    fireEvent.click(screen.getByLabelText('system.alerts.rules.workers'));
    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(service.updateAlertSettings).toHaveBeenCalledTimes(2);
    expect(service.updateAlertSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedRevision: 1 }),
    );
    expect(toast.success).toHaveBeenCalledWith('system.alerts.toast.saved');
  });

  it('adopts the revision a token rotation wrote without touching unsaved edits', async () => {
    const service = createService(buildView({ revision: 0 }));
    // A fresh install: generating the first token creates the settings row at revision 1.
    service.getAlertSettings
      .mockResolvedValueOnce(buildView({ revision: 0 }))
      .mockResolvedValueOnce(buildView({ revision: 1 }));
    service.rotateStatusApiToken.mockResolvedValue({
      token: `sk-status-${'A1b2C3d4'.repeat(4)}`,
      view: { ...buildStatusApi(), tokenHint: 'sk-status-…C3d4', tokenSet: true },
    });
    renderDrawer(service);
    await loaded();

    fireEvent.click(screen.getByLabelText('system.alerts.rules.workers'));
    fireEvent.click(screen.getByRole('tab', { name: 'system.alerts.tabs.statusApi' }));
    const generate = await screen.findByRole('button', {
      name: 'system.statusApi.token.generate',
    });
    await act(async () => {
      fireEvent.click(generate);
    });
    // The rotation re-read 告警设置 behind the scenes.
    await waitFor(() => expect(service.getAlertSettings).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('tab', { name: 'system.alerts.tabs.alerts' }));
    expect((screen.getByLabelText('system.alerts.rules.workers') as HTMLInputElement).checked).toBe(
      false,
    );
    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(service.updateAlertSettings).toHaveBeenCalledTimes(1);
    expect(service.updateAlertSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 1,
        settings: expect.objectContaining({ rules: expect.objectContaining({ workers: false }) }),
      }),
    );
  });

  it("shows the server's own reason when it rejects a save, on the field it names", async () => {
    const service = createService();
    service.updateAlertSettings.mockRejectedValueOnce({
      data: {
        errorData: {
          code: 'PLATFORM_INVALID_INPUT',
          details: { field: 'channels.workNotice.roles' },
          message: '工作通知已启用，请至少选择一个管理员角色',
        },
      },
    });
    renderDrawer(service);
    await loaded();

    fireEvent.click(screen.getByLabelText('system.alerts.rules.workers'));
    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(toast.error).toHaveBeenCalledWith('工作通知已启用，请至少选择一个管理员角色');
    expect(toast.error).not.toHaveBeenCalledWith('system.alerts.toast.saveFailed');
    expect(
      within(channel('workNotice')).getByText('工作通知已启用，请至少选择一个管理员角色'),
    ).toBeTruthy();
    expect(channel('workNotice').dataset.invalid).toBe('true');

    // The next edit clears the server's verdict.
    fireEvent.click(screen.getByLabelText('system.alerts.rules.capabilities'));
    expect(
      within(channel('workNotice')).queryByText('工作通知已启用，请至少选择一个管理员角色'),
    ).toBeNull();
  });

  it('falls back to the generic message when the server gives no readable reason', async () => {
    const service = createService();
    service.updateAlertSettings.mockRejectedValueOnce({
      data: { errorData: { code: 'PLATFORM_INVALID_INPUT', message: 'PLATFORM_INVALID_INPUT' } },
    });
    renderDrawer(service);
    await loaded();

    fireEvent.click(screen.getByLabelText('system.alerts.rules.workers'));
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(toast.error).toHaveBeenCalledWith('system.alerts.toast.saveFailed');
  });

  it('tests a saved channel; server errors show behind a localized prefix', async () => {
    const { service } = renderDrawer();
    await loaded();

    await act(async () => {
      fireEvent.click(testButton('workNotice'));
    });

    expect(service.testAlertChannel).toHaveBeenCalledWith({ channel: 'workNotice' });
    expect(
      within(channel('workNotice')).getByText('system.alerts.test.success:{"count":3}'),
    ).toBeTruthy();

    service.testAlertChannel.mockResolvedValueOnce({
      delivered: 0,
      error: '无可用的钉钉账号',
      ok: false,
    });
    await act(async () => {
      fireEvent.click(testButton('workNotice'));
    });
    expect(
      within(channel('workNotice')).getByText(
        'system.alerts.test.failed:{"error":"无可用的钉钉账号"}',
      ),
    ).toBeTruthy();
  });

  it('explains why a test cannot run yet', async () => {
    const { service } = renderDrawer();
    await loaded();

    // Switched on in the form but not saved as on yet.
    fireEvent.click(within(channel('email')).getByRole('switch'));
    expect(testButton('email').disabled).toBe(true);
    expect(within(channel('email')).getByText('system.alerts.test.saveFirst')).toBeTruthy();

    // Saved as on, but the form has unsaved edits.
    expect(testButton('workNotice').disabled).toBe(true);
    expect(within(channel('workNotice')).getByText('system.alerts.test.unsaved')).toBeTruthy();
    expect(within(channel('workNotice')).queryByText('system.alerts.test.saveFirst')).toBeNull();
    expect(service.testAlertChannel).not.toHaveBeenCalled();
  });

  it('disables channels whose backend is missing and links to where it is configured', async () => {
    renderDrawer(createService(buildView({ mailConfigured: false, notifyAppConfigured: false })));
    await loaded();

    const workNotice = channel('workNotice');
    expect(workNotice.textContent).toContain('system.alerts.channels.notifyAppMissing');
    expect(
      within(workNotice)
        .getByRole('link', { name: 'system.alerts.channels.configure' })
        .getAttribute('href'),
    ).toBe('/admin/system/general?tab=im-connectors');
    // The test hint names the real cause, not "enable and save".
    expect(testButton('workNotice').disabled).toBe(true);
    expect(
      within(workNotice)
        .getAllByTestId('tooltip')
        .map((tip) => tip.textContent),
    ).toContain('system.alerts.channels.notifyAppMissing');
    // Stored as on: it can still be switched off, but never back on while the app is missing.
    const workNoticeSwitch = within(workNotice).getByRole('switch') as HTMLButtonElement;
    expect(workNoticeSwitch.disabled).toBe(false);
    fireEvent.click(workNoticeSwitch);
    expect(workNoticeSwitch.getAttribute('aria-checked')).toBe('false');
    expect(workNoticeSwitch.disabled).toBe(true);

    const email = channel('email');
    expect((within(email).getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
    expect(email.textContent).toContain('system.alerts.channels.mailMissing');
    expect(
      within(email)
        .getByRole('link', { name: 'system.alerts.channels.configure' })
        .getAttribute('href'),
    ).toBe('/admin/system/general?tab=infrastructure');

    // The robot needs nothing else from the platform.
    expect(
      (within(channel('dingtalkRobot')).getByRole('switch') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('points at 模块配置 when the notification module itself is off', async () => {
    modules.state = { dingtalkNotify: false };
    renderDrawer(createService(buildView({ notifyAppConfigured: false })));
    await loaded();

    const workNotice = channel('workNotice');
    expect(workNotice.textContent).toContain('system.alerts.channels.notifyModuleOff');
    expect(workNotice.textContent).not.toContain('system.alerts.channels.notifyAppMissing');
    expect(
      within(workNotice)
        .getByRole('link', { name: 'system.alerts.channels.configure' })
        .getAttribute('href'),
    ).toBe('/admin/system/modules');
  });

  it('keeps stored robot credentials reachable while the robot is off', async () => {
    const view = buildView({ dingtalkRobotWebhook: { hint: WEBHOOK_HINT, set: true } });
    const { service } = renderDrawer(createService(view));
    await loaded();

    const webhook = screen.getByLabelText('system.alerts.robot.webhookUrl') as HTMLInputElement;
    fireEvent.click(
      within(webhook.parentElement!).getByRole('button', { name: 'systemGeneral.secret.clear' }),
    );
    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(service.updateAlertSettings).toHaveBeenCalledWith(
      expect.objectContaining({ robotWebhook: { action: 'clear' } }),
    );
  });

  it('locks the master switch with a notice when alerts are off by environment', async () => {
    renderDrawer(createService(buildView({ envDisabled: true })));

    const master = await loaded();
    expect((master as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('system.alerts.envDisabled')).toBeTruthy();
  });

  it('shows read-only users every control disabled and a single close button', async () => {
    const onClose = vi.fn();
    renderDrawer(createService(), { canOperate: false, onClose });

    const master = await loaded();
    expect((master as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('system.alerts.readOnly')).toBeTruthy();
    const footer = screen.getByTestId('drawer-footer');
    expect(within(footer).queryByRole('button', { name: 'system.alerts.save' })).toBeNull();
    expect(within(footer).queryByRole('button', { name: 'system.alerts.cancel' })).toBeNull();
    fireEvent.click(within(footer).getByRole('button', { name: 'system.alerts.close' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    for (const name of ['workNotice', 'dingtalkRobot', 'email'] as const) {
      expect((within(channel(name)).getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
    }
    expect(testButton('workNotice').disabled).toBe(true);
    // No "save first" advice for someone who cannot save.
    expect(channel('workNotice').textContent).not.toContain('system.alerts.test.saveFirst');
    expect(channel('workNotice').textContent).not.toContain('system.alerts.test.unsaved');
    expect(
      (within(channel('workNotice')).getByLabelText('users.roles.auditor') as HTMLInputElement)
        .disabled,
    ).toBe(true);
  });

  it('picks recipients, flags unbound users and never sends a deleted one', async () => {
    const view = buildView({
      recipientUsers: [
        { avatar: null, banned: false, dingtalkBound: true, id: 'u1', name: '张三' },
        { avatar: null, banned: false, dingtalkBound: false, id: 'u2', name: '李四' },
      ],
    });
    view.settings.channels.workNotice = {
      enabled: true,
      recipientMode: 'users',
      roles: [],
      userIds: ['u1', 'u2', 'u-gone'],
    };
    const { service } = renderDrawer(createService(view));
    await loaded();

    const users = screen.getAllByTestId('alert-recipient-user');
    expect(users).toHaveLength(3);
    expect(users[0].textContent).toContain('张三');
    expect(users[1].textContent).toContain('李四');
    // Only the unbound (existing) user carries the warning; the deleted id is labelled as such.
    expect(screen.getAllByTestId('alert-recipient-unbound')).toHaveLength(1);
    expect(within(users[1]).getByTestId('alert-recipient-unbound')).toBeTruthy();
    expect(users[2].dataset.missing).toBe('true');
    expect(users[2].textContent).toContain('system.alerts.recipients.deleted');
    expect(within(users[2]).queryByTestId('alert-recipient-unbound')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'pick-user' }));
    fireEvent.click(within(users[0]).getByRole('button', { name: 'remove' }));
    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(service.updateAlertSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          channels: expect.objectContaining({
            workNotice: {
              enabled: true,
              recipientMode: 'users',
              roles: [],
              userIds: ['u2', 'u9'],
            },
          }),
        }),
      }),
    );
  });

  it('marks disabled recipients and does not count them as reachable', async () => {
    const view = buildView({
      recipientUsers: [
        { avatar: null, banned: true, dingtalkBound: false, id: 'u1', name: '张三' },
      ],
    });
    view.settings.channels.workNotice = {
      enabled: true,
      recipientMode: 'users',
      roles: [],
      userIds: ['u1'],
    };
    const { service } = renderDrawer(createService(view));
    await loaded();

    const [user] = screen.getAllByTestId('alert-recipient-user');
    expect(user.dataset.banned).toBe('true');
    expect(within(user).getByTestId('alert-recipient-banned').textContent).toBe(
      'system.alerts.recipients.banned',
    );
    expect(
      within(user)
        .getAllByTestId('tooltip')
        .map((tip) => tip.textContent),
    ).toContain('system.alerts.recipients.bannedHelp');
    // "Disabled" already says it all — no DingTalk-binding warning on top.
    expect(within(user).queryByTestId('alert-recipient-unbound')).toBeNull();

    fireEvent.click(screen.getByLabelText('system.alerts.rules.workers'));
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(service.updateAlertSettings).not.toHaveBeenCalled();
    expect(screen.getByText('system.alerts.errors.usersRequired')).toBeTruthy();
  });

  it('rejects a work notice whose only recipients were deleted', async () => {
    const view = buildView();
    view.settings.channels.workNotice = {
      enabled: true,
      recipientMode: 'users',
      roles: [],
      userIds: ['u-gone'],
    };
    const { service } = renderDrawer(createService(view));
    await loaded();

    fireEvent.click(screen.getByLabelText('system.alerts.rules.workers'));
    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(service.updateAlertSettings).not.toHaveBeenCalled();
    expect(screen.getByText('system.alerts.errors.usersRequired')).toBeTruthy();
    expect(channel('workNotice').dataset.invalid).toBe('true');
  });

  it('drops unsaved edits on cancel', async () => {
    const onClose = vi.fn();
    const { service } = renderDrawer(createService(), { onClose });
    await loaded();

    fireEvent.click(screen.getByLabelText('system.alerts.rules.workers'));
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'system.alerts.cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('system.alerts.rules.workers') as HTMLInputElement).checked).toBe(
      true,
    );
    expect(service.updateAlertSettings).not.toHaveBeenCalled();
  });
});
