/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import zhPlugin from '../../../../../locales/zh-CN/plugin.json';
import { previewRequestKey } from '../components/ConfirmCard';
import { cardStyles } from '../components/styles';
import Confirm from './Confirm';
import { DingtalkPersonalInterventions } from './index';

const dict = zhPlugin as Record<string, string>;

/** Real zh-CN copy, so a renamed or missing key fails here instead of shipping. */
const translate = (key: string, options?: Record<string, unknown>) => {
  const raw = dict[key];
  if (raw === undefined) throw new Error(`missing zh-CN key: ${key}`);
  return raw.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
};

const mocks = vi.hoisted(() => ({
  /** A payload, or a function of the SWR key that builds one. */
  data: undefined as unknown,
  error: undefined as unknown,
  isValidating: false,
  preview: vi.fn(),
  swrKey: undefined as unknown,
  swrKeys: [] as unknown[],
  swrOptions: undefined as unknown,
  toastError: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('swr', () => ({
  default: (key: readonly unknown[], fetcher: () => Promise<unknown>, options: unknown) => {
    mocks.swrKey = key;
    mocks.swrKeys.push(key);
    mocks.swrOptions = options;
    void fetcher();

    const data = typeof mocks.data === 'function' ? mocks.data(key) : mocks.data;

    return {
      data,
      error: mocks.error,
      isLoading: !data && !mocks.error,
      isValidating: mocks.isValidating,
    };
  },
}));

vi.mock('@/services/dingtalkPersonal', () => ({
  dingtalkPersonalService: { preview: (...args: unknown[]) => mocks.preview(...args) },
}));

// The shared link renderer comes from the workspace client entry; keep its own
// service and styles out of this test.
vi.mock('@/services/dingtalkWorkspace', () => ({ dingtalkWorkspaceService: {} }));

vi.mock('@/styles', () => ({
  inspectorTextStyles: { root: 'inspector' },
  shinyTextStyles: { shinyText: 'shiny' },
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

const ARGS = { taskId: '57475254077' };

const PREVIEW = {
  danger: false,
  lines: ['待办：测试待办 123', '截止时间：2026-09-25 17:00'],
  title: '完成待办「测试待办 123」',
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

  return async () => {
    await Promise.all([...callbacks.values()].map((callback) => callback()));
  };
};

/** The finished answer to whichever request the rendered card makes. */
const settled = (preview: unknown) => (key: readonly unknown[]) => ({
  preview,
  requestKey: previewRequestKey(key),
});

/** A finished answer that belongs to another request (other args, card or mount). */
const answerTo = (preview: unknown, key: readonly unknown[]) => () => ({
  preview,
  requestKey: previewRequestKey(key),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.data = undefined;
  mocks.error = undefined;
  mocks.isValidating = false;
  mocks.swrKey = undefined;
  mocks.swrKeys = [];
  mocks.swrOptions = undefined;
  mocks.preview.mockResolvedValue(PREVIEW);
});

describe('DingtalkPersonalConfirm gate', () => {
  it('asks the server preview for exactly this call', () => {
    renderConfirm('completeTodo');

    expect(mocks.preview).toHaveBeenCalledWith({ apiName: 'completeTodo', args: ARGS });
    expect(mocks.swrKey).toEqual([
      'dingtalk-personal-preview',
      'msg_1',
      'completeTodo',
      JSON.stringify(ARGS),
      expect.any(Number),
    ]);
  });

  it('fetches a fresh preview for every card, never a cached or deduped one', () => {
    renderConfirm('completeTodo');
    renderConfirm('completeTodo');

    expect(mocks.swrOptions).toMatchObject({
      dedupingInterval: 0,
      keepPreviousData: false,
      revalidateOnMount: true,
    });
    // Same message and args, two mounts: two separate requests.
    expect(new Set(mocks.swrKeys.map((key) => JSON.stringify(key))).size).toBe(2);
  });

  it('keys the preview by the intervention message', () => {
    render(<Confirm apiName={'completeTodo'} args={ARGS} messageId={'msg_a'} />);
    render(<Confirm apiName={'completeTodo'} args={ARGS} messageId={'msg_b'} />);

    const messageIds = mocks.swrKeys.map((key) => (key as unknown[])[1]);
    expect(new Set(messageIds)).toEqual(new Set(['msg_a', 'msg_b']));
  });

  it('rejects approval while the preview is still loading', async () => {
    const beforeApprove = renderConfirm('completeTodo');

    await expect(beforeApprove()).rejects.toThrow('DINGTALK_PERSONAL_PREVIEW_LOADING');
    expect(mocks.toastError).toHaveBeenCalledWith(
      dict['builtins.lobe-dingtalk-personal.render.confirm.approvePending'],
    );
    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });

  it('rejects approval after the preview failed, with the mapped reason', async () => {
    mocks.error = new Error('DINGTALK_PERSONAL_EXPIRED');

    const beforeApprove = renderConfirm('updateTodo', { taskId: '1', title: '新标题' });

    await expect(beforeApprove()).rejects.toThrow('DINGTALK_PERSONAL_PREVIEW_ERROR');
    expect(mocks.toastError).toHaveBeenCalledWith(
      dict['builtins.lobe-dingtalk-personal.render.confirm.approveBlocked'],
    );
    expect(
      screen.getByText(dict['builtins.lobe-dingtalk-personal.render.confirm.blocked']),
    ).toBeTruthy();
    const expiredKey = 'builtins.lobe-dingtalk-personal.render.error.DINGTALK_PERSONAL_EXPIRED';
    expect(screen.getByText(dict[expiredKey])).toBeTruthy();
    // The way out is one click away: the authorize deep link that starts the login by itself.
    expect(
      screen
        .getByRole('link', { name: dict['builtins.dingtalk.action.personalAuthorize'] })
        .getAttribute('href'),
    ).toBe('/settings/connector?dingtalkPersonal=authorize');
  });

  it('says why the arguments were refused, under the generic title, and still blocks', async () => {
    // What the lambda error formatter hands the client: `cause.data` lands in `data.errorData`.
    mocks.error = Object.assign(new Error('DINGTALK_PERSONAL_INVALID_ARGS'), {
      data: {
        errorData: {
          code: 'DINGTALK_PERSONAL_INVALID_ARGS',
          details: { message: '参数无效（DINGTALK_PERSONAL_INVALID_ARGS）：收件人「张三」重复' },
        },
      },
    });

    const beforeApprove = renderConfirm('updateTodo', { taskId: '1', title: '新标题' });

    await expect(beforeApprove()).rejects.toThrow('DINGTALK_PERSONAL_PREVIEW_ERROR');
    const invalidKey =
      'builtins.lobe-dingtalk-personal.render.error.DINGTALK_PERSONAL_INVALID_ARGS';
    expect(screen.getByText(dict[invalidKey])).toBeTruthy();
    expect(screen.getByText('收件人「张三」重复')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).not.toContain('DINGTALK_');
  });

  it('shows the generic title alone when the refusal carries no reason', () => {
    mocks.error = new Error('DINGTALK_PERSONAL_INVALID_ARGS');

    renderConfirm('updateTodo', { taskId: '1', title: '新标题' });

    const invalidKey =
      'builtins.lobe-dingtalk-personal.render.error.DINGTALK_PERSONAL_INVALID_ARGS';
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(
      [
        dict['builtins.lobe-dingtalk-personal.render.confirm.blocked'],
        dict[invalidKey],
        dict['builtins.lobe-dingtalk-personal.render.confirm.blockedHint'],
      ].join(''),
    );
  });

  it('shows no service text for any other failure', () => {
    mocks.error = {
      data: {
        errorData: {
          code: 'DINGTALK_PERSONAL_UPSTREAM',
          details: { message: '上游说明：token expired at node-7' },
        },
      },
      message: 'DINGTALK_PERSONAL_UPSTREAM',
    };

    renderConfirm('updateTodo', { taskId: '1', title: '新标题' });

    expect(screen.getByRole('alert').textContent).not.toContain('上游说明');
  });

  it('rejects approval when the cached preview belongs to other arguments', async () => {
    mocks.data = answerTo(PREVIEW, [
      'dingtalk-personal-preview',
      'msg_1',
      'completeTodo',
      JSON.stringify({ taskId: 'another' }),
      1,
    ]);

    const beforeApprove = renderConfirm('completeTodo');

    await expect(beforeApprove()).rejects.toThrow('DINGTALK_PERSONAL_PREVIEW_LOADING');
    expect(screen.queryByText('完成待办「测试待办 123」')).toBeNull();
  });

  it('rejects approval with a stale preview from an earlier card for the same todo', async () => {
    renderConfirm('completeTodo');
    const earlierKey = mocks.swrKey as unknown[];
    cleanup();

    // The todo was renamed since: the earlier answer must not be shown or approved.
    mocks.data = answerTo({ ...PREVIEW, title: '完成待办「旧标题」' }, earlierKey);
    const beforeApprove = renderConfirm('completeTodo');

    await expect(beforeApprove()).rejects.toThrow('DINGTALK_PERSONAL_PREVIEW_LOADING');
    expect(screen.queryByText('完成待办「旧标题」')).toBeNull();
    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });

  it('rejects approval while this card is still re-fetching its preview', async () => {
    mocks.data = settled(PREVIEW);
    mocks.isValidating = true;

    const beforeApprove = renderConfirm('completeTodo');

    await expect(beforeApprove()).rejects.toThrow('DINGTALK_PERSONAL_PREVIEW_LOADING');
    expect(screen.queryByText('完成待办「测试待办 123」')).toBeNull();
  });

  it('allows approval once the preview for these arguments succeeded', async () => {
    mocks.data = settled(PREVIEW);

    const beforeApprove = renderConfirm('completeTodo');

    await expect(beforeApprove()).resolves.toBeUndefined();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(screen.getByText('完成待办「测试待办 123」')).toBeTruthy();
    expect(screen.getByText('待办：测试待办 123')).toBeTruthy();
    expect(screen.getByText('截止时间：2026-09-25 17:00')).toBeTruthy();
  });
});

describe('DingtalkPersonalConfirm card', () => {
  it('offers the raw arguments on the error path only', () => {
    mocks.error = new Error('boom');
    render(<Confirm apiName={'completeTodo'} args={ARGS} messageId={'msg_1'} />);

    expect(
      screen.getByText(dict['builtins.lobe-dingtalk-personal.render.error.unknown']),
    ).toBeTruthy();
    const rawArgsKey = 'builtins.lobe-dingtalk-personal.render.confirm.rawArgs';
    fireEvent.click(screen.getByText(dict[rawArgsKey]));
    expect(screen.getByText(/"taskId"/)).toBeTruthy();
    cleanup();

    mocks.error = undefined;
    mocks.data = settled(PREVIEW);
    render(<Confirm apiName={'completeTodo'} args={ARGS} messageId={'msg_1'} />);

    expect(
      screen.queryByText(dict['builtins.lobe-dingtalk-personal.render.confirm.rawArgs']),
    ).toBeNull();
  });

  it('shows the warnings and the danger accent the server asked for', () => {
    const args = { contents: [], templateName: '日报', toUserIds: ['0101'] };
    mocks.data = settled({
      danger: true,
      lines: ['模板：日报', '接收人：张三'],
      title: '提交日报',
      warnings: ['提交后无法撤回'],
    });

    render(<Confirm apiName={'submitReport'} args={args} messageId={'msg_1'} />);

    expect(screen.getByText('提交后无法撤回')).toBeTruthy();
    expect(screen.getByTestId('card').className).toContain(cardStyles.dangerCard);
  });

  it('turns a markdown link in the server text into a real link', () => {
    const href = 'https://chat.example.com/settings/connector?dingtalkPersonal=authorize';
    mocks.data = settled({
      ...PREVIEW,
      warnings: [`需要先授权：[前往授权](${href})`, '[坏链接](javascript:alert(1))'],
    });

    const { container } = render(
      <Confirm apiName={'completeTodo'} args={ARGS} messageId={'msg_1'} />,
    );

    expect(screen.getByText('前往授权').closest('a')?.getAttribute('href')).toBe(href);
    expect(container.textContent).toContain('[坏链接](javascript:alert(1))');
    expect(container.querySelectorAll('a')).toHaveLength(1);
  });

  it('falls back to the action name and survives a partial preview', () => {
    mocks.data = settled({ lines: 'not a list', title: '  ' });

    render(<Confirm apiName={'completeTodo'} args={ARGS} messageId={'msg_1'} />);

    expect(
      screen.getAllByText(dict['builtins.lobe-dingtalk-personal.apiName.completeTodo']),
    ).toHaveLength(2);
    expect(screen.getByTestId('card').className).not.toContain(cardStyles.dangerCard);
  });

  it('collapses a long preview behind "show all"', () => {
    const lines = Array.from({ length: 15 }, (_, index) => `第 ${index + 1} 行`);
    mocks.data = settled({ ...PREVIEW, lines });

    render(<Confirm apiName={'completeTodo'} args={ARGS} messageId={'msg_1'} />);

    expect(screen.queryByText('第 13 行')).toBeNull();
    fireEvent.click(screen.getByText(/15/));
    expect(screen.getByText('第 15 行')).toBeTruthy();
  });

  it('renders nothing for an API outside the toolset', () => {
    const { container } = render(
      <Confirm apiName={'deleteEverything'} args={{}} messageId={'msg_1'} />,
    );

    expect(container.innerHTML).toBe('');
  });
});

describe('DingtalkPersonalConfirm batch', () => {
  const BATCH_ARGS = { taskIds: ['1001', '1002', '1003'] };
  const BATCH_PREVIEW = {
    danger: false,
    lines: ['1. 交库存日报', '2. 测试待办 123', '3. 写周报'],
    title: '完成 3 项待办',
    warnings: ['完成后这些待办会标记为已完成。'],
  };

  it('confirms completeTodos through the same card', () => {
    expect(DingtalkPersonalInterventions.completeTodos).toBe(Confirm);
  });

  it('asks the preview for the whole batch and shows one line per todo', async () => {
    mocks.data = settled(BATCH_PREVIEW);

    const beforeApprove = renderConfirm('completeTodos', BATCH_ARGS);

    expect(mocks.preview).toHaveBeenCalledWith({ apiName: 'completeTodos', args: BATCH_ARGS });
    await expect(beforeApprove()).resolves.toBeUndefined();
    expect(screen.getByText('完成 3 项待办')).toBeTruthy();
    expect(
      screen.getByText(dict['builtins.lobe-dingtalk-personal.apiName.completeTodos']),
    ).toBeTruthy();
    for (const line of BATCH_PREVIEW.lines) expect(screen.getByText(line)).toBeTruthy();
  });

  it('blocks the whole batch when one todo could not be resolved', async () => {
    mocks.error = new Error('DINGTALK_PERSONAL_UPSTREAM');

    const beforeApprove = renderConfirm('completeTodos', BATCH_ARGS);

    await expect(beforeApprove()).rejects.toThrow('DINGTALK_PERSONAL_PREVIEW_ERROR');
    expect(
      screen.getByText(dict['builtins.lobe-dingtalk-personal.render.confirm.blocked']),
    ).toBeTruthy();
  });
});

describe('DingtalkPersonalConfirm approve-all readiness', () => {
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
        apiName={'completeTodo'}
        args={{ ...ARGS }}
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

  it('stays pending while the preview is being re-fetched', () => {
    mocks.data = settled(PREVIEW);
    mocks.isValidating = true;

    expect(renderRecorded().flags).toEqual([true]);
  });
});
