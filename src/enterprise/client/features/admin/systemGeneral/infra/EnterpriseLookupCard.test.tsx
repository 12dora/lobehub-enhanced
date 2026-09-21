// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type {
  AdminEnterpriseLookupSettingsService,
  AdminSystemEnterpriseLookupSettings,
} from '@/enterprise/client/services/adminSystem';

import { EnterpriseLookupCard } from './EnterpriseLookupCard';

const mocks = vi.hoisted(() => ({
  swr: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

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

vi.mock('@lobehub/ui', () => ({
  Alert: ({ message }: { message?: ReactNode }) => <div role="alert">{message}</div>,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  CheckboxGroup: ({
    onChange,
    options,
    value,
  }: {
    onChange?: (next: string[]) => void;
    options?: Array<{ label: string; value: string }>;
    value?: string[];
  }) => (
    <div>
      {(options ?? []).map((option) => (
        <label key={option.value}>
          {option.label}
          <input
            checked={(value ?? []).includes(option.value)}
            type="checkbox"
            onChange={(event) =>
              onChange?.(
                event.target.checked
                  ? [...(value ?? []), option.value]
                  : (value ?? []).filter((entry) => entry !== option.value),
              )
            }
          />
        </label>
      ))}
    </div>
  ),
  confirmModal: vi.fn(),
  Input: (props: Record<string, unknown>) => <input {...props} />,
  InputPassword: (props: Record<string, unknown>) => <input {...props} />,
  // Rendered only while open, exactly as base-ui does — so "behind 详情" is a real assertion.
  Modal: ({
    children,
    footer,
    open,
    title,
  }: {
    children?: ReactNode;
    footer?: ReactNode;
    open?: boolean;
    title?: ReactNode;
  }) =>
    open ? (
      <div role="dialog">
        <h3>{title}</h3>
        {children}
        {footer}
      </div>
    ) : null,
  ScrollArea: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Select: ({
    onChange,
    options,
    value,
  }: {
    onChange?: (next: string) => void;
    options?: Array<{ label: string; value: string }>;
    value?: string;
  }) => (
    <select value={value} onChange={(event) => onChange?.(event.target.value)}>
      {(options ?? []).map((entry) => (
        <option key={entry.value} value={entry.value}>
          {entry.label}
        </option>
      ))}
    </select>
  ),
  SkeletonText: () => <div data-testid="skeleton" />,
  Switch: ({
    checked,
    id,
    onChange,
  }: {
    checked?: boolean;
    id?: string;
    onChange?: (next: boolean) => void;
  }) => (
    <button
      aria-checked={checked}
      id={id}
      role="switch"
      type="button"
      onClick={() => onChange?.(!checked)}
    />
  ),
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (...args: unknown[]) => mocks.swr(...args),
}));

vi.mock('@/enterprise/client/providers/AdminAccessProvider', () => ({
  useAdminAccess: () => ({ authMethod: 'password', permissions: [] }),
}));

vi.mock('../../primitives/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: () => undefined,
}));

vi.mock('../../primitives/runAdminMutation', () => ({
  runAdminMutation: async ({ run }: { run: () => Promise<void> }) => {
    await run();
    return true;
  },
}));

vi.mock('./invalidate', () => ({
  invalidateAdminEnterpriseLookupSettings: () => Promise.resolve(),
}));

const view = (
  overrides: Partial<AdminSystemEnterpriseLookupSettings['config']> = {},
  rest: Partial<Omit<AdminSystemEnterpriseLookupSettings, 'config'>> = {},
): AdminSystemEnterpriseLookupSettings => ({
  config: {
    dailyLimitPerUser: 50,
    defaultProvider: 'qcc',
    fallbackEnabled: true,
    qcc: {
      apiKeyFingerprint: 'a1b2c3',
      apiKeyStored: true,
      categories: ['company', 'risk'],
      enabled: true,
    },
    tianyancha: { apiKeyStored: false, enabled: false },
    ...overrides,
  },
  revision: 3,
  status: 'configured',
  updatedAt: null,
  ...rest,
});

const service = (
  overrides: Partial<AdminEnterpriseLookupSettingsService> = {},
): AdminEnterpriseLookupSettingsService => ({
  getEnterpriseLookupSettings: vi.fn(),
  testEnterpriseLookupProvider: vi.fn(),
  updateEnterpriseLookupSettings: vi.fn().mockResolvedValue(view({}, { revision: 4 })),
  ...overrides,
});

const swrAnswer = (answer: {
  data?: AdminSystemEnterpriseLookupSettings;
  error?: unknown;
  mutate?: () => void;
}) => {
  mocks.swr.mockReset();
  mocks.swr.mockReturnValue({
    isLoading: !answer.data && !answer.error,
    mutate: vi.fn(),
    ...answer,
  });
};

describe('EnterpriseLookupCard', () => {
  it('keeps a full-height card while its own request is still in flight', () => {
    swrAnswer({});
    render(<EnterpriseLookupCard canOperate service={service()} />);

    expect(screen.getByText('systemGeneral.enterpriseLookup.title')).toBeTruthy();
    expect(screen.getByTestId('skeleton')).toBeTruthy();
    expect(screen.queryByText('systemGeneral.card.edit')).toBeNull();
  });

  it('offers a retry rather than an empty card when the request failed', () => {
    const mutate = vi.fn();
    swrAnswer({ error: new Error('boom'), mutate });
    render(<EnterpriseLookupCard canOperate service={service()} />);

    fireEvent.click(screen.getByText('systemGeneral.retry'));
    expect(mutate).toHaveBeenCalled();
  });

  /** 状态 / 默认供应商 / both providers / 每人每日上限 — the five rows §2.6 asks for. */
  it('summarises the five readings and identifies a stored key by its digest only', () => {
    swrAnswer({ data: view() });
    render(<EnterpriseLookupCard canOperate service={service()} />);

    /**
     * Label and value share one row, so a cell that appears once identifies the row it sits in.
     * 默认供应商 reads 企查查, which is also the label of the 企查查 row — the provider name is
     * therefore on the card twice, and every assertion about it has to say which row it means.
     */
    const rowOf = (text: string): HTMLElement => {
      const row = screen.getByText(text).parentElement;
      if (!row) throw new Error(`no row holds "${text}"`);
      return row;
    };

    expect(screen.getByText('systemGeneral.enterpriseLookup.fields.status')).toBeTruthy();
    expect(
      within(rowOf('systemGeneral.enterpriseLookup.fields.defaultProvider')).getByText(
        'systemGeneral.enterpriseLookup.provider.qcc',
      ),
    ).toBeTruthy();
    expect(
      within(
        rowOf('systemGeneral.enterpriseLookup.values.enabledWithKey:{"fingerprint":"a1b2c3"}'),
      ).getByText('systemGeneral.enterpriseLookup.provider.qcc'),
    ).toBeTruthy();
    expect(
      within(rowOf('systemGeneral.enterpriseLookup.values.disabled')).getByText(
        'systemGeneral.enterpriseLookup.provider.tianyancha',
      ),
    ).toBeTruthy();
    expect(screen.getByText('systemGeneral.enterpriseLookup.fields.dailyLimit')).toBeTruthy();
    // 查询类目 is a detail, not one of the five readings.
    expect(screen.queryByText('systemGeneral.enterpriseLookup.fields.categories')).toBeNull();
  });

  it('reads 0 as unlimited rather than as a cap of zero', () => {
    swrAnswer({ data: view({ dailyLimitPerUser: 0 }) });
    render(<EnterpriseLookupCard canOperate service={service()} />);

    expect(screen.getByText('systemGeneral.enterpriseLookup.values.unlimited')).toBeTruthy();
  });

  it('keeps the category scope and the fallback rule in 详情', () => {
    swrAnswer({ data: view() });
    render(<EnterpriseLookupCard canOperate service={service()} />);

    fireEvent.click(screen.getByText('systemGeneral.card.details'));

    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('systemGeneral.enterpriseLookup.fields.categories')).toBeTruthy();
    expect(dialog.getByText('systemGeneral.enterpriseLookup.fields.fallback')).toBeTruthy();
  });

  it('shows no 编辑 door without SYSTEM_OPERATE', () => {
    swrAnswer({ data: view() });
    render(<EnterpriseLookupCard canOperate={false} service={service()} />);

    expect(screen.queryByText('systemGeneral.card.edit')).toBeNull();
    expect(screen.getByText('systemGeneral.card.details')).toBeTruthy();
  });

  it('saves the draft against the revision it was seeded from', async () => {
    const updateEnterpriseLookupSettings = vi.fn().mockResolvedValue(view({}, { revision: 4 }));
    swrAnswer({ data: view() });
    render(
      <EnterpriseLookupCard canOperate service={service({ updateEnterpriseLookupSettings })} />,
    );

    fireEvent.click(screen.getByText('systemGeneral.card.edit'));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByDisplayValue('50'), { target: { value: '120' } });
    fireEvent.click(dialog.getByText('systemGeneral.edit.save'));

    await waitFor(() =>
      expect(updateEnterpriseLookupSettings).toHaveBeenCalledWith({
        config: expect.objectContaining({
          dailyLimitPerUser: 120,
          qcc: expect.objectContaining({ apiKey: { action: 'keep' }, enabled: true }),
        }),
        expectedRevision: 3,
      }),
    );
  });

  /** An unsaved draft must not be written, and an unwritable draft must not be sent. */
  it('refuses to save while a newly enabled provider has no key', async () => {
    const updateEnterpriseLookupSettings = vi.fn();
    swrAnswer({ data: view() });
    render(
      <EnterpriseLookupCard canOperate service={service({ updateEnterpriseLookupSettings })} />,
    );

    fireEvent.click(screen.getByText('systemGeneral.card.edit'));
    const dialog = within(screen.getByRole('dialog'));
    // 天眼查 is the second 启用 switch in the form.
    fireEvent.click(dialog.getAllByRole('switch')[1]!);
    fireEvent.click(dialog.getByText('systemGeneral.edit.save'));

    await waitFor(() =>
      expect(dialog.getByText('systemGeneral.enterpriseLookup.errors.secretRequired')).toBeTruthy(),
    );
    expect(updateEnterpriseLookupSettings).not.toHaveBeenCalled();
  });

  /** Rotating a key is exactly when you want to know whether the NEW one works. */
  it('probes with the unsaved key when one was typed, and with the stored key otherwise', async () => {
    const testEnterpriseLookupProvider = vi.fn().mockResolvedValue({ ok: true, toolCount: 12 });
    swrAnswer({ data: view() });
    render(<EnterpriseLookupCard canOperate service={service({ testEnterpriseLookupProvider })} />);

    fireEvent.click(screen.getByText('systemGeneral.card.edit'));
    const dialog = within(screen.getByRole('dialog'));

    fireEvent.click(dialog.getAllByText('systemGeneral.testConnection')[0]!);
    await waitFor(() =>
      expect(testEnterpriseLookupProvider).toHaveBeenCalledWith({ provider: 'qcc' }),
    );
    expect(dialog.getByText('systemGeneral.enterpriseLookup.test.success')).toBeTruthy();

    const qccKeyInput = dialog.getAllByPlaceholderText(
      'systemGeneral.secret.storedPlaceholder',
    )[0]!;
    fireEvent.change(qccKeyInput, { target: { value: 'freshly-pasted' } });
    fireEvent.click(dialog.getAllByText('systemGeneral.testConnection')[0]!);

    await waitFor(() =>
      expect(testEnterpriseLookupProvider).toHaveBeenLastCalledWith({
        draft: { apiKey: 'freshly-pasted' },
        provider: 'qcc',
      }),
    );
  });

  /** A round trip for a provider with no key at all would only spend quota to learn nothing. */
  it('answers 未配置 for a provider with no key without calling the server', async () => {
    const testEnterpriseLookupProvider = vi.fn();
    swrAnswer({ data: view() });
    render(<EnterpriseLookupCard canOperate service={service({ testEnterpriseLookupProvider })} />);

    fireEvent.click(screen.getByText('systemGeneral.card.edit'));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getAllByText('systemGeneral.testConnection')[1]!);

    await waitFor(() =>
      expect(
        dialog.getByText('systemGeneral.enterpriseLookup.test.reason.notConfigured'),
      ).toBeTruthy(),
    );
    expect(testEnterpriseLookupProvider).not.toHaveBeenCalled();
  });

  /** The select must never offer a default the server would reject. */
  it('lists only enabled providers as the default, and moves the default off a disabled one', () => {
    swrAnswer({
      data: view({
        qcc: { apiKeyStored: true, categories: ['company'], enabled: true },
        tianyancha: { apiKeyStored: true, enabled: true },
      }),
    });
    render(<EnterpriseLookupCard canOperate service={service()} />);

    fireEvent.click(screen.getByText('systemGeneral.card.edit'));
    const dialog = within(screen.getByRole('dialog'));

    expect(dialog.getByDisplayValue('systemGeneral.enterpriseLookup.provider.qcc')).toBeTruthy();

    // Switch 企查查 off: the default has to follow, or the save would be refused.
    fireEvent.click(dialog.getAllByRole('switch')[0]!);

    expect(
      dialog.getByDisplayValue('systemGeneral.enterpriseLookup.provider.tianyancha'),
    ).toBeTruthy();
    expect(dialog.queryByText('systemGeneral.enterpriseLookup.errors.defaultProvider')).toBeNull();
  });
});
