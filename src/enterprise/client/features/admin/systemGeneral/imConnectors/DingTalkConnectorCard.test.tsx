// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AdminImConnectorDirectoryStatus,
  AdminImConnectorView,
} from '@/enterprise/client/services/adminImConnectors';

import { DingTalkConnectorCard } from './DingTalkConnectorCard';
import type { ImConnectorMutationService, ImConnectorNotifyAppService } from './service';

const mocks = vi.hoisted(() => ({
  confirmModal: vi.fn(),
  /** Module states by id; a missing id reads as installed (every module defaults on). */
  modules: {} as Record<string, boolean>,
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

// The "?" help buttons take Icon and Tooltip from the root package; the guidance is exposed as an
// attribute so a test can tell it moved into a tooltip rather than an inline paragraph.
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
  Tooltip: ({ children, title }: { children?: ReactNode; title?: string }) => (
    <span data-help={title}>{children}</span>
  ),
}));

vi.mock('@/enterprise/client/hooks/useModuleEnabled', () => ({
  useModuleEnabled: (id: string) => mocks.modules[id] ?? true,
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
  // The tier confirmation is covered where it is decided (useImConnectorEditor / draft).
  confirmModal: mocks.confirmModal,
  Input: (props: Record<string, unknown>) => <input {...props} />,
  InputNumber: ({
    'aria-describedby': describedBy,
    disabled,
    id,
    onChange,
    value,
  }: {
    'aria-describedby'?: string;
    'disabled'?: boolean;
    'id'?: string;
    'onChange'?: (next: number | null) => void;
    'value'?: number | null;
  }) => (
    <input
      aria-describedby={describedBy}
      disabled={disabled}
      id={id}
      value={value ?? ''}
      onChange={(event) =>
        onChange?.(event.target.value === '' ? null : Number(event.target.value))
      }
    />
  ),
  InputPassword: (props: Record<string, unknown>) => <input type="password" {...props} />,
  Select: ({
    disabled,
    id,
    onChange,
    options,
    value,
  }: {
    disabled?: boolean;
    id?: string;
    onChange?: (next: string) => void;
    options?: { label: string; value: string }[];
    value?: string;
  }) => (
    <select
      disabled={disabled}
      id={id}
      value={value ?? ''}
      onChange={(event) => onChange?.(event.target.value)}
    >
      {(options ?? []).map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
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
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
  // The status tag's details: rendered beside the tag so their lines can be read back.
  Tooltip: ({ children, title }: { children?: ReactNode; title?: ReactNode }) => (
    <span>
      {children}
      <span data-testid="status-details">{title}</span>
    </span>
  ),
}));

/**
 * Minimal SWR stand-in for the directory status: it runs the real fetcher, so the injected
 * notification-app service is exercised, and `mutate` re-runs it the way a refetch would.
 */
vi.mock('@/libs/swr', async () => {
  const { useCallback, useEffect, useRef, useState } = await import('react');

  const useClientDataSWR = (key: unknown, fetcher: () => Promise<unknown>) => {
    const [state, setState] = useState<{ data?: unknown; error?: unknown }>({});
    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;
    const serialized = JSON.stringify(key);

    const load = useCallback(async () => {
      if (!serialized) return;
      try {
        setState({ data: await fetcherRef.current() });
      } catch (error) {
        setState((previous) => ({ data: previous.data, error }));
      }
    }, [serialized]);

    useEffect(() => {
      void load();
    }, [load]);

    return { data: state.data, error: state.error, isLoading: !state.data, mutate: load };
  };

  return { mutate: vi.fn(), useClientDataSWR };
});

vi.mock('@/enterprise/client/providers/AdminAccessProvider', () => ({
  useAdminAccess: () => ({ authMethod: 'better-auth', permissions: [], status: 'allowed' }),
}));

vi.mock('../../primitives/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: () => undefined,
}));

vi.mock('../../primitives/runAdminMutation', () => ({
  runAdminMutation: (options: { run: () => Promise<void> }) => mocks.runAdminMutation(options),
}));

// 接口调用量 has its own suite (ApiCallStatsSection.test.tsx); the card only has to mount it.
vi.mock('./ApiCallStatsSection', () => ({
  ApiCallStatsSection: () => <div data-testid="api-stats" />,
}));

// The 绑定用户 list has its own suite (BindingsSection.test.tsx); here it only has to be mounted
// with what the card is responsible for handing it.
vi.mock('./BindingsSection', () => ({
  BindingsSection: ({ canOperate, platform }: { canOperate: boolean; platform: string }) => (
    <div data-can-operate={String(canOperate)} data-platform={platform} data-testid="bindings" />
  ),
}));

const view = (overrides: Partial<AdminImConnectorView> = {}): AdminImConnectorView => ({
  agentId: null,
  aiCardTemplateId: null,
  approvalAutomationTier: 'moderate',
  chatEnabled: true,
  clientId: 'ding-app-key',
  clientSecretFingerprint: 'a1b2c3',
  configured: true,
  confirmCardTemplateId: null,
  corpId: null,
  enabled: true,
  fallbacks: { confirmCardTemplateId: null, corpId: null, robotDisplayName: 'AI 助手' },
  hasClientSecret: true,
  idleNewTopicEnabled: true,
  idleNewTopicHours: 24,
  notifyAgentId: null,
  notifyAppKey: null,
  notifyAppSecretSet: false,
  notifyRobotEnabled: true,
  notifyWorkNoticeEnabled: true,
  personal: { authorizedCount: 0, brokerConfigured: true },
  personalChatEnabled: false,
  personalDataEnabled: false,
  personalDocsEnabled: false,
  personalReportEnabled: false,
  personalSheetsEnabled: false,
  personalTodoEnabled: false,
  personalWriteEnabled: false,
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
  workspaceApprovalEnabled: false,
  workspaceCalendarEnabled: false,
  workspaceTodoEnabled: false,
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

const directoryStatus = (
  overrides: Partial<AdminImConnectorDirectoryStatus> = {},
): AdminImConnectorDirectoryStatus => ({
  departments: 12,
  lastError: null,
  lastRunAt: '2026-09-16T01:00:00.000Z',
  state: 'ok',
  users: 233,
  ...overrides,
});

const notifyService = (overrides: Partial<ImConnectorNotifyAppService> = {}) =>
  ({
    directoryStatus: vi.fn().mockResolvedValue(directoryStatus()),
    syncDirectory: vi.fn().mockResolvedValue(directoryStatus()),
    testNotifyApp: vi.fn().mockResolvedValue({
      errorCode: null,
      errorMessage: null,
      latencyMs: 90,
      ok: true,
      robotName: null,
    }),
    ...overrides,
  }) as unknown as ImConnectorNotifyAppService & {
    directoryStatus: ReturnType<typeof vi.fn>;
    syncDirectory: ReturnType<typeof vi.fn>;
    testNotifyApp: ReturnType<typeof vi.fn>;
  };

beforeEach(() => {
  mocks.modules = {};
  mocks.confirmModal.mockReset();
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

  it('carries the counters into the 绑定用户 list that explains them', () => {
    render(<DingTalkConnectorCard canOperate={false} view={view()} />);

    const section = screen.getByTestId('bindings');
    expect(section.getAttribute('data-platform')).toBe('dingtalk');
    // The list stays readable without SYSTEM_OPERATE; only its write affordances go.
    expect(section.getAttribute('data-can-operate')).toBe('false');
    // …and it sits under the counters, which is the number it explains.
    const stats = screen.getByText(/systemGeneral.imConnectors.stats.linkedUsers:3/);
    expect(stats.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    // In the tag's own tooltip, not as another line in the header.
    expect(container.querySelector('[data-testid="status-details"]')?.textContent).toContain(
      'invalid client secret',
    );
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

  it('shows the fingerprint the save returned, not the one it replaced', async () => {
    const rotated = view({ clientSecretFingerprint: 'sha256:deadbeef' });
    const stub = service({ upsert: vi.fn().mockResolvedValue(rotated) });
    const { rerender } = render(<DingTalkConnectorCard canOperate service={stub} view={view()} />);

    fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.fields.clientSecret'), {
      target: { value: 'next-secret' },
    });
    fireEvent.click(screen.getByText('systemGeneral.edit.save'));

    // The note is the only way to tell WHICH credential is stored, so it has to follow the write
    // rather than wait for a list read that carries no change the card would notice.
    await waitFor(() =>
      expect(
        screen.getByText('systemGeneral.imConnectors.secret.stored:sha256:deadbeef'),
      ).toBeTruthy(),
    );
    expect(screen.queryByText('systemGeneral.imConnectors.secret.stored:a1b2c3')).toBeNull();

    // …and the list revalidation that follows leaves it alone.
    rerender(<DingTalkConnectorCard canOperate service={stub} view={rotated} />);
    expect(
      screen.getByText('systemGeneral.imConnectors.secret.stored:sha256:deadbeef'),
    ).toBeTruthy();
  });

  it('adopts a credential rotated from another session while the card is clean', () => {
    const { rerender } = render(<DingTalkConnectorCard canOperate view={view()} />);

    rerender(
      <DingTalkConnectorCard canOperate view={view({ clientSecretFingerprint: 'sha256:other' })} />,
    );

    expect(screen.getByText('systemGeneral.imConnectors.secret.stored:sha256:other')).toBeTruthy();
  });

  it('writes the row once however often 保存 is pressed', async () => {
    const stub = service();
    render(<DingTalkConnectorCard canOperate service={stub} view={view()} />);

    fireEvent.click(screen.getByLabelText('systemGeneral.imConnectors.fields.chatEnabled'));
    fireEvent.click(screen.getByText('systemGeneral.edit.save'));
    fireEvent.click(screen.getByText('systemGeneral.edit.save'));

    await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
    expect(stub.upsert).toHaveBeenCalledTimes(1);
  });

  it('keeps the save toast when only the follow-up refresh fails', async () => {
    const stub = service();
    render(
      <DingTalkConnectorCard
        canOperate
        service={stub}
        view={view()}
        onSaved={() => Promise.reject(new Error('refresh failed'))}
      />,
    );

    fireEvent.click(screen.getByLabelText('systemGeneral.imConnectors.fields.chatEnabled'));
    fireEvent.click(screen.getByText('systemGeneral.edit.save'));

    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith('systemGeneral.imConnectors.saved'),
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
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

  it('maps a failed probe onto the error copy for its code, and keeps the provider’s words', async () => {
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
    expect(screen.getByText('invalid appSecret')).toBeTruthy();
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

  it('sends the CorpId an admin typed, so 免登 works before the first message arrives', async () => {
    const stub = service();
    render(<DingTalkConnectorCard canOperate service={stub} view={view()} />);

    fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.fields.corpId'), {
      target: { value: '  ding-corp-42  ' },
    });
    fireEvent.click(screen.getByText('systemGeneral.edit.save'));

    await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
    expect(stub.upsert.mock.calls[0]![0]).toMatchObject({ corpId: 'ding-corp-42' });
  });

  it('sends a null CorpId when the field is left blank, so the worker keeps auto-capturing it', async () => {
    const stub = service();
    render(
      <DingTalkConnectorCard canOperate service={stub} view={view({ corpId: 'ding-corp' })} />,
    );

    expect(
      (screen.getByLabelText('systemGeneral.imConnectors.fields.corpId') as HTMLInputElement).value,
    ).toBe('ding-corp');

    fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.fields.corpId'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByText('systemGeneral.edit.save'));

    await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
    expect(stub.upsert.mock.calls[0]![0].corpId).toBeNull();
  });

  it('sends the AgentId an admin typed, so the workbench deep link can be built', async () => {
    const stub = service();
    render(<DingTalkConnectorCard canOperate service={stub} view={view()} />);

    fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.fields.agentId'), {
      target: { value: '  0_123456  ' },
    });
    fireEvent.click(screen.getByText('systemGeneral.edit.save'));

    await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
    expect(stub.upsert.mock.calls[0]![0]).toMatchObject({ agentId: '0_123456' });
  });

  it('sends a null AgentId when the field is blanked, so the plain SSO URL is used again', async () => {
    const stub = service();
    render(
      <DingTalkConnectorCard canOperate service={stub} view={view({ agentId: '0_123456' })} />,
    );

    expect(
      (screen.getByLabelText('systemGeneral.imConnectors.fields.agentId') as HTMLInputElement)
        .value,
    ).toBe('0_123456');

    fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.fields.agentId'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByText('systemGeneral.edit.save'));

    await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
    expect(stub.upsert.mock.calls[0]![0].agentId).toBeNull();
  });

  it('sends the 机器人名称 an admin typed beside the robot credentials', async () => {
    const stub = service();
    render(<DingTalkConnectorCard canOperate service={stub} view={view()} />);

    fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.fields.robotDisplayName'), {
      target: { value: '  AIHub 助理  ' },
    });
    fireEvent.click(screen.getByText('systemGeneral.edit.save'));

    await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
    expect(stub.upsert.mock.calls[0]![0]).toMatchObject({ robotDisplayName: 'AIHub 助理' });
  });

  it('sends a null 机器人名称 when the label is blanked', async () => {
    const stub = service();
    render(
      <DingTalkConnectorCard
        canOperate
        service={stub}
        view={view({ robotDisplayName: 'AIHub 助理' })}
      />,
    );

    const field = screen.getByLabelText('systemGeneral.imConnectors.fields.robotDisplayName');
    expect((field as HTMLInputElement).value).toBe('AIHub 助理');

    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.click(screen.getByText('systemGeneral.edit.save'));

    await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
    expect(stub.upsert.mock.calls[0]![0].robotDisplayName).toBeNull();
  });

  it('folds the API call volume into its own block at the bottom of the card', () => {
    render(<DingTalkConnectorCard canOperate view={view()} />);

    // A reading, not a setting: nothing is mounted (or requested) until the block is opened.
    expect(screen.queryByTestId('api-stats')).toBeNull();
    const toggle = screen.getByRole('button', {
      name: 'systemGeneral.imConnectors.apiStats.title',
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    const stats = screen.getByTestId('api-stats');
    const bindings = screen.getByTestId('bindings');
    // It counts every DingTalk call, not only the workbench's: last, under the bound users.
    expect(bindings.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // A frame (heartbeat/ack) is the worker's own liveness, so it is reported next to the last
  // event: an idle-but-healthy stream reads differently from a stalled one. Both live in the status
  // tag's tooltip rather than as lines of their own in the header.
  it('reports the last stream frame beside the last event, in the status tooltip', () => {
    render(
      <DingTalkConnectorCard
        canOperate
        view={view({
          status: {
            connectedAt: '2026-09-15T00:00:00.000Z',
            lastError: null,
            lastErrorAt: null,
            lastEventAt: '2026-09-15T01:00:00.000Z',
            lastFrameAt: '2026-09-15T02:00:00.000Z',
            state: 'connected',
          },
        })}
      />,
    );

    const details = screen.getByTestId('status-details');
    expect(details.textContent).toMatch(/systemGeneral.imConnectors.status.lastEventAt/);
    expect(details.textContent).toMatch(/systemGeneral.imConnectors.status.lastFrameAt/);
  });

  it('says nothing about frames when the worker never reported one', () => {
    render(<DingTalkConnectorCard canOperate view={view()} />);

    expect(screen.queryByText(/systemGeneral.imConnectors.status.lastFrameAt/)).toBeNull();
  });

  // 通知应用（服务号）— the second DingTalk app: work notifications + the contacts directory.
  describe('notification app block', () => {
    it('renders the three fields from the connector the server returned', async () => {
      render(
        <DingTalkConnectorCard
          canOperate
          notifyAppService={notifyService()}
          view={view({
            notifyAgentId: '4617854000',
            notifyAppKey: 'notify-key',
            notifyAppSecretSet: true,
          })}
        />,
      );

      expect(screen.getByText('systemGeneral.imConnectors.sections.notifyApp')).toBeTruthy();
      expect(
        (
          screen.getByLabelText(
            'systemGeneral.imConnectors.fields.notifyAppKey',
          ) as HTMLInputElement
        ).value,
      ).toBe('notify-key');
      expect(
        (
          screen.getByLabelText(
            'systemGeneral.imConnectors.fields.notifyAgentId',
          ) as HTMLInputElement
        ).value,
      ).toBe('4617854000');

      // The secret is never echoed; a stored one only says so through its placeholder — the same
      // wording as the robot's own secret.
      const secret = screen.getByLabelText(
        'systemGeneral.imConnectors.fields.notifyAppSecret',
      ) as HTMLInputElement;
      expect(secret.value).toBe('');
      expect(secret.getAttribute('placeholder')).toBe('systemGeneral.secret.storedPlaceholder');

      await waitFor(() =>
        expect(
          screen.getByText(/systemGeneral.imConnectors.notifyApp.directory.summary:12/),
        ).toBeTruthy(),
      );
    });

    it('saves the notification app through the connector’s own 保存', async () => {
      const stub = service();
      render(
        <DingTalkConnectorCard
          canOperate
          notifyAppService={notifyService()}
          service={stub}
          view={view()}
        />,
      );

      fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.fields.notifyAppKey'), {
        target: { value: '  notify-key  ' },
      });
      fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.fields.notifyAgentId'), {
        target: { value: '4617854000' },
      });
      fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.fields.notifyAppSecret'), {
        target: { value: 'notify-secret' },
      });
      fireEvent.click(screen.getByText('systemGeneral.edit.save'));

      await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
      expect(stub.upsert.mock.calls[0]![0]).toMatchObject({
        notifyAgentId: '4617854000',
        notifyAppKey: 'notify-key',
        notifyAppSecret: { action: 'replace', value: 'notify-secret' },
      });
    });

    it('omits the notification secret when the field is left blank, so a stored one survives', async () => {
      const stub = service();
      render(
        <DingTalkConnectorCard
          canOperate
          notifyAppService={notifyService()}
          service={stub}
          view={view({ notifyAppKey: 'notify-key', notifyAppSecretSet: true })}
        />,
      );

      fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.fields.notifyAppKey'), {
        target: { value: 'rotated-key' },
      });
      fireEvent.click(screen.getByText('systemGeneral.edit.save'));

      await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
      const payload = stub.upsert.mock.calls[0]![0];
      expect(payload.notifyAppKey).toBe('rotated-key');
      expect('notifyAppSecret' in payload).toBe(false);
    });

    it('saves the work-notice and service-account-robot channel switches', async () => {
      const stub = service();
      render(
        <DingTalkConnectorCard
          canOperate
          notifyAppService={notifyService()}
          service={stub}
          view={view()}
        />,
      );

      fireEvent.click(
        screen.getByLabelText('systemGeneral.imConnectors.fields.notifyWorkNoticeEnabled'),
      );
      fireEvent.click(
        screen.getByLabelText('systemGeneral.imConnectors.fields.notifyRobotEnabled'),
      );
      fireEvent.click(screen.getByText('systemGeneral.edit.save'));

      await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
      expect(stub.upsert.mock.calls[0]![0]).toMatchObject({
        notifyRobotEnabled: false,
        notifyWorkNoticeEnabled: false,
      });
    });

    it('probes the notification app credentials on their own', async () => {
      const notify = notifyService({
        testNotifyApp: vi.fn().mockResolvedValue({
          errorCode: 'auth_failed',
          errorMessage: 'invalid appSecret',
          ok: false,
        }),
      });
      render(<DingTalkConnectorCard canOperate notifyAppService={notify} view={view()} />);

      fireEvent.click(screen.getByText('systemGeneral.imConnectors.notifyApp.test'));

      await waitFor(() =>
        expect(screen.getByText('systemGeneral.imConnectors.test.errors.auth_failed')).toBeTruthy(),
      );
      expect(notify.testNotifyApp).toHaveBeenCalled();
      expect(screen.getByText('invalid appSecret')).toBeTruthy();
    });

    it('says the directory was never synced before the first pass', async () => {
      const notify = notifyService({
        directoryStatus: vi
          .fn()
          .mockResolvedValue(
            directoryStatus({ departments: 0, lastRunAt: null, state: 'idle', users: 0 }),
          ),
      });
      render(<DingTalkConnectorCard canOperate notifyAppService={notify} view={view()} />);

      await waitFor(() =>
        expect(
          screen.getByText('systemGeneral.imConnectors.notifyApp.directory.never'),
        ).toBeTruthy(),
      );
    });

    it('syncs the directory on demand and reads the new counts back', async () => {
      const notify = notifyService({
        directoryStatus: vi
          .fn()
          .mockResolvedValueOnce(
            directoryStatus({ departments: 0, lastRunAt: null, state: 'idle', users: 0 }),
          )
          .mockResolvedValue(directoryStatus({ departments: 12, users: 233 })),
      });
      render(<DingTalkConnectorCard canOperate notifyAppService={notify} view={view()} />);

      await waitFor(() =>
        expect(
          screen.getByText('systemGeneral.imConnectors.notifyApp.directory.never'),
        ).toBeTruthy(),
      );

      fireEvent.click(screen.getByText('systemGeneral.imConnectors.notifyApp.directory.sync'));

      await waitFor(() => expect(notify.syncDirectory).toHaveBeenCalledTimes(1));
      // The counters come from the status read that follows the write, not from its answer.
      await waitFor(() =>
        expect(
          screen.getByText(/systemGeneral.imConnectors.notifyApp.directory.summary:12/),
        ).toBeTruthy(),
      );
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        'systemGeneral.imConnectors.notifyApp.directory.synced',
      );
    });

    it('toasts an error when syncDirectory returns state error', async () => {
      const notify = notifyService({
        syncDirectory: vi
          .fn()
          .mockResolvedValue(directoryStatus({ lastError: 'errcode 60011', state: 'error' })),
      });
      render(<DingTalkConnectorCard canOperate notifyAppService={notify} view={view()} />);

      await waitFor(() =>
        expect(
          screen.getByText('systemGeneral.imConnectors.notifyApp.directory.sync'),
        ).toBeTruthy(),
      );

      fireEvent.click(screen.getByText('systemGeneral.imConnectors.notifyApp.directory.sync'));

      await waitFor(() => expect(notify.syncDirectory).toHaveBeenCalledTimes(1));
      expect(mocks.toastSuccess).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledWith(
        'systemGeneral.imConnectors.notifyApp.directory.error:errcode 60011',
      );
    });

    it('shows a sync that never started in its own words, not as a failed sync', async () => {
      const lastError = '同步未启动：缓存服务暂时不可用，请稍后重试';
      const notify = notifyService({
        syncDirectory: vi.fn().mockResolvedValue(directoryStatus({ lastError, state: 'error' })),
      });
      render(<DingTalkConnectorCard canOperate notifyAppService={notify} view={view()} />);

      await waitFor(() =>
        expect(
          screen.getByText('systemGeneral.imConnectors.notifyApp.directory.sync'),
        ).toBeTruthy(),
      );

      fireEvent.click(screen.getByText('systemGeneral.imConnectors.notifyApp.directory.sync'));

      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
      // No 「上次同步失败：」 wrapper and no double colon: the server sentence stands alone.
      expect(mocks.toastError).toHaveBeenCalledWith(lastError);
      expect(mocks.toastSuccess).not.toHaveBeenCalled();
      // Nothing ran, so the polled status keeps the last real run and no failure line appears.
      expect(screen.queryByText(/notifyApp\.directory\.error/)).toBeNull();
    });

    it('will not queue a second sync while one is already running', async () => {
      const notify = notifyService({
        directoryStatus: vi.fn().mockResolvedValue(directoryStatus({ state: 'running' })),
      });
      render(<DingTalkConnectorCard canOperate notifyAppService={notify} view={view()} />);

      await waitFor(() =>
        expect(
          (
            screen.getByText(
              'systemGeneral.imConnectors.notifyApp.directory.sync',
            ) as HTMLButtonElement
          ).disabled,
        ).toBe(true),
      );

      fireEvent.click(screen.getByText('systemGeneral.imConnectors.notifyApp.directory.sync'));
      expect(notify.syncDirectory).not.toHaveBeenCalled();
    });

    it('shows a load-failed line when the directory status query fails', async () => {
      const notify = notifyService({
        directoryStatus: vi.fn().mockRejectedValue(new Error('boom')),
      });
      render(<DingTalkConnectorCard canOperate notifyAppService={notify} view={view()} />);

      await waitFor(() =>
        expect(
          screen.getByText('systemGeneral.imConnectors.notifyApp.directory.loadFailed'),
        ).toBeTruthy(),
      );
    });

    it('reports a failed sync in the admin’s own words', async () => {
      const notify = notifyService({
        directoryStatus: vi
          .fn()
          .mockResolvedValue(directoryStatus({ lastError: 'errcode 60011', state: 'error' })),
      });
      render(<DingTalkConnectorCard canOperate notifyAppService={notify} view={view()} />);

      await waitFor(() =>
        expect(
          screen.getByText('systemGeneral.imConnectors.notifyApp.directory.error:errcode 60011'),
        ).toBeTruthy(),
      );
    });

    it('leaves a read-only admin the reading without the two actions', async () => {
      const notify = notifyService();
      render(<DingTalkConnectorCard canOperate={false} notifyAppService={notify} view={view()} />);

      await waitFor(() =>
        expect(
          screen.getByText(/systemGeneral.imConnectors.notifyApp.directory.summary:12/),
        ).toBeTruthy(),
      );
      expect(screen.queryByText('systemGeneral.imConnectors.notifyApp.test')).toBeNull();
      expect(screen.queryByText('systemGeneral.imConnectors.notifyApp.directory.sync')).toBeNull();
    });
  });

  // 工作台能力 — the section has its own suite; what the card owns is carrying the four fields
  // through the same 保存, and asking before a tier change reaches rules that already exist.
  describe('工作台能力 block', () => {
    const configuredNotifyApp = () =>
      view({ notifyAppKey: 'notify-key', notifyAppSecretSet: true });

    it('saves the capability switches and the tier with the rest of the row', async () => {
      const stub = service();
      render(<DingTalkConnectorCard canOperate service={stub} view={configuredNotifyApp()} />);

      fireEvent.click(screen.getByLabelText('systemGeneral.imConnectors.workspace.fields.todo'));
      fireEvent.click(screen.getByText('systemGeneral.edit.save'));

      await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
      expect(stub.upsert.mock.calls[0]![0]).toMatchObject({
        approvalAutomationTier: 'moderate',
        workspaceApprovalEnabled: false,
        workspaceCalendarEnabled: false,
        workspaceTodoEnabled: true,
      });
      expect(mocks.confirmModal).not.toHaveBeenCalled();
    });

    it('asks what a tightened tier does to existing rules before writing it', async () => {
      const stub = service();
      let onOk: (() => Promise<void>) | undefined;
      mocks.confirmModal.mockImplementation((options: { onOk: () => Promise<void> }) => {
        onOk = options.onOk;
      });
      render(<DingTalkConnectorCard canOperate service={stub} view={configuredNotifyApp()} />);

      fireEvent.click(
        screen.getByLabelText('systemGeneral.imConnectors.workspace.fields.approval'),
      );
      fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.workspace.fields.tier'), {
        target: { value: 'strict' },
      });
      fireEvent.click(screen.getByText('systemGeneral.edit.save'));

      expect(mocks.confirmModal).toHaveBeenCalledTimes(1);
      expect(mocks.confirmModal.mock.calls[0]![0].content).toBe(
        'systemGeneral.imConnectors.workspace.tierConfirm.strict',
      );
      // Nothing is written until the consequence has been accepted.
      expect(stub.upsert).not.toHaveBeenCalled();

      await onOk?.();

      await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
      expect(stub.upsert.mock.calls[0]![0]).toMatchObject({
        approvalAutomationTier: 'strict',
        workspaceApprovalEnabled: true,
      });
    });

    it('loosens the tier without a question, because nothing is taken away', async () => {
      const stub = service();
      render(<DingTalkConnectorCard canOperate service={stub} view={configuredNotifyApp()} />);

      fireEvent.click(
        screen.getByLabelText('systemGeneral.imConnectors.workspace.fields.approval'),
      );
      fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.workspace.fields.tier'), {
        target: { value: 'relaxed' },
      });
      fireEvent.click(screen.getByText('systemGeneral.edit.save'));

      await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
      expect(mocks.confirmModal).not.toHaveBeenCalled();
      expect(stub.upsert.mock.calls[0]![0]).toMatchObject({ approvalAutomationTier: 'relaxed' });
    });
  });

  // 钉钉个人数据 — the section has its own suite; the card carries its five fields through 保存.
  describe('钉钉个人数据 block', () => {
    it('saves the master switch and a scope with the rest of the row', async () => {
      const stub = service();
      render(<DingTalkConnectorCard canOperate service={stub} view={view()} />);

      fireEvent.click(screen.getByLabelText('systemGeneral.imConnectors.personal.fields.enabled'));
      fireEvent.click(screen.getByLabelText('systemGeneral.imConnectors.personal.fields.todo'));
      fireEvent.click(screen.getByText('systemGeneral.edit.save'));

      await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
      expect(stub.upsert.mock.calls[0]![0]).toMatchObject({
        personalChatEnabled: false,
        personalDataEnabled: true,
        personalReportEnabled: false,
        personalTodoEnabled: true,
        personalWriteEnabled: false,
      });
    });

    it('warns about a missing sidecar from the summary the server sent', () => {
      render(
        <DingTalkConnectorCard
          canOperate
          view={view({ personal: { authorizedCount: 4, brokerConfigured: false } })}
        />,
      );

      expect(screen.getByText('systemGeneral.imConnectors.personal.brokerMissing')).toBeTruthy();
      expect(
        screen.getByText('systemGeneral.imConnectors.personal.authorizedCount:4'),
      ).toBeTruthy();
    });
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

  // 保存 / 取消 live in a bar pinned to the bottom of the viewport, shown only while there is
  // something to save — the card is long, and the old footer sat far from the edited field.
  describe('save bar', () => {
    it('stays out of the way while nothing has changed', () => {
      render(<DingTalkConnectorCard canOperate view={view()} />);

      expect(screen.queryByText('systemGeneral.imConnectors.unsaved')).toBeNull();
      expect(screen.queryByText('systemGeneral.edit.save')).toBeNull();
      expect(screen.queryByText('systemGeneral.edit.cancel')).toBeNull();
    });

    it('appears with the first edit and leaves once it is undone', () => {
      render(<DingTalkConnectorCard canOperate view={view()} />);

      fireEvent.click(screen.getByLabelText('systemGeneral.imConnectors.fields.chatEnabled'));
      expect(screen.getByText('systemGeneral.imConnectors.unsaved')).toBeTruthy();
      expect(
        screen.getByRole('region', { name: 'systemGeneral.imConnectors.unsaved' }),
      ).toBeTruthy();

      fireEvent.click(screen.getByText('systemGeneral.edit.cancel'));
      expect(screen.queryByText('systemGeneral.imConnectors.unsaved')).toBeNull();
    });

    it('leaves once the save has landed', async () => {
      const stub = service();
      render(<DingTalkConnectorCard canOperate service={stub} view={view()} />);

      fireEvent.click(screen.getByLabelText('systemGeneral.imConnectors.fields.chatEnabled'));
      fireEvent.click(screen.getByText('systemGeneral.edit.save'));

      await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.queryByText('systemGeneral.imConnectors.unsaved')).toBeNull(),
      );
    });
  });

  // N1: 取消 returns to the newest server truth — a save's own answer while the list has not caught
  // up — never to an older list reading.
  describe('newest server reading', () => {
    it('cancels back to what the last save stored when the refresh failed', async () => {
      const answer = view({ robotCode: 'ding-robot-next', updatedAt: '2026-09-16T00:00:00.000Z' });
      const stub = service({ upsert: vi.fn().mockResolvedValue(answer) });
      render(
        <DingTalkConnectorCard
          canOperate
          service={stub}
          view={view()}
          onSaved={() => Promise.reject(new Error('refresh failed'))}
        />,
      );

      const robotCode = () =>
        screen.getByLabelText('systemGeneral.imConnectors.fields.robotCode') as HTMLInputElement;
      fireEvent.change(robotCode(), { target: { value: 'ding-robot-next' } });
      fireEvent.click(screen.getByText('systemGeneral.edit.save'));
      await waitFor(() => expect(stub.upsert).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(screen.queryByText('systemGeneral.imConnectors.unsaved')).toBeNull(),
      );

      fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.fields.clientId'), {
        target: { value: 'typo' },
      });
      fireEvent.click(screen.getByText('systemGeneral.edit.cancel'));

      // Not the pre-save list reading: that would silently revert the save on the next write.
      expect(robotCode().value).toBe('ding-robot-next');
      expect(
        (screen.getByLabelText('systemGeneral.imConnectors.fields.clientId') as HTMLInputElement)
          .value,
      ).toBe('ding-app-key');
    });

    it('keeps the save’s answer over a list reading older than it', async () => {
      const answer = view({ robotCode: 'ding-robot-next', updatedAt: '2026-09-16T00:00:00.000Z' });
      const stub = service({ upsert: vi.fn().mockResolvedValue(answer) });
      const { rerender } = render(
        <DingTalkConnectorCard canOperate service={stub} view={view()} />,
      );

      fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.fields.robotCode'), {
        target: { value: 'ding-robot-next' },
      });
      fireEvent.click(screen.getByText('systemGeneral.edit.save'));
      await waitFor(() => expect(stub.upsert).toHaveBeenCalledTimes(1));

      // A poll that was already in flight lands after the save, carrying the older row.
      rerender(
        <DingTalkConnectorCard
          canOperate
          service={stub}
          view={view({ updatedAt: '2026-09-15T00:00:00.000Z' })}
        />,
      );
      expect(
        (screen.getByLabelText('systemGeneral.imConnectors.fields.robotCode') as HTMLInputElement)
          .value,
      ).toBe('ding-robot-next');

      // A reading at least as new as the save wins again.
      rerender(
        <DingTalkConnectorCard
          canOperate
          service={stub}
          view={view({ robotCode: 'ding-robot-other', updatedAt: '2026-09-17T00:00:00.000Z' })}
        />,
      );
      await waitFor(() =>
        expect(
          (screen.getByLabelText('systemGeneral.imConnectors.fields.robotCode') as HTMLInputElement)
            .value,
        ).toBe('ding-robot-other'),
      );
    });
  });

  // Help lives behind a "?" beside the title or label, never as a paragraph inside the group.
  describe('help placement', () => {
    it('puts the section and switch explanations into tooltips', () => {
      const { container } = render(<DingTalkConnectorCard canOperate view={view()} />);

      for (const key of [
        'systemGeneral.imConnectors.hints.credentials',
        'systemGeneral.imConnectors.hints.chatEnabled',
        'systemGeneral.imConnectors.hints.idleNewTopic',
        'systemGeneral.imConnectors.hints.notifyApp',
        'systemGeneral.imConnectors.hints.pushEnabled',
        'systemGeneral.imConnectors.hints.notifyWorkNoticeEnabled',
        'systemGeneral.imConnectors.hints.notifyRobotEnabled',
        'systemGeneral.imConnectors.hints.confirmCardTemplateId',
        'systemGeneral.imConnectors.workspace.description',
        'systemGeneral.imConnectors.personal.description',
      ]) {
        expect(container.querySelector(`[data-help="${key}"]`), key).toBeTruthy();
        expect(screen.queryByText(key), key).toBeNull();
      }
      expect(
        screen.getByLabelText(
          'systemGeneral.helpFor:systemGeneral.imConnectors.sections.credentials',
        ),
      ).toBeTruthy();
    });
  });

  // Contract §1.2 — an input shows the stored value; an empty one is pre-filled from the server's
  // fallback and tagged. The pre-fill is display only: untouched, it is never sent. The robot
  // name's fallback is a placeholder only.
  describe('pre-filled fallbacks', () => {
    const withFallbacks = (overrides: Partial<AdminImConnectorView> = {}) =>
      view({
        fallbacks: {
          confirmCardTemplateId: 'env-confirm.schema',
          corpId: 'ding-captured-corp',
          robotDisplayName: 'AI 助手',
        },
        ...overrides,
      });

    it('pre-fills the captured CorpId and says where it came from', () => {
      render(<DingTalkConnectorCard canOperate view={withFallbacks()} />);

      expect(
        (screen.getByLabelText('systemGeneral.imConnectors.fields.corpId') as HTMLInputElement)
          .value,
      ).toBe('ding-captured-corp');
      expect(screen.getByText('systemGeneral.imConnectors.prefill.auto')).toBeTruthy();
      // Showing the fallback is the baseline, not an unsaved edit.
      expect(screen.queryByText('systemGeneral.imConnectors.unsaved')).toBeNull();
    });

    it('pre-fills the confirm-card template from the environment and tags it', () => {
      render(<DingTalkConnectorCard canOperate view={withFallbacks()} />);

      expect(
        (
          screen.getByLabelText(
            'systemGeneral.imConnectors.fields.confirmCardTemplateId',
          ) as HTMLInputElement
        ).value,
      ).toBe('env-confirm.schema');
      expect(screen.getByText('systemGeneral.imConnectors.prefill.env')).toBeTruthy();
    });

    it('shows the stored value, untagged, when there is one', () => {
      render(
        <DingTalkConnectorCard
          canOperate
          view={withFallbacks({ confirmCardTemplateId: 'tpl-stored', corpId: 'ding-stored' })}
        />,
      );

      expect(
        (screen.getByLabelText('systemGeneral.imConnectors.fields.corpId') as HTMLInputElement)
          .value,
      ).toBe('ding-stored');
      expect(
        (
          screen.getByLabelText(
            'systemGeneral.imConnectors.fields.confirmCardTemplateId',
          ) as HTMLInputElement
        ).value,
      ).toBe('tpl-stored');
      expect(screen.queryByText('systemGeneral.imConnectors.prefill.auto')).toBeNull();
      expect(screen.queryByText('systemGeneral.imConnectors.prefill.env')).toBeNull();
    });

    it('drops the tag once the admin edits the pre-filled value', () => {
      render(<DingTalkConnectorCard canOperate view={withFallbacks()} />);

      fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.fields.corpId'), {
        target: { value: 'ding-typed' },
      });
      expect(screen.queryByText('systemGeneral.imConnectors.prefill.auto')).toBeNull();
    });

    it('leaves untouched pre-filled values out of an unrelated save', async () => {
      const stub = service({ upsert: vi.fn().mockResolvedValue(withFallbacks()) });
      render(<DingTalkConnectorCard canOperate service={stub} view={withFallbacks()} />);

      fireEvent.click(screen.getByLabelText('systemGeneral.imConnectors.fields.chatEnabled'));
      fireEvent.click(screen.getByText('systemGeneral.edit.save'));

      await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
      const payload = stub.upsert.mock.calls[0]![0];
      // Omitted, so the row keeps storing nothing and the environment / captured id stay in force.
      expect('corpId' in payload).toBe(false);
      expect('confirmCardTemplateId' in payload).toBe(false);
      // …and the inputs still say they show a fallback.
      await waitFor(() =>
        expect(screen.queryByText('systemGeneral.imConnectors.unsaved')).toBeNull(),
      );
      expect(screen.getByText('systemGeneral.imConnectors.prefill.auto')).toBeTruthy();
      expect(screen.getByText('systemGeneral.imConnectors.prefill.env')).toBeTruthy();
    });

    it('sends a pre-filled value once the admin edits it', async () => {
      const stub = service();
      render(<DingTalkConnectorCard canOperate service={stub} view={withFallbacks()} />);

      fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.fields.corpId'), {
        target: { value: 'ding-typed' },
      });
      fireEvent.click(screen.getByText('systemGeneral.edit.save'));

      await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
      const payload = stub.upsert.mock.calls[0]![0];
      expect(payload.corpId).toBe('ding-typed');
      // The field that was not touched is still left out.
      expect('confirmCardTemplateId' in payload).toBe(false);
    });

    it('sends a clear when the admin empties a pre-filled input', async () => {
      const stub = service();
      render(<DingTalkConnectorCard canOperate service={stub} view={withFallbacks()} />);

      fireEvent.change(
        screen.getByLabelText('systemGeneral.imConnectors.fields.confirmCardTemplateId'),
        { target: { value: '' } },
      );
      fireEvent.click(screen.getByText('systemGeneral.edit.save'));

      await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
      const payload = stub.upsert.mock.calls[0]![0];
      expect('confirmCardTemplateId' in payload).toBe(true);
      expect(payload.confirmCardTemplateId).toBeNull();
    });

    it('restores the pre-filled value and its tag on 取消', () => {
      render(<DingTalkConnectorCard canOperate view={withFallbacks()} />);

      const corpId = screen.getByLabelText(
        'systemGeneral.imConnectors.fields.corpId',
      ) as HTMLInputElement;
      fireEvent.change(corpId, { target: { value: '' } });
      expect(screen.queryByText('systemGeneral.imConnectors.prefill.auto')).toBeNull();

      fireEvent.click(screen.getByText('systemGeneral.edit.cancel'));

      expect(
        (screen.getByLabelText('systemGeneral.imConnectors.fields.corpId') as HTMLInputElement)
          .value,
      ).toBe('ding-captured-corp');
      expect(screen.getByText('systemGeneral.imConnectors.prefill.auto')).toBeTruthy();
      expect(screen.queryByText('systemGeneral.imConnectors.unsaved')).toBeNull();
    });

    it('keeps saying what is in force once a pre-filled input is emptied', () => {
      render(<DingTalkConnectorCard canOperate view={withFallbacks()} />);

      const corpId = screen.getByLabelText(
        'systemGeneral.imConnectors.fields.corpId',
      ) as HTMLInputElement;
      const template = screen.getByLabelText(
        'systemGeneral.imConnectors.fields.confirmCardTemplateId',
      ) as HTMLInputElement;
      fireEvent.change(corpId, { target: { value: '' } });
      fireEvent.change(template, { target: { value: '' } });

      expect(corpId.getAttribute('placeholder')).toBe('ding-captured-corp');
      expect(template.getAttribute('placeholder')).toBe('env-confirm.schema');
    });

    it('shows the fallback again, tagged, after an emptied pre-filled input is saved', async () => {
      const stub = service({ upsert: vi.fn().mockResolvedValue(withFallbacks()) });
      render(<DingTalkConnectorCard canOperate service={stub} view={withFallbacks()} />);

      fireEvent.change(
        screen.getByLabelText('systemGeneral.imConnectors.fields.confirmCardTemplateId'),
        { target: { value: '' } },
      );
      fireEvent.click(screen.getByText('systemGeneral.edit.save'));

      await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
      // The row stores nothing, so the environment's template is what is in force — and shown.
      await waitFor(() =>
        expect(
          (
            screen.getByLabelText(
              'systemGeneral.imConnectors.fields.confirmCardTemplateId',
            ) as HTMLInputElement
          ).value,
        ).toBe('env-confirm.schema'),
      );
      expect(screen.getByText('systemGeneral.imConnectors.prefill.env')).toBeTruthy();
      expect(screen.queryByText('systemGeneral.imConnectors.unsaved')).toBeNull();
    });

    it('drops the tag as soon as a save reports the value stored, even if the refresh fails', async () => {
      // The row now stores the id (e.g. another admin saved it meanwhile); the list read that
      // would say so fails, so only the save's own answer knows.
      const stub = service({
        upsert: vi.fn().mockResolvedValue(withFallbacks({ corpId: 'ding-captured-corp' })),
      });
      render(
        <DingTalkConnectorCard
          canOperate
          service={stub}
          view={withFallbacks()}
          onSaved={() => Promise.reject(new Error('refresh failed'))}
        />,
      );
      expect(screen.getByText('systemGeneral.imConnectors.prefill.auto')).toBeTruthy();

      fireEvent.click(screen.getByLabelText('systemGeneral.imConnectors.fields.chatEnabled'));
      fireEvent.click(screen.getByText('systemGeneral.edit.save'));

      await waitFor(() =>
        expect(screen.queryByText('systemGeneral.imConnectors.prefill.auto')).toBeNull(),
      );
      // The environment id is still only a fallback, so its tag stays.
      expect(screen.getByText('systemGeneral.imConnectors.prefill.env')).toBeTruthy();
    });

    it('does not let an over-long environment id block a save', async () => {
      const stub = service();
      render(
        <DingTalkConnectorCard
          canOperate
          service={stub}
          view={withFallbacks({
            fallbacks: {
              confirmCardTemplateId: 'x'.repeat(201),
              corpId: null,
              robotDisplayName: 'AI 助手',
            },
          })}
        />,
      );

      fireEvent.click(screen.getByLabelText('systemGeneral.imConnectors.fields.chatEnabled'));
      fireEvent.click(screen.getByText('systemGeneral.edit.save'));

      await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
      expect(mocks.toastError).not.toHaveBeenCalled();
      expect('confirmCardTemplateId' in stub.upsert.mock.calls[0]![0]).toBe(false);
    });

    it('shows the fallback robot name as a placeholder, never as a value', async () => {
      const stub = service();
      render(<DingTalkConnectorCard canOperate service={stub} view={withFallbacks()} />);

      const name = screen.getByLabelText(
        'systemGeneral.imConnectors.fields.robotDisplayName',
      ) as HTMLInputElement;
      expect(name.value).toBe('');
      expect(name.getAttribute('placeholder')).toBe('AI 助手');

      fireEvent.click(screen.getByLabelText('systemGeneral.imConnectors.fields.chatEnabled'));
      fireEvent.click(screen.getByText('systemGeneral.edit.save'));

      await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
      expect(stub.upsert.mock.calls[0]![0].robotDisplayName).toBeNull();
    });

    it('round-trips a typed confirm-card template id', async () => {
      const stub = service();
      render(<DingTalkConnectorCard canOperate service={stub} view={view()} />);

      fireEvent.change(
        screen.getByLabelText('systemGeneral.imConnectors.fields.confirmCardTemplateId'),
        { target: { value: '  tpl-confirm.schema  ' } },
      );
      fireEvent.click(screen.getByText('systemGeneral.edit.save'));

      await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
      expect(stub.upsert.mock.calls[0]![0].confirmCardTemplateId).toBe('tpl-confirm.schema');
    });
  });

  // Contract §2.2 — a group whose module is not installed is not rendered at all.
  describe('module visibility', () => {
    it('shows every group while every module is on', () => {
      render(<DingTalkConnectorCard canOperate view={view()} />);

      expect(screen.getByText('systemGeneral.imConnectors.sections.credentials')).toBeTruthy();
      expect(screen.getByText('systemGeneral.imConnectors.sections.chat')).toBeTruthy();
      expect(screen.getByText('systemGeneral.imConnectors.sections.notifyApp')).toBeTruthy();
      expect(screen.getByText('systemGeneral.imConnectors.workspace.title')).toBeTruthy();
      expect(screen.getByText('systemGeneral.imConnectors.personal.title')).toBeTruthy();
      expect(screen.getByTestId('bindings')).toBeTruthy();
    });

    it('hides 机器人对话 without dingtalkChat', () => {
      mocks.modules = { dingtalkChat: false };
      render(<DingTalkConnectorCard canOperate view={view()} />);

      expect(screen.queryByText('systemGeneral.imConnectors.sections.chat')).toBeNull();
      expect(screen.queryByLabelText('systemGeneral.imConnectors.fields.chatEnabled')).toBeNull();
      expect(
        screen.queryByLabelText('systemGeneral.imConnectors.fields.confirmCardTemplateId'),
      ).toBeNull();
      // The credentials the rest depends on stay.
      expect(screen.getByLabelText('systemGeneral.imConnectors.fields.clientId')).toBeTruthy();
    });

    it('hides 通知应用 without dingtalkNotify', () => {
      mocks.modules = { dingtalkNotify: false };
      render(<DingTalkConnectorCard canOperate notifyAppService={notifyService()} view={view()} />);

      expect(screen.queryByText('systemGeneral.imConnectors.sections.notifyApp')).toBeNull();
      expect(screen.queryByLabelText('systemGeneral.imConnectors.fields.notifyAppKey')).toBeNull();
    });

    it('offers only the installed workbench capabilities', () => {
      mocks.modules = { dingtalkApproval: false };
      const { unmount } = render(<DingTalkConnectorCard canOperate view={view()} />);

      expect(
        screen.queryByLabelText('systemGeneral.imConnectors.workspace.fields.approval'),
      ).toBeNull();
      expect(
        screen.queryByLabelText('systemGeneral.imConnectors.workspace.fields.tier'),
      ).toBeNull();
      expect(
        screen.getByLabelText('systemGeneral.imConnectors.workspace.fields.todo'),
      ).toBeTruthy();
      unmount();

      mocks.modules = { dingtalkApproval: false, dingtalkWorkspace: false };
      render(<DingTalkConnectorCard canOperate view={view()} />);
      expect(screen.queryByText('systemGeneral.imConnectors.workspace.title')).toBeNull();
      // The call volume covers every DingTalk call, so it stays with the card.
      expect(screen.getByText('systemGeneral.imConnectors.apiStats.title')).toBeTruthy();
    });

    // N8: a group hidden while the card holds an edit in it neither blocks the save nor writes
    // that edit — its fields go back exactly as the server holds them.
    it('neither validates nor writes an edit left in a group that became hidden', async () => {
      const stub = service();
      const { rerender } = render(
        <DingTalkConnectorCard canOperate service={stub} view={view()} />,
      );

      fireEvent.change(
        screen.getByLabelText('systemGeneral.imConnectors.fields.idleNewTopicHours'),
        { target: { value: '0' } },
      );
      fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.fields.clientId'), {
        target: { value: 'ding-next-key' },
      });

      // 机器人对话 is switched off elsewhere; the capabilities poll hides it.
      mocks.modules = { dingtalkChat: false };
      rerender(<DingTalkConnectorCard canOperate service={stub} view={view()} />);
      fireEvent.click(screen.getByText('systemGeneral.edit.save'));

      await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(stub.upsert.mock.calls[0]![0]).toMatchObject({
        clientId: 'ding-next-key',
        idleNewTopicHours: 24,
      });
    });

    it('hides 个人数据授权 without dingtalkPersonal, and its docs scopes without dingtalkDocs', () => {
      mocks.modules = { dingtalkDocs: false };
      const { unmount } = render(<DingTalkConnectorCard canOperate view={view()} />);

      expect(screen.getByText('systemGeneral.imConnectors.personal.title')).toBeTruthy();
      expect(screen.queryByLabelText('systemGeneral.imConnectors.personal.fields.docs')).toBeNull();
      expect(
        screen.queryByLabelText('systemGeneral.imConnectors.personal.fields.sheets'),
      ).toBeNull();
      expect(screen.getByLabelText('systemGeneral.imConnectors.personal.fields.todo')).toBeTruthy();
      unmount();

      mocks.modules = { dingtalkPersonal: false };
      render(<DingTalkConnectorCard canOperate view={view()} />);
      expect(screen.queryByText('systemGeneral.imConnectors.personal.title')).toBeNull();
    });

    it('still writes the stored settings of a hidden group back unchanged', async () => {
      mocks.modules = { dingtalkChat: false, dingtalkPersonal: false };
      const stub = service();
      render(
        <DingTalkConnectorCard
          canOperate
          service={stub}
          view={view({ aiCardTemplateId: 'card-1', chatEnabled: false, personalDataEnabled: true })}
        />,
      );

      fireEvent.change(screen.getByLabelText('systemGeneral.imConnectors.fields.clientId'), {
        target: { value: 'ding-next-key' },
      });
      fireEvent.click(screen.getByText('systemGeneral.edit.save'));

      await waitFor(() => expect(stub.upsert).toHaveBeenCalled());
      expect(stub.upsert.mock.calls[0]![0]).toMatchObject({
        aiCardTemplateId: 'card-1',
        chatEnabled: false,
        clientId: 'ding-next-key',
        personalDataEnabled: true,
      });
    });
  });
});
