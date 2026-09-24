/**
 * @vitest-environment happy-dom
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DingtalkPersonalLoginView,
  DingtalkPersonalStatus,
} from '@/services/dingtalkPersonal';

import zhSetting from '../../../locales/zh-CN/setting.json';
import { AuthorizeCard } from './AuthorizeCard';
import { LOGIN_POLL_INTERVAL_MS } from './useDingtalkPersonalLogin';

const dict = zhSetting as Record<string, string>;

/** Real zh-CN copy so a renamed/missing key fails here instead of shipping. */
const translate = (key: string, options?: Record<string, unknown>) => {
  const raw = dict[key];
  if (raw === undefined) throw new Error(`missing zh-CN setting key: ${key}`);
  return raw.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
};

const mocks = vi.hoisted(() => ({
  cancelLogin: vi.fn(),
  checkStatus: vi.fn(),
  confirmConfig: undefined as { onOk?: () => Promise<void> | void; title?: unknown } | undefined,
  copyToClipboard: vi.fn(),
  getLoginJob: vi.fn(),
  getStatus: vi.fn(),
  revoke: vi.fn(),
  startLogin: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: () => '' }),
  cssVar: new Proxy({}, { get: () => '' }),
}));

vi.mock('antd', () => ({
  QRCode: ({ value }: { value: string }) => <div data-testid="qr" data-value={value} />,
}));

vi.mock('@lobehub/ui', () => ({
  Block: ({ children, ...rest }: { children?: ReactNode }) => (
    <div data-testid={(rest as Record<string, string>)['data-testid']}>{children}</div>
  ),
  copyToClipboard: mocks.copyToClipboard,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    href,
    loading,
    onClick,
  }: {
    children?: ReactNode;
    href?: string;
    loading?: boolean;
    onClick?: () => void;
  }) =>
    href ? (
      <a href={href}>{children}</a>
    ) : (
      <button disabled={loading} type="button" onClick={onClick}>
        {children}
      </button>
    ),
  confirmModal: (config: { onOk?: () => Promise<void> | void; title?: unknown }) => {
    mocks.confirmConfig = config;
  },
  Tag: ({ children }: { children?: ReactNode }) => <span data-tag="">{children}</span>,
  Text: ({ children, type }: { children?: ReactNode; type?: string }) => (
    <span data-type={type}>{children}</span>
  ),
  toast: mocks.toast,
}));

vi.mock('@/services/dingtalkPersonal', () => ({
  dingtalkPersonalService: {
    cancelLogin: mocks.cancelLogin,
    checkStatus: mocks.checkStatus,
    getLoginJob: mocks.getLoginJob,
    getStatus: mocks.getStatus,
    revoke: mocks.revoke,
    startLogin: mocks.startLogin,
  },
}));

interface SwrEntry {
  data?: unknown;
  error?: unknown;
  loaded: boolean;
}

/** One cache for every card, like SWR's: a write to the status key reaches all subscribers. */
const swr = vi.hoisted(() => ({
  cache: new Map<string, SwrEntry>(),
  listeners: new Set<() => void>(),
}));

/** Minimal SWR stand-in: runs the real fetcher; `mutate()` re-runs it, `mutate(data)` sets it. */
vi.mock('@/libs/swr', async () => {
  const { useCallback, useEffect, useReducer, useRef } = await import('react');

  const write = (key: string, entry: SwrEntry) => {
    swr.cache.set(key, entry);
    for (const listener of swr.listeners) listener();
  };

  const useClientDataSWR = (key: unknown, fetcher: () => Promise<unknown>) => {
    const [, rerender] = useReducer((count: number) => count + 1, 0);
    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;
    const cacheKey = key ? JSON.stringify(key) : undefined;

    useEffect(() => {
      swr.listeners.add(rerender);
      return () => {
        swr.listeners.delete(rerender);
      };
    }, []);

    const load = useCallback(async () => {
      if (!cacheKey) return;
      try {
        const data = await fetcherRef.current();
        write(cacheKey, { data, loaded: true });
        return data;
      } catch (error) {
        write(cacheKey, { data: swr.cache.get(cacheKey)?.data, error, loaded: true });
      }
    }, [cacheKey]);

    useEffect(() => {
      void load();
    }, [load]);

    const mutate = useCallback(
      async (next?: unknown) => {
        if (next === undefined) return load();
        if (cacheKey) write(cacheKey, { data: next, loaded: true });
        return next;
      },
      [cacheKey, load],
    );

    const entry: SwrEntry = (cacheKey ? swr.cache.get(cacheKey) : undefined) ?? { loaded: false };
    return { data: entry.data, error: entry.error, isLoading: !entry.loaded, mutate };
  };

  return { useClientDataSWR };
});

/** What another card, tab or revalidation would write into the shared status. */
const pushStatus = async (status: DingtalkPersonalStatus) => {
  await act(async () => {
    for (const key of swr.cache.keys()) swr.cache.set(key, { data: status, loaded: true });
    for (const listener of swr.listeners) listener();
  });
};

const NOW = new Date('2026-09-24T08:00:00.000Z');

const job = (overrides: Partial<DingtalkPersonalLoginView> = {}): DingtalkPersonalLoginView => ({
  expiresAt: new Date(NOW.getTime() + 15 * 60_000).toISOString(),
  jobId: 'job_1',
  status: 'pending',
  userCode: 'ABCD-EFGH',
  verificationUrl: 'https://login.dingtalk.com/oauth2/device/verify.htm?user_code=ABCD-EFGH',
  ...overrides,
});

const authorized: DingtalkPersonalStatus = {
  authorizedAt: '2026-09-20T09:30:00.000Z',
  corpName: '示例科技',
  dingtalkUserName: '张三',
  features: { chat: true, report: false, todo: true, write: false },
  state: 'authorized',
};

/** Lets chained promises (fetch → setState → refetch) settle without moving the clock. */
const flush = async () => {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
};

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await flush();
};

const renderCard = async (
  props: { autoStart?: boolean; compact?: boolean; onAuthorized?: () => void } = {},
) => {
  const view = render(<AuthorizeCard {...props} />);
  await flush();
  return view;
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  swr.cache.clear();
  for (const fn of [
    mocks.cancelLogin,
    mocks.checkStatus,
    mocks.copyToClipboard,
    mocks.getLoginJob,
    mocks.getStatus,
    mocks.revoke,
    mocks.startLogin,
    mocks.toast.error,
    mocks.toast.success,
  ])
    fn.mockReset();
  mocks.confirmConfig = undefined;
  mocks.cancelLogin.mockResolvedValue({ ok: true });
  mocks.copyToClipboard.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AuthorizeCard', () => {
  it('renders nothing while the deployment has the capability off', async () => {
    mocks.getStatus.mockResolvedValue({ state: 'disabled' });
    const { container } = await renderCard();

    expect(container.innerHTML).toBe('');
  });

  it('asks for the DingTalk identity first when it is not bound', async () => {
    mocks.getStatus.mockResolvedValue({
      code: 'DINGTALK_IDENTITY_UNBOUND',
      state: 'identity_required',
    });
    await renderCard();

    expect(
      screen.getByText(dict['dingtalkPersonal.identity.DINGTALK_IDENTITY_UNBOUND']!),
    ).toBeTruthy();
    expect(screen.queryByText('授权')).toBeNull();
  });

  it('links a missing binding to the DingTalk binding page', async () => {
    mocks.getStatus.mockResolvedValue({
      code: 'DINGTALK_IDENTITY_UNVERIFIED',
      state: 'identity_required',
    });
    await renderCard();

    expect(screen.getByRole('link', { name: '去绑定钉钉' }).getAttribute('href')).toBe(
      '/settings/messenger/dingtalk',
    );
  });

  it('links a missing CorpId to the admin tab, a deactivated identity nowhere', async () => {
    mocks.getStatus.mockResolvedValue({
      code: 'DINGTALK_PERSONAL_CORP_ID_MISSING',
      state: 'identity_required',
    });
    const view = await renderCard();

    expect(
      screen.getByRole('link', { name: '管理员入口：IM 连接器设置' }).getAttribute('href'),
    ).toBe('/admin/system/general?tab=im-connectors');
    view.unmount();

    swr.cache.clear();
    mocks.getStatus.mockResolvedValue({
      code: 'DINGTALK_IDENTITY_INACTIVE',
      state: 'identity_required',
    });
    await renderCard();

    expect(
      screen.getByText(dict['dingtalkPersonal.identity.DINGTALK_IDENTITY_INACTIVE']!),
    ).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows the QR, the code, its countdown and the hint, and copies the link', async () => {
    mocks.getStatus.mockResolvedValue({ state: 'unauthorized' });
    mocks.startLogin.mockResolvedValue(job());
    mocks.getLoginJob.mockResolvedValue(job());
    await renderCard();

    fireEvent.click(screen.getByText('授权'));
    await flush();

    expect(mocks.startLogin).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('qr').dataset.value).toBe(job().verificationUrl);
    expect(screen.getByText('ABCD-EFGH')).toBeTruthy();
    expect(screen.getByText('15:00 后过期')).toBeTruthy();
    expect(screen.getByText('用手机钉钉扫码，或把链接发到钉钉里点开，选择公司后同意')).toBeTruthy();
    expect(screen.getByText('等待确认')).toBeTruthy();

    fireEvent.click(screen.getByText('复制链接'));
    await flush();
    expect(mocks.copyToClipboard).toHaveBeenCalledWith(job().verificationUrl);
    expect(mocks.toast.success).toHaveBeenCalledWith(dict['dingtalkPersonal.login.linkCopied']);

    await advance(60_000);
    expect(screen.getByText('14:00 后过期')).toBeTruthy();
  });

  it('shows only the code when the verification link is not DingTalk’s own https page', async () => {
    const bad = job({ verificationUrl: 'https://evil.example.com/verify?user_code=ABCD-EFGH' });
    mocks.getStatus.mockResolvedValue({ state: 'unauthorized' });
    mocks.startLogin.mockResolvedValue(bad);
    mocks.getLoginJob.mockResolvedValue(bad);
    await renderCard();

    fireEvent.click(screen.getByText('授权'));
    await flush();

    expect(screen.getByText('ABCD-EFGH')).toBeTruthy();
    expect(screen.getByText(dict['dingtalkPersonal.login.invalidLink']!)).toBeTruthy();
    expect(screen.queryByTestId('qr')).toBeNull();
    expect(screen.queryByText('复制链接')).toBeNull();
    expect(screen.queryByText('打开授权页')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    // Still cancellable, which brings the 授权 button back.
    expect(screen.getByText('取消')).toBeTruthy();
  });

  it('refuses a plain-http DingTalk link the same way', async () => {
    const bad = job({ verificationUrl: 'http://login.dingtalk.com/oauth2/device/verify.htm' });
    mocks.getStatus.mockResolvedValue({ state: 'unauthorized' });
    mocks.startLogin.mockResolvedValue(bad);
    mocks.getLoginJob.mockResolvedValue(bad);
    await renderCard();

    fireEvent.click(screen.getByText('授权'));
    await flush();

    expect(screen.queryByTestId('qr')).toBeNull();
    expect(screen.getByText(dict['dingtalkPersonal.login.invalidLink']!)).toBeTruthy();
  });

  it('flips to the authorized view once the poll reports success', async () => {
    const onAuthorized = vi.fn();
    mocks.getStatus.mockResolvedValueOnce({ state: 'unauthorized' }).mockResolvedValue(authorized);
    mocks.startLogin.mockResolvedValue(job());
    mocks.getLoginJob.mockResolvedValue(job({ status: 'succeeded' }));
    await renderCard({ onAuthorized });

    fireEvent.click(screen.getByText('授权'));
    await flush();
    await advance(LOGIN_POLL_INTERVAL_MS);
    await flush();

    expect(mocks.toast.success).toHaveBeenCalledWith('钉钉个人数据授权成功');
    expect(screen.getByText('已授权：张三（示例科技）')).toBeTruthy();
    expect(screen.queryByTestId('qr')).toBeNull();
    expect(onAuthorized).toHaveBeenCalledTimes(1);
  });

  it('names the wrong account on an identity mismatch and offers to start over', async () => {
    mocks.getStatus.mockResolvedValue({ state: 'unauthorized' });
    mocks.startLogin.mockResolvedValueOnce(job()).mockResolvedValueOnce(job({ jobId: 'job_2' }));
    mocks.getLoginJob.mockResolvedValueOnce(
      job({ errorCode: 'IDENTITY_MISMATCH', mismatchUserName: '李四', status: 'failed' }),
    );
    await renderCard();

    fireEvent.click(screen.getByText('授权'));
    await flush();
    await advance(LOGIN_POLL_INTERVAL_MS);

    expect(screen.getByText('你授权的是 李四 的钉钉账号，请用本人账号重新授权')).toBeTruthy();
    expect(screen.queryByTestId('qr')).toBeNull();

    fireEvent.click(screen.getByText('重新授权'));
    await flush();
    expect(mocks.startLogin).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('qr')).toBeTruthy();
  });

  it('explains an organization without CLI access', async () => {
    mocks.getStatus.mockResolvedValue({ state: 'unauthorized' });
    mocks.startLogin.mockResolvedValue(job());
    mocks.getLoginJob.mockResolvedValue(job({ errorCode: 'ORG_CLI_DISABLED', status: 'failed' }));
    await renderCard();

    fireEvent.click(screen.getByText('授权'));
    await flush();
    await advance(LOGIN_POLL_INTERVAL_MS);

    expect(
      screen.getByText('贵司钉钉未开启「允许成员通过 CLI 访问个人数据」，请联系管理员'),
    ).toBeTruthy();
    const link = screen.getByRole('link', { name: '钉钉开发者后台 → CLI 设置' });
    expect(link.getAttribute('href')).toBe(
      'https://open-dev.dingtalk.com/fe/old#/developerSettings',
    );
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('says the code expired once its clock runs out', async () => {
    mocks.getStatus.mockResolvedValue({ state: 'unauthorized' });
    mocks.startLogin.mockResolvedValue(
      job({ expiresAt: new Date(NOW.getTime() + 2000).toISOString() }),
    );
    mocks.getLoginJob.mockResolvedValue(job());
    await renderCard();

    fireEvent.click(screen.getByText('授权'));
    await flush();
    await advance(3000);

    expect(screen.getByText('验证码已过期')).toBeTruthy();
    expect(screen.getByText('重新授权')).toBeTruthy();
  });

  it('cancels only when asked, and returns to the 授权 button', async () => {
    mocks.getStatus.mockResolvedValue({ state: 'unauthorized' });
    mocks.startLogin.mockResolvedValue(job());
    mocks.getLoginJob.mockResolvedValue(job());
    const { unmount } = await renderCard();

    fireEvent.click(screen.getByText('授权'));
    await flush();
    fireEvent.click(screen.getByText('取消'));
    await flush();

    expect(mocks.cancelLogin).toHaveBeenCalledWith({ jobId: 'job_1' });
    expect(screen.queryByTestId('qr')).toBeNull();
    expect(screen.getByText('授权')).toBeTruthy();

    unmount();
    expect(mocks.cancelLogin).toHaveBeenCalledTimes(1);
  });

  it('keeps the code on screen and says so when the cancel fails', async () => {
    mocks.getStatus.mockResolvedValue({ state: 'unauthorized' });
    mocks.startLogin.mockResolvedValue(job());
    mocks.getLoginJob.mockResolvedValue(job());
    mocks.cancelLogin.mockRejectedValueOnce(new Error('fetch failed'));
    await renderCard();

    fireEvent.click(screen.getByText('授权'));
    await flush();
    fireEvent.click(screen.getByText('取消'));
    await flush();

    expect(screen.getByText('取消失败，请稍后重试')).toBeTruthy();
    expect(screen.getByTestId('qr')).toBeTruthy();
    expect(screen.queryByText('授权')).toBeNull();

    await advance(LOGIN_POLL_INTERVAL_MS);
    expect(mocks.getLoginJob).toHaveBeenCalled();
  });

  it('shows 已授权 when the cancelled job had already been approved', async () => {
    const onAuthorized = vi.fn();
    mocks.getStatus.mockResolvedValueOnce({ state: 'unauthorized' }).mockResolvedValue(authorized);
    mocks.startLogin.mockResolvedValue(job());
    mocks.getLoginJob.mockResolvedValue(job());
    await renderCard({ onAuthorized });

    fireEvent.click(screen.getByText('授权'));
    await flush();
    fireEvent.click(screen.getByText('取消'));
    await flush();

    expect(mocks.cancelLogin).toHaveBeenCalledWith({ jobId: 'job_1' });
    // The status is re-read after the cancel: the server may have finalized the approval.
    expect(mocks.getStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByText('已授权：张三（示例科技）')).toBeTruthy();
    expect(onAuthorized).toHaveBeenCalledTimes(1);
  });

  it('resumes a login the server still holds without a click', async () => {
    mocks.getStatus.mockResolvedValue({ pendingLogin: job(), state: 'unauthorized' });
    mocks.getLoginJob.mockResolvedValue(job());
    const { unmount } = await renderCard();

    expect(screen.getByTestId('qr')).toBeTruthy();
    expect(mocks.startLogin).not.toHaveBeenCalled();

    // Leaving the page is not a cancel: the server's watcher still finalizes the login.
    unmount();
    expect(mocks.cancelLogin).not.toHaveBeenCalled();
  });

  it('reports a start that the server refused', async () => {
    mocks.getStatus.mockResolvedValue({ state: 'unauthorized' });
    mocks.startLogin.mockRejectedValue(new Error('DINGTALK_PERSONAL_BROKER_UNAVAILABLE'));
    await renderCard();

    fireEvent.click(screen.getByText('授权'));
    await flush();

    expect(screen.getByText('授权服务暂时不可用，请稍后再试')).toBeTruthy();
  });

  it('links a start the admin switch refused to the IM connector tab', async () => {
    mocks.getStatus.mockResolvedValue({ state: 'unauthorized' });
    mocks.startLogin.mockRejectedValue(new Error('DINGTALK_PERSONAL_DISABLED'));
    await renderCard();

    fireEvent.click(screen.getByText('授权'));
    await flush();

    expect(screen.getByText('管理员暂未开启钉钉个人数据')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '管理员入口：IM 连接器设置' }).getAttribute('href'),
    ).toBe('/admin/system/general?tab=im-connectors');
  });

  it('shows who is authorized, since when, and what is enabled', async () => {
    mocks.getStatus.mockResolvedValue(authorized);
    await renderCard();

    expect(screen.getByText('已授权：张三（示例科技）')).toBeTruthy();
    expect(screen.getByText(/^授权时间：2026-09-/)).toBeTruthy();
    expect(screen.getByText('待办')).toBeTruthy();
    expect(screen.getByText('群聊消息')).toBeTruthy();
    expect(screen.queryByText('工作日志')).toBeNull();
    expect(screen.getByText('检查状态')).toBeTruthy();
    expect(screen.getByText('撤销授权')).toBeTruthy();
  });

  it('links the admin IM connector tab when the admin has enabled nothing yet', async () => {
    mocks.getStatus.mockResolvedValue({
      ...authorized,
      features: { chat: false, report: false, todo: false, write: false },
    });
    await renderCard();

    expect(screen.getByText('管理员暂未开放任何内容')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '管理员入口：IM 连接器设置' }).getAttribute('href'),
    ).toBe('/admin/system/general?tab=im-connectors');
  });

  it('re-checks the authorization with the sidecar', async () => {
    mocks.getStatus.mockResolvedValue(authorized);
    mocks.checkStatus.mockResolvedValue({ dingtalkUserName: '张三', state: 'expired' });
    await renderCard();

    fireEvent.click(screen.getByText('检查状态'));
    await flush();

    expect(mocks.checkStatus).toHaveBeenCalledTimes(1);
    expect(mocks.toast.error).toHaveBeenCalledWith('授权已失效，请重新授权');
    expect(screen.getByText('张三 的钉钉授权已失效，请重新授权')).toBeTruthy();
    expect(screen.getByText('重新授权')).toBeTruthy();
  });

  it('revokes after confirmation and then points at the DingTalk side', async () => {
    mocks.getStatus.mockResolvedValueOnce(authorized).mockResolvedValue({ state: 'unauthorized' });
    mocks.revoke.mockResolvedValue({ ok: true });
    await renderCard();

    fireEvent.click(screen.getByText('撤销授权'));
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.confirmConfig?.title).toBe('撤销钉钉个人数据授权？');

    await act(async () => {
      await mocks.confirmConfig?.onOk?.();
    });
    await flush();

    expect(mocks.revoke).toHaveBeenCalledTimes(1);
    expect(mocks.toast.success).toHaveBeenCalledWith('已撤销授权');
    expect(screen.getByText('授权')).toBeTruthy();
    expect(screen.getByText(dict['dingtalkPersonal.revoke.hint']!)).toBeTruthy();
  });

  it('drops 已授权 right after a revoke, even if the re-read fails', async () => {
    mocks.getStatus.mockResolvedValueOnce(authorized).mockRejectedValue(new Error('fetch failed'));
    mocks.revoke.mockResolvedValue({ ok: true });
    await renderCard();

    fireEvent.click(screen.getByText('撤销授权'));
    await act(async () => {
      await mocks.confirmConfig?.onOk?.();
    });
    await flush();

    expect(mocks.toast.success).toHaveBeenCalledWith('已撤销授权');
    expect(screen.queryByText('已授权：张三（示例科技）')).toBeNull();
    expect(screen.getByText('授权')).toBeTruthy();
  });

  it('asks to try later when the sidecar could not remove the credential', async () => {
    mocks.getStatus.mockResolvedValue(authorized);
    mocks.revoke.mockRejectedValue(new Error('DINGTALK_PERSONAL_REVOKE_FAILED'));
    await renderCard();

    fireEvent.click(screen.getByText('撤销授权'));
    await act(async () => {
      await mocks.confirmConfig?.onOk?.();
    });
    await flush();

    expect(mocks.toast.error).toHaveBeenCalledWith('撤销失败，请稍后重试');
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(screen.getByText('已授权：张三（示例科技）')).toBeTruthy();
    expect(screen.queryByText(dict['dingtalkPersonal.revoke.hint']!)).toBeNull();
  });

  it('keeps the compact (chat) variant to a confirmation, without management actions', async () => {
    mocks.getStatus.mockResolvedValue(authorized);
    await renderCard({ compact: true });

    expect(screen.getByText('已授权：张三（示例科技）')).toBeTruthy();
    expect(screen.getByText('授权已生效，可以继续提问了')).toBeTruthy();
    expect(screen.queryByText('撤销授权')).toBeNull();
    expect(screen.queryByText('检查状态')).toBeNull();
    expect(screen.queryByText(dict['dingtalkPersonal.description']!)).toBeNull();
  });

  describe('when the shared status turns authorized', () => {
    const mismatch = '你授权的是 李四 的钉钉账号，请用本人账号重新授权';

    it('replaces a stale failure, and does not bring it back after a later revoke', async () => {
      const onAuthorized = vi.fn();
      mocks.getStatus.mockResolvedValue({ state: 'unauthorized' });
      mocks.startLogin.mockResolvedValue(job());
      mocks.getLoginJob.mockResolvedValueOnce(
        job({ errorCode: 'IDENTITY_MISMATCH', mismatchUserName: '李四', status: 'failed' }),
      );
      await renderCard({ onAuthorized });

      fireEvent.click(screen.getByText('授权'));
      await flush();
      await advance(LOGIN_POLL_INTERVAL_MS);
      expect(screen.getByText(mismatch)).toBeTruthy();

      await pushStatus(authorized);
      expect(screen.getByText('已授权：张三（示例科技）')).toBeTruthy();
      expect(screen.queryByText(mismatch)).toBeNull();
      expect(onAuthorized).toHaveBeenCalledTimes(1);

      await pushStatus({ state: 'unauthorized' });
      expect(screen.getByText('授权')).toBeTruthy();
      expect(screen.queryByText(mismatch)).toBeNull();
    });

    it('drops a pending code and stops polling it', async () => {
      mocks.getStatus.mockResolvedValue({ state: 'unauthorized' });
      mocks.startLogin.mockResolvedValue(job());
      mocks.getLoginJob.mockResolvedValue(job());
      await renderCard();

      fireEvent.click(screen.getByText('授权'));
      await flush();
      expect(screen.getByTestId('qr')).toBeTruthy();

      await pushStatus(authorized);
      expect(screen.getByText('已授权：张三（示例科技）')).toBeTruthy();
      expect(screen.queryByTestId('qr')).toBeNull();
      expect(screen.queryByText('等待确认')).toBeNull();

      const calls = mocks.getLoginJob.mock.calls.length;
      await advance(LOGIN_POLL_INTERVAL_MS * 2);
      expect(mocks.getLoginJob).toHaveBeenCalledTimes(calls);
    });

    it('flips every card on the page when one of them finishes the login', async () => {
      mocks.getStatus
        .mockResolvedValueOnce({ state: 'unauthorized' })
        .mockResolvedValueOnce({ state: 'unauthorized' })
        .mockResolvedValue(authorized);
      mocks.startLogin.mockResolvedValue(job());
      mocks.getLoginJob.mockResolvedValue(job({ status: 'succeeded' }));
      render(
        <>
          <AuthorizeCard />
          <AuthorizeCard compact />
        </>,
      );
      await flush();

      fireEvent.click(screen.getAllByText('授权')[1]!);
      await flush();
      await advance(LOGIN_POLL_INTERVAL_MS);

      expect(screen.getAllByText('已授权：张三（示例科技）')).toHaveLength(2);
      expect(screen.queryByTestId('qr')).toBeNull();
    });
  });

  // The `?dingtalkPersonal=authorize` link from a tool result: QR and code without another click.
  describe('autoStart', () => {
    it('starts the login once the status says one is needed', async () => {
      mocks.getStatus.mockResolvedValue({ state: 'unauthorized' });
      mocks.startLogin.mockResolvedValue(job());
      mocks.getLoginJob.mockResolvedValue(job());
      await renderCard({ autoStart: true });

      expect(mocks.startLogin).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('qr')).toBeTruthy();
      expect(screen.getByText('ABCD-EFGH')).toBeTruthy();

      await advance(LOGIN_POLL_INTERVAL_MS * 2);
      expect(mocks.startLogin).toHaveBeenCalledTimes(1);
    });

    it('re-authorizes an expired authorization the same way', async () => {
      mocks.getStatus.mockResolvedValue({ dingtalkUserName: '张三', state: 'expired' });
      mocks.startLogin.mockResolvedValue(job());
      mocks.getLoginJob.mockResolvedValue(job());
      await renderCard({ autoStart: true });

      expect(mocks.startLogin).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('qr')).toBeTruthy();
    });

    it('only shows the authorization when the member is already authorized', async () => {
      mocks.getStatus.mockResolvedValue(authorized);
      await renderCard({ autoStart: true });

      expect(mocks.startLogin).not.toHaveBeenCalled();
      expect(screen.getByText('已授权：张三（示例科技）')).toBeTruthy();
    });

    it('resumes a pending login instead of starting another', async () => {
      mocks.getStatus.mockResolvedValue({ pendingLogin: job(), state: 'unauthorized' });
      mocks.getLoginJob.mockResolvedValue(job());
      await renderCard({ autoStart: true });

      expect(mocks.startLogin).not.toHaveBeenCalled();
      expect(screen.getByTestId('qr')).toBeTruthy();
    });

    it('does not start anything while the identity is missing', async () => {
      mocks.getStatus.mockResolvedValue({
        code: 'DINGTALK_IDENTITY_UNVERIFIED',
        state: 'identity_required',
      });
      await renderCard({ autoStart: true });

      expect(mocks.startLogin).not.toHaveBeenCalled();
    });

    it('does not hand out another code after the member cancels the auto-started one', async () => {
      mocks.getStatus.mockResolvedValue({ state: 'unauthorized' });
      mocks.startLogin.mockResolvedValue(job());
      mocks.getLoginJob.mockResolvedValue(job());
      await renderCard({ autoStart: true });

      fireEvent.click(screen.getByText('取消'));
      await flush();
      await advance(LOGIN_POLL_INTERVAL_MS);

      expect(mocks.cancelLogin).toHaveBeenCalledWith({ jobId: 'job_1' });
      expect(mocks.startLogin).toHaveBeenCalledTimes(1);
      expect(screen.getByText('授权')).toBeTruthy();
    });

    it('waits for the status before deciding', async () => {
      let resolveStatus: (value: unknown) => void = () => {};
      mocks.getStatus.mockReturnValue(
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
      );
      mocks.startLogin.mockResolvedValue(job());
      mocks.getLoginJob.mockResolvedValue(job());
      await renderCard({ autoStart: true });

      expect(mocks.startLogin).not.toHaveBeenCalled();
      expect(screen.getByText('正在读取授权状态…')).toBeTruthy();

      await act(async () => {
        resolveStatus({ state: 'unauthorized' });
      });
      await flush();

      expect(mocks.startLogin).toHaveBeenCalledTimes(1);
    });
  });
});
