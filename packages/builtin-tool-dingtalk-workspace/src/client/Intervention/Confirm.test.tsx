/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import zhPlugin from '../../../../../locales/zh-CN/plugin.json';
import { cardStyles } from '../components/styles';
import Confirm from './Confirm';

const dict = zhPlugin as Record<string, string>;

/** Real zh-CN copy, so a renamed or missing key fails here instead of shipping. */
const translate = (key: string, options?: Record<string, unknown>) => {
  const raw = dict[key];
  if (raw === undefined) throw new Error(`missing zh-CN key: ${key}`);
  return raw.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
};

const mocks = vi.hoisted(() => ({
  data: undefined as unknown,
  error: undefined as unknown,
  preview: vi.fn(),
  swrKey: undefined as unknown,
  toastError: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('swr', () => ({
  default: (key: unknown, fetcher: () => Promise<unknown>) => {
    mocks.swrKey = key;
    void fetcher();

    return { data: mocks.data, error: mocks.error, isLoading: !mocks.data && !mocks.error };
  },
}));

vi.mock('@/services/dingtalkWorkspace', () => ({
  dingtalkWorkspaceService: { preview: (...args: unknown[]) => mocks.preview(...args) },
}));

vi.mock('@lobehub/ui', () => ({
  Block: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className} data-testid="card">
      {children}
    </div>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Highlighter: ({ children }: { children?: ReactNode }) => <pre>{children}</pre>,
  Icon: () => <span />,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Alert: ({ description, title }: { description?: ReactNode; title?: ReactNode }) => (
    <div role="alert">
      <span>{title}</span>
      {description}
    </div>
  ),
  Button: ({
    children,
    className,
    onClick,
  }: {
    children?: ReactNode;
    className?: string;
    onClick?: () => void;
  }) => (
    <button className={className} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Skeleton: () => <span data-testid="skeleton" />,
  SkeletonText: () => <span data-testid="skeleton-text" />,
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  toast: { error: (...args: unknown[]) => mocks.toastError(...args) },
}));

afterEach(() => cleanup());

const ARGS = { end: '2026-09-21T10:30:00+08:00', start: '2026-09-21T09:30:00+08:00' };

const PREVIEW = {
  actingAs: { deptPath: '公司/研发部', name: '张三' },
  lines: [{ label: '时间', value: '2026-09-21 09:30 – 10:30' }],
  title: '创建「季度评审」',
  warnings: [],
};

/**
 * Renders the card and hands back the before-approve callback the host would run,
 * so the tests assert the actual gate rather than the look of the footer.
 */
const renderConfirm = (apiName: string, args: Record<string, unknown> = ARGS) => {
  const callbacks = new Map<string, () => void | Promise<void>>();
  const registerBeforeApprove = (id: string, callback: () => void | Promise<void>) => {
    callbacks.set(id, callback);
    return () => callbacks.delete(id);
  };

  render(
    <Confirm
      apiName={apiName}
      args={args}
      messageId={'msg_1'}
      registerBeforeApprove={registerBeforeApprove}
    />,
  );

  // The host awaits every registered callback before approving; rejecting is what
  // stops the write.
  return async () => {
    await Promise.all([...callbacks.values()].map((callback) => callback()));
  };
};

const settled = (preview: unknown, args: Record<string, unknown> = ARGS) => ({
  preview,
  signature: JSON.stringify(args),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.data = undefined;
  mocks.error = undefined;
  mocks.swrKey = undefined;
  mocks.preview.mockResolvedValue(PREVIEW);
});

describe('DingtalkWorkspaceConfirm gate', () => {
  it('rejects approval while the preview is still loading', async () => {
    const beforeApprove = renderConfirm('createEvent');

    await expect(beforeApprove()).rejects.toThrow('DINGTALK_PREVIEW_LOADING');
    expect(mocks.toastError).toHaveBeenCalledWith('预览仍在加载，请等摘要出来再批准。');
    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });

  it('rejects approval after the preview failed, and says not to approve', async () => {
    mocks.error = new Error('DINGTALK_FEATURE_DISABLED');

    const beforeApprove = renderConfirm('createEvent');

    await expect(beforeApprove()).rejects.toThrow('DINGTALK_PREVIEW_ERROR');
    expect(mocks.toastError).toHaveBeenCalledWith('预览失败，已阻止本次批准。');
    expect(screen.getByText('无法预览此次操作')).toBeTruthy();
    // The hint has to name the host's real controls, never a button it does not render.
    expect(
      screen.getByText('预览失败，请勿批准。如需取消，请填写拒绝原因并点「提交」。'),
    ).toBeTruthy();
    // A switched-off capability names the admin page that switches it on.
    expect(
      screen.getByRole('link', { name: '管理员入口：IM 连接器设置' }).getAttribute('href'),
    ).toBe('/admin/system/general?tab=im-connectors');
  });

  it('rejects approval when the cached preview belongs to other arguments', async () => {
    mocks.data = settled(PREVIEW, { ...ARGS, start: '2026-09-22T09:30:00+08:00' });

    const beforeApprove = renderConfirm('createEvent');

    await expect(beforeApprove()).rejects.toThrow('DINGTALK_PREVIEW_LOADING');
    expect(screen.queryByText('创建「季度评审」')).toBeNull();
  });

  it('allows approval once the preview for these arguments succeeded', async () => {
    mocks.data = settled(PREVIEW);

    const beforeApprove = renderConfirm('createEvent');

    await expect(beforeApprove()).resolves.toBeUndefined();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(screen.getByText('创建「季度评审」')).toBeTruthy();
    expect(screen.getByText('以 张三 的钉钉身份执行')).toBeTruthy();
    expect(mocks.swrKey).toEqual([
      'dingtalk-workspace-preview',
      'createEvent',
      JSON.stringify(ARGS),
    ]);
  });
});

describe('DingtalkWorkspaceConfirm card', () => {
  it('offers the raw arguments on the error path only', () => {
    mocks.error = new Error('boom');
    render(<Confirm apiName={'createEvent'} args={ARGS} messageId={'msg_1'} />);

    fireEvent.click(screen.getByText('查看参数'));
    expect(screen.getByText(/"start"/)).toBeTruthy();
    cleanup();

    mocks.error = undefined;
    mocks.data = settled(PREVIEW);
    render(<Confirm apiName={'createEvent'} args={ARGS} messageId={'msg_1'} />);

    expect(screen.queryByText('查看参数')).toBeNull();
  });

  it('names the identity generically when the server resolved no name', () => {
    mocks.data = settled({ ...PREVIEW, actingAs: { name: '  ' } });

    render(<Confirm apiName={'createEvent'} args={ARGS} messageId={'msg_1'} />);

    expect(screen.getByText('以您绑定的钉钉身份执行')).toBeTruthy();
  });

  it('keeps the danger accent for a delete', () => {
    mocks.data = settled({ ...PREVIEW, title: '删除「季度评审」' }, { eventId: 'evt_1' });

    render(<Confirm apiName={'deleteEvent'} args={{ eventId: 'evt_1' }} messageId={'msg_1'} />);

    expect(screen.getByTestId('card').className).toContain(cardStyles.dangerCard);
  });
});
