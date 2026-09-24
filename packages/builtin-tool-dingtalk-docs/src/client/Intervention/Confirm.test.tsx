/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import zhPlugin from '../../../../../locales/zh-CN/plugin.json';
import { DingtalkDocsApiName, DingtalkDocsWriteApiNames } from '../apiNames';
import { previewRequestKey } from '../components/ConfirmCard';
import { cardStyles } from '../components/shared';
import Confirm from './Confirm';
import { DingtalkDocsInterventions } from './index';

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

vi.mock('@/services/dingtalkDocs', () => ({
  dingtalkDocsService: { preview: (...args: unknown[]) => mocks.preview(...args) },
}));

// The shared cards come from the personal and workspace client entries; keep their own services,
// the authorize widget and the inspector styles out of this test.
vi.mock('@/services/dingtalkPersonal', () => ({ dingtalkPersonalService: {} }));
vi.mock('@/services/dingtalkWorkspace', () => ({ dingtalkWorkspaceService: {} }));
vi.mock('@/features/DingtalkPersonal/AuthorizeCard', () => ({ AuthorizeCard: () => null }));
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

const ARGS = {
  nodeId: 'node_1',
  rows: [
    ['张三', '销售部', 50_000],
    ['李四', '市场部', 42_000],
  ],
  sheetId: 'st_1',
};

const PREVIEW = {
  danger: false,
  lines: ['1. 张三 | 销售部 | 50000', '2. 李四 | 市场部 | 42000'],
  title: '向「9月」追加 2 行',
  warnings: [],
};

/**
 * Renders the card and hands back the before-approve callback the host would run, so the tests
 * assert the actual gate rather than the look of the footer.
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

describe('DingtalkDocsInterventions', () => {
  it('confirms every write API through the same card', () => {
    expect(DingtalkDocsWriteApiNames.length).toBeGreaterThan(0);
    expect(Object.keys(DingtalkDocsInterventions).sort()).toEqual(
      [...DingtalkDocsWriteApiNames].sort(),
    );
    for (const apiName of DingtalkDocsWriteApiNames)
      expect(DingtalkDocsInterventions[apiName]).toBe(Confirm);
  });

  it('has a Chinese action name for every write', () => {
    for (const apiName of DingtalkDocsWriteApiNames) {
      expect(dict[`builtins.lobe-dingtalk-docs.apiName.${apiName}`]).toBeTruthy();
    }
  });

  it('never asks to confirm a read', () => {
    const { container } = render(
      <Confirm
        apiName={DingtalkDocsApiName.readSheet}
        args={{ nodeId: 'n1' }}
        messageId={'msg_1'}
      />,
    );

    expect(container.innerHTML).toBe('');
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('renders nothing for an API outside the toolset', () => {
    const { container } = render(
      <Confirm apiName={'deleteEverything'} args={{}} messageId={'msg_1'} />,
    );

    expect(container.innerHTML).toBe('');
  });
});

describe('DingtalkDocsConfirm gate', () => {
  it('asks the server preview for exactly this call', () => {
    renderConfirm('appendSheetRows');

    expect(mocks.preview).toHaveBeenCalledWith({ apiName: 'appendSheetRows', args: ARGS });
    expect(mocks.swrKey).toEqual([
      'dingtalk-docs-preview',
      'msg_1',
      'appendSheetRows',
      JSON.stringify(ARGS),
      expect.any(Number),
    ]);
  });

  it('fetches a fresh preview for every card, never a cached or deduped one', () => {
    renderConfirm('appendSheetRows');
    renderConfirm('appendSheetRows');

    expect(mocks.swrOptions).toMatchObject({
      dedupingInterval: 0,
      keepPreviousData: false,
      revalidateOnMount: true,
    });
    // Same message and args, two mounts: two separate requests.
    expect(new Set(mocks.swrKeys.map((key) => JSON.stringify(key))).size).toBe(2);
  });

  it('rejects approval while the preview is still loading', async () => {
    const beforeApprove = renderConfirm('appendSheetRows');

    await expect(beforeApprove()).rejects.toThrow('DINGTALK_DOCS_PREVIEW_LOADING');
    expect(mocks.toastError).toHaveBeenCalledWith(
      dict['builtins.lobe-dingtalk-personal.render.confirm.approvePending'],
    );
    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });

  it('rejects approval after the preview failed, with the reason and the way out', async () => {
    mocks.error = new Error('DINGTALK_PERSONAL_EXPIRED');

    const beforeApprove = renderConfirm('createDoc', { markdown: '# 周报', title: '9 月周报' });

    await expect(beforeApprove()).rejects.toThrow('DINGTALK_DOCS_PREVIEW_ERROR');
    expect(mocks.toastError).toHaveBeenCalledWith(
      dict['builtins.lobe-dingtalk-personal.render.confirm.approveBlocked'],
    );
    expect(
      screen.getByText(dict['builtins.lobe-dingtalk-personal.render.confirm.blocked']),
    ).toBeTruthy();
    const expiredKey = 'builtins.lobe-dingtalk-personal.render.error.DINGTALK_PERSONAL_EXPIRED';
    expect(screen.getByText(dict[expiredKey])).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: dict['builtins.dingtalk.action.personalAuthorize'] })
        .getAttribute('href'),
    ).toBe('/settings/connector?dingtalkPersonal=authorize');
  });

  it('blocks a write whose names could not be resolved', async () => {
    // e.g. the sheet id does not belong to the document: the preview fails like any upstream error.
    mocks.error = new Error('DINGTALK_PERSONAL_INVALID_ARGS');

    const beforeApprove = renderConfirm('appendSheetRows');

    await expect(beforeApprove()).rejects.toThrow('DINGTALK_DOCS_PREVIEW_ERROR');
    expect(
      screen.getByText(
        dict['builtins.lobe-dingtalk-personal.render.error.DINGTALK_PERSONAL_INVALID_ARGS'],
      ),
    ).toBeTruthy();
  });

  it('says why the arguments were refused, under the generic title, and still blocks', async () => {
    // What the lambda error formatter hands the client: `cause.data` lands in `data.errorData`.
    mocks.error = Object.assign(new Error('DINGTALK_PERSONAL_INVALID_ARGS'), {
      data: {
        errorData: {
          code: 'DINGTALK_PERSONAL_INVALID_ARGS',
          details: {
            message:
              '参数无效（DINGTALK_PERSONAL_INVALID_ARGS）：内容过大（约 80 KB），请分成多次写入，每次不超过约 50 KB',
          },
        },
      },
    });

    const beforeApprove = renderConfirm('appendDoc', { markdown: '很长的正文', nodeId: 'n1' });

    await expect(beforeApprove()).rejects.toThrow('DINGTALK_DOCS_PREVIEW_ERROR');
    const alert = screen.getByRole('alert');
    expect(
      screen.getByText(
        dict['builtins.lobe-dingtalk-personal.render.error.DINGTALK_PERSONAL_INVALID_ARGS'],
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('内容过大（约 80 KB），请分成多次写入，每次不超过约 50 KB'),
    ).toBeTruthy();
    expect(alert.textContent).not.toContain('DINGTALK_');
    expect(alert.textContent).not.toContain('参数无效（');
  });

  it('caps a long refusal reason', () => {
    mocks.error = {
      data: {
        errorData: {
          code: 'DINGTALK_PERSONAL_INVALID_ARGS',
          details: { message: `参数无效（DINGTALK_PERSONAL_INVALID_ARGS）：${'字'.repeat(500)}` },
        },
      },
      message: 'DINGTALK_PERSONAL_INVALID_ARGS',
    };

    renderConfirm('createDoc', { markdown: '# 周报' });

    expect(screen.getByText(`${'字'.repeat(199)}…`)).toBeTruthy();
  });

  it('shows no service text for any other failure', () => {
    mocks.error = {
      data: {
        errorData: {
          code: 'DINGTALK_PERSONAL_EXPIRED',
          details: { message: '上游说明：token expired at node-7' },
        },
      },
      message: 'DINGTALK_PERSONAL_EXPIRED',
    };

    renderConfirm('createDoc', { markdown: '# 周报' });

    expect(screen.getByRole('alert').textContent).not.toContain('上游说明');
  });

  it('rejects approval when the cached preview belongs to other arguments', async () => {
    mocks.data = answerTo(PREVIEW, [
      'dingtalk-docs-preview',
      'msg_1',
      'appendSheetRows',
      JSON.stringify({ ...ARGS, rows: [['王五']] }),
      1,
    ]);

    const beforeApprove = renderConfirm('appendSheetRows');

    await expect(beforeApprove()).rejects.toThrow('DINGTALK_DOCS_PREVIEW_LOADING');
    expect(screen.queryByText('向「9月」追加 2 行')).toBeNull();
  });

  it('rejects approval with a stale preview from an earlier card for the same table', async () => {
    renderConfirm('appendSheetRows');
    const earlierKey = mocks.swrKey as unknown[];
    cleanup();

    mocks.data = answerTo({ ...PREVIEW, title: '向「旧表」追加 2 行' }, earlierKey);
    const beforeApprove = renderConfirm('appendSheetRows');

    await expect(beforeApprove()).rejects.toThrow('DINGTALK_DOCS_PREVIEW_LOADING');
    expect(screen.queryByText('向「旧表」追加 2 行')).toBeNull();
    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });

  it('rejects approval while this card is still re-fetching its preview', async () => {
    mocks.data = settled(PREVIEW);
    mocks.isValidating = true;

    const beforeApprove = renderConfirm('appendSheetRows');

    await expect(beforeApprove()).rejects.toThrow('DINGTALK_DOCS_PREVIEW_LOADING');
    expect(screen.queryByText('向「9月」追加 2 行')).toBeNull();
  });

  it('allows approval once the preview for these arguments succeeded', async () => {
    mocks.data = settled(PREVIEW);

    const beforeApprove = renderConfirm('appendSheetRows');

    await expect(beforeApprove()).resolves.toBeUndefined();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(screen.getByText('向「9月」追加 2 行')).toBeTruthy();
    expect(screen.getByText('1. 张三 | 销售部 | 50000')).toBeTruthy();
    expect(screen.getByText('2. 李四 | 市场部 | 42000')).toBeTruthy();
    expect(
      screen.getByText(dict['builtins.lobe-dingtalk-docs.apiName.appendSheetRows']),
    ).toBeTruthy();
  });
});

describe('DingtalkDocsConfirm card', () => {
  it('offers the raw arguments on the error path only', () => {
    mocks.error = new Error('boom');
    render(<Confirm apiName={'appendDoc'} args={{ nodeId: 'n1' }} messageId={'msg_1'} />);

    expect(
      screen.getByText(dict['builtins.lobe-dingtalk-personal.render.error.unknown']),
    ).toBeTruthy();
    const rawArgsKey = 'builtins.lobe-dingtalk-personal.render.confirm.rawArgs';
    fireEvent.click(screen.getByText(dict[rawArgsKey]));
    expect(screen.getByText(/"nodeId"/)).toBeTruthy();
    cleanup();

    mocks.error = undefined;
    mocks.data = settled(PREVIEW);
    render(<Confirm apiName={'appendDoc'} args={{ nodeId: 'n1' }} messageId={'msg_1'} />);

    expect(
      screen.queryByText(dict['builtins.lobe-dingtalk-personal.render.confirm.rawArgs']),
    ).toBeNull();
  });

  it('shows the records, the warnings and the danger accent the server asked for', () => {
    const args = {
      baseId: 'base_1',
      records: [{ cells: { fld1: '新名称' }, recordId: 'rec1' }],
      tableId: 'tbl_1',
    };
    mocks.data = settled({
      danger: true,
      lines: ['记录 rec1：名称：新名称'],
      title: '修改「客户表」中的 1 条记录',
      warnings: ['修改后无法自动撤回'],
    });

    render(<Confirm apiName={'updateAitableRecords'} args={args} messageId={'msg_1'} />);

    expect(screen.getByText('修改「客户表」中的 1 条记录')).toBeTruthy();
    expect(screen.getByText('记录 rec1：名称：新名称')).toBeTruthy();
    expect(screen.getByText('修改后无法自动撤回')).toBeTruthy();
    expect(screen.getByTestId('card').className).toContain(cardStyles.dangerCard);
  });

  it('falls back to the action name and survives a partial preview', () => {
    mocks.data = settled({ lines: 'not a list', title: '  ' });

    render(<Confirm apiName={'createAitableRecords'} args={{}} messageId={'msg_1'} />);

    expect(
      screen.getAllByText(dict['builtins.lobe-dingtalk-docs.apiName.createAitableRecords']),
    ).toHaveLength(2);
    expect(screen.getByTestId('card').className).not.toContain(cardStyles.dangerCard);
  });

  it('collapses a long preview behind "show all"', () => {
    const lines = Array.from({ length: 15 }, (_, index) => `第 ${index + 1} 行`);
    mocks.data = settled({ ...PREVIEW, lines });

    render(<Confirm apiName={'appendDoc'} args={{ nodeId: 'n1' }} messageId={'msg_1'} />);

    expect(screen.queryByText('第 13 行')).toBeNull();
    fireEvent.click(screen.getByText(/15/));
    expect(screen.getByText('第 15 行')).toBeTruthy();
  });
});

describe('DingtalkDocsConfirm approve-all readiness', () => {
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
        apiName={'appendSheetRows'}
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
