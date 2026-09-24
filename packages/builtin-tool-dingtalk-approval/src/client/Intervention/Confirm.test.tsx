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

vi.mock('@/services/dingtalkApproval', () => ({
  dingtalkApprovalService: { preview: (...args: unknown[]) => mocks.preview(...args) },
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

const PREVIEW = {
  actingAs: { deptPath: '公司/财务部', name: '张三' },
  lines: [{ label: '审批单', value: '李四的请假申请' }],
  title: '拒绝李四的请假申请',
  warnings: [],
};

/**
 * Renders the card and hands back the before-approve callback the host would run,
 * so the tests assert the actual gate rather than the look of the footer.
 */
const renderConfirm = (apiName: string, args: Record<string, unknown> = { taskId: 't1' }) => {
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

const settled = (preview: unknown, args: Record<string, unknown> = { taskId: 't1' }) => ({
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

describe('DingtalkApprovalConfirm gate', () => {
  it('rejects approval while the preview is still loading', async () => {
    const beforeApprove = renderConfirm('refuseTask');

    await expect(beforeApprove()).rejects.toThrow('DINGTALK_PREVIEW_LOADING');
    expect(mocks.toastError).toHaveBeenCalledWith('预览仍在加载，请等摘要出来再批准。');
    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });

  it('rejects approval after the preview failed, and says not to approve', async () => {
    mocks.error = { code: 'DINGTALK_NOT_TASK_OWNER' };

    const beforeApprove = renderConfirm('refuseTask');

    await expect(beforeApprove()).rejects.toThrow('DINGTALK_PREVIEW_ERROR');
    expect(mocks.toastError).toHaveBeenCalledWith('预览失败，已阻止本次批准。');
    expect(screen.getByText('无法预览此次操作')).toBeTruthy();
    expect(screen.getByText('该审批当前不由您处理')).toBeTruthy();
    // The hint has to name the host's real controls, never a button it does not render.
    expect(
      screen.getByText('预览失败，请勿批准。如需取消，请填写拒绝原因并点「提交」。'),
    ).toBeTruthy();
    // No page can make someone else's task yours: no link is offered.
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('links an unverified DingTalk identity to the binding page', () => {
    mocks.error = new Error('DINGTALK_IDENTITY_UNVERIFIED');

    renderConfirm('refuseTask');

    expect(screen.getByText('需使用钉钉登录后才能执行此操作')).toBeTruthy();
    expect(screen.getByRole('link', { name: '去绑定钉钉' }).getAttribute('href')).toBe(
      '/settings/messenger/dingtalk',
    );
  });

  it('rejects approval when the cached preview belongs to other arguments', async () => {
    mocks.data = settled(PREVIEW, { taskId: 'other-task' });

    const beforeApprove = renderConfirm('refuseTask', { taskId: 't1' });

    await expect(beforeApprove()).rejects.toThrow('DINGTALK_PREVIEW_LOADING');
    expect(screen.queryByText('拒绝李四的请假申请')).toBeNull();
  });

  it('allows approval once the preview for these arguments succeeded', async () => {
    mocks.data = settled(PREVIEW);

    const beforeApprove = renderConfirm('refuseTask');

    await expect(beforeApprove()).resolves.toBeUndefined();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(screen.getByText('拒绝李四的请假申请')).toBeTruthy();
    expect(screen.getByText('以 张三 的钉钉身份执行')).toBeTruthy();
    // The SWR key is args-exact, so a different payload can never reuse this preview.
    expect(mocks.swrKey).toEqual([
      'dingtalk-approval-preview',
      'refuseTask',
      JSON.stringify({ taskId: 't1' }),
    ]);
  });
});

describe('DingtalkApprovalConfirm card', () => {
  it('offers the raw arguments on the error path only', () => {
    mocks.error = new Error('boom');
    render(<Confirm apiName={'refuseTask'} args={{ taskId: 't1' }} messageId={'msg_1'} />);

    fireEvent.click(screen.getByText('查看参数'));
    expect(screen.getByText(/"taskId": "t1"/)).toBeTruthy();
    cleanup();

    mocks.error = undefined;
    mocks.data = settled(PREVIEW);
    render(<Confirm apiName={'refuseTask'} args={{ taskId: 't1' }} messageId={'msg_1'} />);

    // A successful summary says what runs in plain words; the payload would put the
    // instance ids and `staff:` tokens the rest of the UI strips back on screen.
    expect(screen.queryByText('查看参数')).toBeNull();
  });

  it('names the identity generically when the server resolved no name', () => {
    mocks.data = settled({ ...PREVIEW, actingAs: { name: '  ' } });

    render(<Confirm apiName={'refuseTask'} args={{ taskId: 't1' }} messageId={'msg_1'} />);

    expect(screen.getByText('以您绑定的钉钉身份执行')).toBeTruthy();
  });

  it('treats a rule that refuses or transfers as dangerous', () => {
    // `preview.danger` is absent, and the API name alone does not say what the rule
    // will do — the action in the arguments does.
    mocks.data = settled({ ...PREVIEW, title: '新建自动拒绝规则' }, { action: 'refuse' });

    render(<Confirm apiName={'createApprovalRule'} args={{ action: 'refuse' }} messageId={'m'} />);

    expect(screen.getByText('新建自动拒绝规则')).toBeTruthy();
    expect(screen.getByTestId('card').className).toContain(cardStyles.dangerCard);
  });

  it('keeps a rule that only approves on the plain styling', () => {
    mocks.data = settled({ ...PREVIEW, title: '新建自动同意规则' }, { action: 'agree' });

    render(<Confirm apiName={'createApprovalRule'} args={{ action: 'agree' }} messageId={'m'} />);

    expect(screen.getByTestId('card').className).not.toContain(cardStyles.dangerCard);
  });
});

describe('DingtalkApprovalConfirm approve-all readiness', () => {
  /**
   * Renders the card and records the `pending` flag of every gate registration, in
   * order: "approve all" waits while it is true, and the card re-registers when it flips.
   */
  const renderRecorded = () => {
    const flags: (boolean | undefined)[] = [];
    const registerBeforeApprove = (
      _id: string,
      _callback: () => void | Promise<void>,
      options?: { pending?: boolean },
    ) => {
      flags.push(options?.pending);
      return () => undefined;
    };
    // Fresh args object with the same content: the memoized card re-renders, the
    // preview it asks for stays the same.
    const card = () => (
      <Confirm
        apiName={'refuseTask'}
        args={{ taskId: 't1' }}
        messageId={'msg_1'}
        registerBeforeApprove={registerBeforeApprove}
      />
    );
    const view = render(card());

    return { flags, rerender: () => view.rerender(card()) };
  };

  it('reports a loading preview as pending and re-registers as ready once it arrives', () => {
    const { flags, rerender } = renderRecorded();
    expect(flags).toEqual([true]);

    mocks.data = settled(PREVIEW);
    rerender();

    expect(flags).toEqual([true, false]);
  });

  it('does not report a failed preview as pending: that is a refusal', () => {
    mocks.error = new Error('boom');

    expect(renderRecorded().flags).toEqual([false]);
  });
});
