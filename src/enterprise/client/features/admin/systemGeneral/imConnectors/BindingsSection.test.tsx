// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminImConnectorBindingItem } from '@/enterprise/client/services/adminImConnectors';

import { BindingsSection } from './BindingsSection';
import type { ImConnectorBindingsService } from './service';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
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

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Alert: ({
    action,
    description,
    title,
  }: {
    action?: ReactNode;
    description?: ReactNode;
    title?: ReactNode;
  }) => (
    <div role="alert">
      <span>{title}</span>
      <span>{description}</span>
      {action}
    </div>
  ),
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
  // Only the body matters here; ok/cancel are exposed as plain buttons.
  Modal: ({
    cancelText,
    children,
    okText,
    onCancel,
    onOk,
    open,
    title,
  }: {
    cancelText?: ReactNode;
    children?: ReactNode;
    okText?: ReactNode;
    onCancel?: () => void;
    onOk?: () => void;
    open?: boolean;
    title?: ReactNode;
  }) =>
    open ? (
      <div role="dialog">
        <h2>{title}</h2>
        {children}
        <button type="button" onClick={() => onOk?.()}>
          {okText}
        </button>
        <button type="button" onClick={() => onCancel?.()}>
          {cancelText}
        </button>
      </div>
    ) : null,
  Switch: () => <button role="switch" type="button" />,
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('@/enterprise/client/providers/AdminAccessProvider', () => ({
  useAdminAccess: () => ({
    authMethod: 'better-auth',
    permissions: ['user:read'],
    status: 'allowed',
  }),
}));

vi.mock('../../primitives/UserSearchSelect', () => ({
  default: ({
    'aria-label': ariaLabel,
    id,
    onChange,
    userId,
  }: {
    'aria-label'?: string;
    'id'?: string;
    'onChange': (next?: string) => void;
    'userId'?: string;
  }) => (
    <input
      aria-label={ariaLabel}
      id={id}
      value={userId ?? ''}
      onChange={(event) => onChange(event.target.value || undefined)}
    />
  ),
}));

vi.mock('../../primitives/DangerConfirm', () => ({
  openDangerConfirm: (options: unknown) => mocks.confirm(options),
}));

// Faithful to the real runner minus the interactive reauth retry: a rejection reaches `onError`
// (which is what owns the conflict surface) and the call reports that nothing committed.
vi.mock('../../primitives/runAdminMutation', () => ({
  runAdminMutation: async ({
    mapErrorKey,
    onError,
    run,
  }: {
    mapErrorKey?: (error: unknown) => string;
    onError?: (error: unknown) => Promise<void> | void;
    run: () => Promise<void>;
  }) => {
    try {
      await run();
      return true;
    } catch (error) {
      if (onError) await onError(error);
      else mocks.toastError(mapErrorKey?.(error) ?? 'generic');
      return false;
    }
  },
}));

/** Minimal SWR stand-in: runs the real fetcher, so the injected service is exercised. */
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
        setState({ error });
      }
    }, [serialized]);

    useEffect(() => {
      void load();
    }, [load]);

    return {
      data: state.data,
      error: state.error,
      isLoading: !state.data && !state.error,
      mutate: load,
    };
  };

  return { useClientDataSWR };
});

const binding = (
  overrides: Partial<AdminImConnectorBindingItem> = {},
): AdminImConnectorBindingItem => ({
  createdAt: '2026-09-15T02:00:00.000Z',
  platformUserId: 'ding-001',
  platformUsername: '张三',
  source: 'auto',
  userEmail: 'zhangsan@example.com',
  userId: 'user-1',
  userName: '张三',
  ...overrides,
});

interface Stub extends ImConnectorBindingsService {
  listBindings: ReturnType<typeof vi.fn>;
  removeBinding: ReturnType<typeof vi.fn>;
  upsertBinding: ReturnType<typeof vi.fn>;
}

const service = (overrides: Partial<Stub> = {}): Stub =>
  ({
    listBindings: vi.fn().mockResolvedValue({ items: [binding()] }),
    removeBinding: vi.fn().mockResolvedValue({ success: true }),
    upsertBinding: vi.fn().mockResolvedValue(binding({ source: 'manual' })),
    ...overrides,
  }) as unknown as Stub;

const fillBindDraft = () => {
  fireEvent.change(
    screen.getByLabelText('systemGeneral.imConnectors.bindings.fields.user') as HTMLInputElement,
    { target: { value: 'user-9' } },
  );
  fireEvent.change(
    screen.getByLabelText(
      'systemGeneral.imConnectors.bindings.fields.platformUserId',
    ) as HTMLInputElement,
    { target: { value: '  ding-009  ' } },
  );
};

beforeEach(() => {
  mocks.confirm.mockReset();
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
});

describe('BindingsSection', () => {
  it('lists the bindings the service answers with', async () => {
    const stub = service({
      listBindings: vi.fn().mockResolvedValue({
        items: [
          binding(),
          binding({
            platformUserId: 'ding-002',
            platformUsername: null,
            source: 'manual',
            userEmail: 'admin@jiefakj.com',
            userId: 'user-2',
            userName: null,
          }),
        ],
      }),
    });
    render(<BindingsSection canOperate platform="dingtalk" service={stub} />);

    await waitFor(() => expect(screen.getByText('ding-001')).toBeTruthy());
    expect(stub.listBindings).toHaveBeenCalledWith({ platform: 'dingtalk' });
    expect(screen.getByText('zhangsan@example.com')).toBeTruthy();
    expect(screen.getByText('systemGeneral.imConnectors.bindings.source.auto')).toBeTruthy();
    expect(screen.getByText('systemGeneral.imConnectors.bindings.source.manual')).toBeTruthy();
    // No name on the second row — the email carries the identity rather than a blank cell.
    expect(screen.getByText('admin@jiefakj.com')).toBeTruthy();
  });

  it('says so when nothing is bound yet', async () => {
    const stub = service({ listBindings: vi.fn().mockResolvedValue({ items: [] }) });
    render(<BindingsSection canOperate platform="dingtalk" service={stub} />);

    await waitFor(() =>
      expect(screen.getByText('systemGeneral.imConnectors.bindings.empty')).toBeTruthy(),
    );
  });

  it('searches server-side, one request per pause rather than per keystroke', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const stub = service();
      render(<BindingsSection canOperate platform="dingtalk" service={stub} />);
      await waitFor(() => expect(stub.listBindings).toHaveBeenCalledTimes(1));

      const box = screen.getByLabelText(
        'systemGeneral.imConnectors.bindings.search',
      ) as HTMLInputElement;
      fireEvent.change(box, { target: { value: '张' } });
      fireEvent.change(box, { target: { value: '张三' } });
      expect(stub.listBindings).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(400);
      });

      await waitFor(() =>
        expect(stub.listBindings).toHaveBeenLastCalledWith({ platform: 'dingtalk', q: '张三' }),
      );
      expect(stub.listBindings).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves an admin without SYSTEM_OPERATE nothing to press', async () => {
    const stub = service();
    render(<BindingsSection canOperate={false} platform="dingtalk" service={stub} />);

    await waitFor(() => expect(screen.getByText('ding-001')).toBeTruthy());
    expect(screen.queryByText('systemGeneral.imConnectors.bindings.bind')).toBeNull();
    expect(screen.queryByText('systemGeneral.imConnectors.bindings.unbind')).toBeNull();
  });

  it('unbinds only after the confirmation, then refreshes the list and the card', async () => {
    const stub = service();
    const onChanged = vi.fn();
    render(<BindingsSection canOperate platform="dingtalk" service={stub} onChanged={onChanged} />);

    await waitFor(() => expect(screen.getByText('ding-001')).toBeTruthy());
    fireEvent.click(screen.getByText('systemGeneral.imConnectors.bindings.unbind'));

    expect(stub.removeBinding).not.toHaveBeenCalled();
    const options = mocks.confirm.mock.calls[0]![0] as {
      content: string;
      onConfirm: () => Promise<void>;
      title: string;
    };
    expect(options.title).toBe('systemGeneral.imConnectors.bindings.unbindTitle');
    expect(options.content).toContain('张三');

    await act(async () => {
      await options.onConfirm();
    });

    expect(stub.removeBinding).toHaveBeenCalledWith({ platform: 'dingtalk', userId: 'user-1' });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('systemGeneral.imConnectors.bindings.unbound');
    await waitFor(() => expect(stub.listBindings).toHaveBeenCalledTimes(2));
    expect(onChanged).toHaveBeenCalled();
  });

  it('reports a failed unbind without pretending the row is gone', async () => {
    const stub = service({ removeBinding: vi.fn().mockRejectedValue(new Error('network')) });
    render(<BindingsSection canOperate platform="dingtalk" service={stub} />);

    await waitFor(() => expect(screen.getByText('ding-001')).toBeTruthy());
    fireEvent.click(screen.getByText('systemGeneral.imConnectors.bindings.unbind'));
    const options = mocks.confirm.mock.calls[0]![0] as { onConfirm: () => Promise<void> };
    await act(async () => {
      await options.onConfirm();
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      'systemGeneral.imConnectors.bindings.unbindFailed',
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('refuses a binding the contract would reject, without spending a request', async () => {
    const stub = service();
    render(<BindingsSection canOperate platform="dingtalk" service={stub} />);

    await waitFor(() => expect(screen.getByText('ding-001')).toBeTruthy());
    fireEvent.click(screen.getByText('systemGeneral.imConnectors.bindings.bind'));
    fireEvent.click(screen.getByText('systemGeneral.imConnectors.bindings.submit'));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('systemGeneral.edit.invalidDraft'),
    );
    expect(stub.upsertBinding).not.toHaveBeenCalled();
    expect(screen.getAllByText('systemGeneral.errors.required').length).toBe(2);
  });

  it('binds the trimmed draft, then refreshes the list and closes', async () => {
    const stub = service();
    const onChanged = vi.fn();
    render(<BindingsSection canOperate platform="dingtalk" service={stub} onChanged={onChanged} />);

    await waitFor(() => expect(screen.getByText('ding-001')).toBeTruthy());
    fireEvent.click(screen.getByText('systemGeneral.imConnectors.bindings.bind'));
    fillBindDraft();
    fireEvent.click(screen.getByText('systemGeneral.imConnectors.bindings.submit'));

    await waitFor(() => expect(stub.upsertBinding).toHaveBeenCalled());
    expect(stub.upsertBinding).toHaveBeenCalledWith({
      platform: 'dingtalk',
      platformUserId: 'ding-009',
      userId: 'user-9',
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('systemGeneral.imConnectors.bindings.bound');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onChanged).toHaveBeenCalled();
    expect(stub.listBindings).toHaveBeenCalledTimes(2);
  });

  it('names the account a taken DingTalk user belongs to, and rebinds on request', async () => {
    const stub = service({
      upsertBinding: vi
        .fn()
        .mockRejectedValueOnce({
          data: {
            errorData: {
              code: 'PLATFORM_USER_ALREADY_BOUND',
              details: {
                boundUserEmail: 'other@example.com',
                boundUserId: 'user-2',
                boundUserName: '李四',
              },
            },
          },
        })
        .mockResolvedValue(binding({ source: 'manual' })),
    });
    render(<BindingsSection canOperate platform="dingtalk" service={stub} />);

    await waitFor(() => expect(screen.getByText('ding-001')).toBeTruthy());
    fireEvent.click(screen.getByText('systemGeneral.imConnectors.bindings.bind'));
    fillBindDraft();
    fireEvent.click(screen.getByText('systemGeneral.imConnectors.bindings.submit'));

    // Inline, not a toast: the admin's next move is about the OTHER account.
    await waitFor(() =>
      expect(screen.getByText('systemGeneral.imConnectors.bindings.conflict:李四')).toBeTruthy(),
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.click(screen.getByText('systemGeneral.imConnectors.bindings.rebind'));

    await waitFor(() => expect(stub.removeBinding).toHaveBeenCalled());
    // The other account's binding goes first, then this one is written again.
    expect(stub.removeBinding).toHaveBeenCalledWith({ platform: 'dingtalk', userId: 'user-2' });
    expect(stub.upsertBinding).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.toastSuccess).toHaveBeenCalledWith('systemGeneral.imConnectors.bindings.bound');
  });

  it('falls back to the generic failure copy for anything that is not a conflict', async () => {
    const stub = service({ upsertBinding: vi.fn().mockRejectedValue(new Error('network')) });
    render(<BindingsSection canOperate platform="dingtalk" service={stub} />);

    await waitFor(() => expect(screen.getByText('ding-001')).toBeTruthy());
    fireEvent.click(screen.getByText('systemGeneral.imConnectors.bindings.bind'));
    fillBindDraft();
    fireEvent.click(screen.getByText('systemGeneral.imConnectors.bindings.submit'));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        'systemGeneral.imConnectors.bindings.bindFailed',
      ),
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
