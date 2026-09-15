// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminImConnectorView } from '@/enterprise/client/services/adminImConnectors';

import { DingTalkConnectorCard } from './DingTalkConnectorCard';
import type { ImConnectorMutationService } from './service';

const mocks = vi.hoisted(() => ({
  runAdminMutation: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
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

// InfraField / InfraSwitchRow still take Icon and Tooltip from the root package.
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
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
  Input: (props: Record<string, unknown>) => <input {...props} />,
  InputNumber: ({
    disabled,
    id,
    onChange,
    value,
  }: {
    disabled?: boolean;
    id?: string;
    onChange?: (next: number | null) => void;
    value?: number | null;
  }) => (
    <input
      disabled={disabled}
      id={id}
      value={value ?? ''}
      onChange={(event) =>
        onChange?.(event.target.value === '' ? null : Number(event.target.value))
      }
    />
  ),
  InputPassword: (props: Record<string, unknown>) => <input type="password" {...props} />,
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
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
  Tooltip: ({ children, title }: { children?: ReactNode; title?: string }) => (
    <span data-tooltip={title}>{children}</span>
  ),
}));

vi.mock('@/enterprise/client/providers/AdminAccessProvider', () => ({
  useAdminAccess: () => ({ authMethod: 'better-auth', permissions: [], status: 'allowed' }),
}));

vi.mock('../../primitives/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: () => undefined,
}));

vi.mock('../../primitives/runAdminMutation', () => ({
  runAdminMutation: (options: { run: () => Promise<void> }) => mocks.runAdminMutation(options),
}));

const view = (overrides: Partial<AdminImConnectorView> = {}): AdminImConnectorView => ({
  aiCardTemplateId: null,
  chatEnabled: true,
  clientId: 'ding-app-key',
  clientSecretFingerprint: 'a1b2c3',
  configured: true,
  enabled: true,
  hasClientSecret: true,
  idleNewTopicEnabled: true,
  idleNewTopicHours: 24,
  platform: 'dingtalk',
  pushEnabled: true,
  robotCode: 'ding-robot',
  selectCardTemplateId: null,
  stats: { linkedUsers: 3, messages7d: 12, pushes7d: 4 },
  status: {
    connectedAt: '2026-09-15T00:00:00.000Z',
    lastError: null,
    lastErrorAt: null,
    lastEventAt: '2026-09-15T01:00:00.000Z',
    state: 'connected',
  },
  updatedAt: '2026-09-15T00:00:00.000Z',
  ...overrides,
});

const service = (overrides: Partial<ImConnectorMutationService> = {}) =>
  ({
    test: vi.fn(),
    upsert: vi.fn().mockResolvedValue(view()),
    ...overrides,
  }) as unknown as ImConnectorMutationService & {
    test: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };

beforeEach(() => {
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.runAdminMutation.mockReset();
  mocks.runAdminMutation.mockImplementation(async ({ run }: { run: () => Promise<void> }) => {
    await run();
    return true;
  });
});

describe('DingTalkConnectorCard', () => {
  it('reports the live connection state and the counters', () => {
    render(<DingTalkConnectorCard canOperate view={view()} />);

    expect(screen.getByText('systemGeneral.imConnectors.status.connected')).toBeTruthy();
    expect(screen.getByText(/systemGeneral.imConnectors.stats.linkedUsers:3/)).toBeTruthy();
    expect(screen.getByText(/systemGeneral.imConnectors.stats.messages7d:12/)).toBeTruthy();
    expect(screen.getByText(/systemGeneral.imConnectors.stats.pushes7d:4/)).toBeTruthy();
  });

  it('explains a failed connection through the last error', () => {
    const { container } = render(
      <DingTalkConnectorCard
        canOperate
        view={view({
          status: {
            connectedAt: null,
            lastError: 'invalid client secret',
            lastErrorAt: '2026-09-15T01:00:00.000Z',
            lastEventAt: null,
            state: 'error',
          },
        })}
      />,
    );

    expect(screen.getByText('systemGeneral.imConnectors.status.error')).toBeTruthy();
    expect(container.querySelector('[data-tooltip="invalid client secret"]')).toBeTruthy();
  });

  it('never echoes the stored secret, only its fingerprint', () => {
    render(<DingTalkConnectorCard canOperate view={view()} />);

    const secret = screen.getByLabelText(
      'systemGeneral.imConnectors.fields.clientSecret',
    ) as HTMLInputElement;
    expect(secret.value).toBe('');
    expect(secret.getAttribute('placeholder')).toBe('systemGeneral.secret.storedPlaceholder');
    expect(screen.getByText('systemGeneral.imConnectors.secret.stored:a1b2c3')).toBeTruthy();
  });

  it('leaves an admin without SYSTEM_OPERATE a read-only card', () => {
    render(<DingTalkConnectorCard canOperate={false} view={view()} />);

    expect(screen.getByText('systemGeneral.imConnectors.readOnly')).toBeTruthy();
    expect(screen.queryByText('systemGeneral.edit.save')).toBeNull();
    expect(screen.queryByText('systemGeneral.testConnection')).toBeNull();
    expect(
      (screen.getByLabelText('systemGeneral.imConnectors.fields.clientId') as HTMLInputElement)
        .disabled,
    ).toBe(true);
  });

  it('keeps the stored secret when the field is left untouched', async () => {
    const stub = service();
    render(<DingTalkConnectorCard canOperate service={stub} view={view()} />);

    fireEvent.click(screen.getByLabelText('systemGeneral.imConnectors.fields.pushEnabled'));
    fireEvent.click(screen.getByText('systemGeneral.edit.save'));

    await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
    expect(stub.upsert.mock.calls[0]![0]).toMatchObject({
      clientSecret: { action: 'keep' },
      platform: 'dingtalk',
      pushEnabled: false,
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('systemGeneral.imConnectors.saved');
  });

  it('replaces the secret with what the admin typed', async () => {
    const stub = service();
    render(<DingTalkConnectorCard canOperate service={stub} view={view()} />);

    fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.fields.clientSecret'), {
      target: { value: 'next-secret' },
    });
    fireEvent.click(screen.getByText('systemGeneral.edit.save'));

    await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
    expect(stub.upsert.mock.calls[0]![0].clientSecret).toEqual({
      action: 'replace',
      value: 'next-secret',
    });
  });

  it('refuses to write a draft the contract would reject', async () => {
    const stub = service();
    render(<DingTalkConnectorCard canOperate service={stub} view={view()} />);

    fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.fields.clientId'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByText('systemGeneral.edit.save'));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('systemGeneral.edit.invalidDraft'),
    );
    expect(stub.upsert).not.toHaveBeenCalled();
    expect(screen.getByText('systemGeneral.errors.required')).toBeTruthy();
  });

  it('flags an idle duration outside the contract range', async () => {
    const stub = service();
    render(<DingTalkConnectorCard canOperate service={stub} view={view()} />);

    fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.fields.idleNewTopicHours'), {
      target: { value: '721' },
    });
    fireEvent.click(screen.getByText('systemGeneral.edit.save'));

    await waitFor(() =>
      expect(screen.getByText('systemGeneral.imConnectors.errors.idleHours')).toBeTruthy(),
    );
    expect(stub.upsert).not.toHaveBeenCalled();
  });

  it('disables the idle duration while the rule is off', () => {
    render(<DingTalkConnectorCard canOperate view={view({ idleNewTopicEnabled: false })} />);

    expect(
      (
        screen.getByLabelText(
          'systemGeneral.imConnectors.fields.idleNewTopicHours',
        ) as HTMLInputElement
      ).disabled,
    ).toBe(true);
  });

  it('probes with the draft values and reports the robot it reached', async () => {
    const stub = service({
      test: vi.fn().mockResolvedValue({
        errorCode: null,
        errorMessage: null,
        latencyMs: 142,
        ok: true,
        robotName: '智能助理',
      }),
    });
    render(<DingTalkConnectorCard canOperate service={stub} view={view()} />);

    fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.fields.clientSecret'), {
      target: { value: 'typed-secret' },
    });
    fireEvent.click(screen.getByText('systemGeneral.testConnection'));

    await waitFor(() => expect(screen.getByText('systemGeneral.test.latency:142')).toBeTruthy());
    expect(stub.test).toHaveBeenCalledWith({
      clientId: 'ding-app-key',
      clientSecret: 'typed-secret',
      platform: 'dingtalk',
      robotCode: 'ding-robot',
    });
    expect(
      screen.getByText(
        /systemGeneral.test.success · systemGeneral.imConnectors.test.robotName:智能助理/,
      ),
    ).toBeTruthy();
  });

  it('maps a failed probe onto the error copy for its code', async () => {
    const stub = service({
      test: vi.fn().mockResolvedValue({
        errorCode: 'auth_failed',
        errorMessage: 'invalid appSecret',
        latencyMs: 88,
        ok: false,
        robotName: null,
      }),
    });
    render(<DingTalkConnectorCard canOperate service={stub} view={view()} />);

    fireEvent.click(screen.getByText('systemGeneral.testConnection'));

    await waitFor(() =>
      expect(screen.getByText('systemGeneral.imConnectors.test.errors.auth_failed')).toBeTruthy(),
    );
  });

  it('falls back to the unknown failure copy for a code it does not know', async () => {
    const stub = service({
      test: vi.fn().mockResolvedValue({
        errorCode: 'teapot',
        errorMessage: null,
        latencyMs: null,
        ok: false,
        robotName: null,
      }),
    });
    render(<DingTalkConnectorCard canOperate service={stub} view={view()} />);

    fireEvent.click(screen.getByText('systemGeneral.testConnection'));

    await waitFor(() =>
      expect(screen.getByText('systemGeneral.imConnectors.test.errors.unknown')).toBeTruthy(),
    );
  });

  it('restores the server values when the edit is abandoned', () => {
    render(<DingTalkConnectorCard canOperate view={view()} />);

    const clientId = screen.getByLabelText(
      'systemGeneral.imConnectors.fields.clientId',
    ) as HTMLInputElement;
    fireEvent.change(clientId, { target: { value: 'typo' } });
    expect(clientId.value).toBe('typo');

    fireEvent.click(screen.getByText('systemGeneral.edit.cancel'));
    expect(
      (screen.getByLabelText('systemGeneral.imConnectors.fields.clientId') as HTMLInputElement)
        .value,
    ).toBe('ding-app-key');
  });
});
