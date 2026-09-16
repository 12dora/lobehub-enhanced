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
  chatEnabled: true,
  clientId: 'ding-app-key',
  clientSecretFingerprint: 'a1b2c3',
  configured: true,
  corpId: null,
  enabled: true,
  hasClientSecret: true,
  idleNewTopicEnabled: true,
  idleNewTopicHours: 24,
  notifyAgentId: null,
  notifyAppKey: null,
  notifyAppSecretSet: false,
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
    testNotifyApp: vi
      .fn()
      .mockResolvedValue({
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

  // A frame (heartbeat/ack) is the worker's own liveness, so it is reported next to the last
  // event: an idle-but-healthy stream reads differently from a stalled one.
  it('reports the last stream frame beside the last event', () => {
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

    expect(screen.getByText(/systemGeneral.imConnectors.status.lastEventAt/)).toBeTruthy();
    expect(screen.getByText(/systemGeneral.imConnectors.status.lastFrameAt/)).toBeTruthy();
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

      // The secret is never echoed; a stored one only says so through its placeholder.
      const secret = screen.getByLabelText(
        'systemGeneral.imConnectors.fields.notifyAppSecret',
      ) as HTMLInputElement;
      expect(secret.value).toBe('');
      expect(secret.getAttribute('placeholder')).toBe(
        'systemGeneral.imConnectors.notifyApp.secretPlaceholder',
      );

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
