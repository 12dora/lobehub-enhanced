/**
 * @vitest-environment happy-dom
 */
import type { BuiltinRenderProps } from '@lobechat/types';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import zhPlugin from '../../../../../locales/zh-CN/plugin.json';
import { DingtalkWorkspaceInspectors } from '../Inspector';
import { DingtalkWorkspaceInterventions } from '../Intervention';
import { DingtalkWorkspaceRenders } from './index';
import WriteResult from './WriteResult';

const dict = zhPlugin as Record<string, string>;

/** Real zh-CN copy, so a renamed or missing key fails here instead of shipping. */
const translate = (key: string, options?: Record<string, unknown>) => {
  const raw = dict[key];
  if (raw === undefined) throw new Error(`missing zh-CN key: ${key}`);
  return raw.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
};

const zh = (key: string, options?: Record<string, unknown>) =>
  translate(`builtins.lobe-dingtalk-workspace.${key}`, options);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh-CN' }, t: translate }),
}));

vi.mock('@/services/dingtalkWorkspace', () => ({
  dingtalkWorkspaceService: { preview: vi.fn() },
}));

vi.mock('@/styles', () => ({
  inspectorTextStyles: { root: 'inspector' },
  shinyTextStyles: { shinyText: 'shiny' },
}));

vi.mock('@lobehub/ui', () => ({
  Block: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Highlighter: ({ children }: { children?: ReactNode }) => <pre>{children}</pre>,
  Icon: () => <span />,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Alert: ({ title }: { title?: ReactNode }) => <div role="alert">{title}</div>,
  Button: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
  Skeleton: () => <span />,
  SkeletonText: () => <span />,
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  toast: { error: vi.fn() },
}));

afterEach(() => cleanup());

const TODO_ID = 'task6b1f0a9c8e7d4b3a5c9e2f81d4b70a36';

const props = (
  apiName: string,
  pluginState?: unknown,
  pluginError?: unknown,
): BuiltinRenderProps<Record<string, unknown>, any> => ({
  apiName,
  args: { taskIds: ['t1', 't2', 't3'] },
  content: '',
  messageId: 'msg_1',
  pluginError,
  pluginState,
});

const batch = (overrides: Record<string, unknown> = {}) => ({
  action: 'completeTodos',
  failed: 1,
  items: [
    { id: 't1', ok: true, title: '写周报' },
    { id: 't2', ok: true, title: '交库存日报' },
    { error: '待办不存在或已删除（DINGTALK_NOT_FOUND）', id: 't3', ok: false, title: '订会议室' },
  ],
  kind: 'batchWrite',
  succeeded: 2,
  summary: '已完成 2 项待办，1 项失败',
  total: 3,
  ...overrides,
});

const statuses = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-status]')].map((row) => row.getAttribute('data-status'));

describe('batch write registration', () => {
  it.each(['completeTodos', 'deleteTodos'])('%s has a render, confirm and inspector', (api) => {
    expect(DingtalkWorkspaceRenders[api]).toBe(WriteResult);
    expect(DingtalkWorkspaceInterventions[api]).toBeDefined();
    expect(DingtalkWorkspaceInspectors[api]).toBeDefined();
  });
});

describe('WriteResult for a batch write', () => {
  it('shows the summary and one ✓ / ✗ row per todo, with the reason for a failure', () => {
    const { container } = render(<WriteResult {...props('completeTodos', batch())} />);

    expect(screen.getByText('已完成 2 项待办，1 项失败')).toBeTruthy();
    expect(statuses(container)).toEqual(['ok', 'ok', 'failed']);
    // The reason reads as plain Chinese: the trailing code is for the model.
    expect(container.querySelector('[data-status="failed"]')?.textContent).toBe(
      '订会议室待办不存在或已删除',
    );
    // Not the single-write line: the batch result speaks for itself.
    expect(container.textContent).not.toContain(zh('ui.written.completeTodo'));
  });

  it('never shows an identifier where a todo name belongs', () => {
    const { container } = render(
      <WriteResult
        {...props(
          'deleteTodos',
          batch({
            action: 'deleteTodos',
            items: [
              { id: TODO_ID, ok: true, title: TODO_ID },
              { error: '没有权限删除 staff:012345 创建的待办', id: 't2', ok: false },
            ],
            summary: '已删除 1 项待办，1 项失败',
          }),
        )}
      />,
    );
    const text = container.textContent ?? '';

    expect(screen.getAllByText(zh('ui.render.unnamed.todo'))).toHaveLength(2);
    expect(text).toContain(`没有权限删除 ${zh('ui.render.unnamed.person')} 创建的待办`);
    expect(text).not.toMatch(/task[\da-f]{32}/);
    expect(text).not.toContain('staff:');
  });

  it('keeps the rows under the mapped error when every todo failed', () => {
    const { container } = render(
      <WriteResult
        {...props(
          'completeTodos',
          batch({
            failed: 2,
            items: [
              { error: '请求过于频繁', id: 't1', ok: false, title: '写周报' },
              { error: '未执行', id: 't2', ok: false, title: '交库存日报' },
            ],
            succeeded: 0,
            summary: '2 项待办均未完成',
          }),
          { body: { code: 'DINGTALK_RATE_LIMITED' } },
        )}
      />,
    );

    expect(screen.getByRole('alert').textContent).toBe(zh('ui.error.DINGTALK_RATE_LIMITED'));
    expect(screen.getByText('2 项待办均未完成')).toBeTruthy();
    expect(screen.getByText('未执行')).toBeTruthy();
    expect(statuses(container)).toEqual(['failed', 'failed']);
  });

  it('says an unexplained failure failed and falls back to the counts without a summary', () => {
    const { container } = render(
      <WriteResult
        {...props(
          'completeTodos',
          batch({ items: [{ id: 't1', ok: false, title: '写周报' }, 'oops'], summary: '' }),
        )}
      />,
    );

    expect(screen.getByText(zh('ui.error.unknown'))).toBeTruthy();
    expect(screen.getByText(zh('ui.batch.result', { failed: 1, succeeded: 0 }))).toBeTruthy();
    expect(statuses(container)).toEqual(['failed']);
  });

  it('claims nothing for a batch call without its item list', () => {
    const { container } = render(<WriteResult {...props('deleteTodos', { success: true })} />);

    expect(container.innerHTML).toBe('');
  });

  it('still maps a batch failure that carries no item list', () => {
    render(<WriteResult {...props('deleteTodos', undefined, { message: 'DINGTALK_FORBIDDEN' })} />);

    expect(screen.getByRole('alert').textContent).toBe(zh('ui.error.DINGTALK_FORBIDDEN'));
  });
});

describe('WriteResult batch rows: codes, cleaned reasons and fix-it links', () => {
  const failedRow = (container: HTMLElement) =>
    container.querySelector('[data-status="failed"]') as HTMLElement;

  const oneFailure = (item: Record<string, unknown>) =>
    batch({
      failed: 1,
      items: [
        { id: 't1', ok: true, title: '写周报' },
        { id: 't2', ok: false, title: '订会议室', ...item },
      ],
      succeeded: 1,
      summary: '已完成 1 项待办，1 项失败',
      total: 2,
    });

  it('cleans a legacy model-facing sentence: no code, no instructions for the model', () => {
    const { container } = render(
      <WriteResult
        {...props(
          'completeTodos',
          oneFailure({
            error:
              '未找到该待办或日程（DINGTALK_NOT_FOUND）。请先 listTodos / listEvents 确认 id，且只能操作通过本工具创建的待办。',
          }),
        )}
      />,
    );
    const text = failedRow(container).textContent ?? '';

    expect(text).toBe('订会议室未找到该待办或日程。');
    expect(text).not.toContain('DINGTALK_');
    expect(text).not.toContain('listTodos');
  });

  it('drops the internal-error instruction meant for the model', () => {
    const { container } = render(
      <WriteResult
        {...props(
          'completeTodos',
          oneFailure({ error: '操作失败（内部错误），请稍后重试。不要向用户展示技术细节。' }),
        )}
      />,
    );

    expect(failedRow(container).textContent).toBe('订会议室操作失败（内部错误），请稍后重试。');
  });

  it('shows the translated message of a known code instead of the sentence', () => {
    const { container } = render(
      <WriteResult
        {...props(
          'deleteTodos',
          oneFailure({ error: '没有权限删除该待办', errorCode: 'DINGTALK_FORBIDDEN' }),
        )}
      />,
    );

    expect(failedRow(container).textContent).toBe(`订会议室${zh('ui.error.DINGTALK_FORBIDDEN')}`);
  });

  it('falls back to the cleaned sentence for an unknown code', () => {
    const { container } = render(
      <WriteResult
        {...props(
          'deleteTodos',
          oneFailure({
            error: '钉钉返回了错误（DINGTALK_WHATEVER）',
            errorCode: 'DINGTALK_WHATEVER',
          }),
        )}
      />,
    );

    expect(failedRow(container).textContent).toBe('订会议室钉钉返回了错误');
  });

  it('links the https page where the failure is fixed, with the server label', () => {
    const href = 'https://open-dev.dingtalk.com/fe/app#/corp/app/123/permission';
    const { container } = render(
      <WriteResult
        {...props(
          'completeTodos',
          oneFailure({
            actionLabel: '申请权限',
            actionUrl: href,
            error: '应用缺少待办权限',
            errorCode: 'DINGTALK_FORBIDDEN',
          }),
        )}
      />,
    );
    const link = within(failedRow(container)).getByRole('link', { name: '申请权限' });

    expect(link.getAttribute('href')).toBe(href);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(failedRow(container).textContent).toBe(
      `订会议室${zh('ui.error.DINGTALK_FORBIDDEN')} 申请权限`,
    );
  });

  it('names a link without a label with the neutral 「去处理」 copy', () => {
    const href = 'https://aihub.other-host.example/settings/connector';
    const { container } = render(
      <WriteResult
        {...props('completeTodos', oneFailure({ actionUrl: href, error: '需要授权' }))}
      />,
    );
    const link = within(failedRow(container)).getByRole('link', {
      name: translate('builtins.dingtalk.action.resolve'),
    });

    expect(link.getAttribute('href')).toBe(href);
  });

  it.each(['http://open-dev.dingtalk.com/permission', 'javascript:alert(1)', '//evil.example/x'])(
    'never links a non-https target: %s',
    (actionUrl) => {
      const { container } = render(
        <WriteResult
          {...props(
            'completeTodos',
            oneFailure({ actionLabel: '申请权限', actionUrl, error: '应用缺少待办权限' }),
          )}
        />,
      );

      expect(failedRow(container).querySelector('a')).toBeNull();
      expect(failedRow(container).textContent).toBe('订会议室应用缺少待办权限');
    },
  );

  it('keeps a skipped item as 「未执行」, whatever else it carries', () => {
    const { container } = render(
      <WriteResult
        {...props(
          'completeTodos',
          oneFailure({
            actionUrl: 'https://open-dev.dingtalk.com/permission',
            error: '未执行',
            errorCode: 'DINGTALK_FORBIDDEN',
          }),
        )}
      />,
    );

    expect(failedRow(container).textContent).toBe('订会议室未执行');
    expect(failedRow(container).querySelector('a')).toBeNull();
  });

  it('still masks identifiers in a reason that comes with a link', () => {
    const { container } = render(
      <WriteResult
        {...props(
          'deleteTodos',
          oneFailure({
            actionUrl: 'https://open-dev.dingtalk.com/permission',
            error: `执行人 staff:012345 已停用，待办 ${TODO_ID} 无法删除`,
          }),
        )}
      />,
    );
    const text = failedRow(container).textContent ?? '';

    expect(text).toContain(`执行人 ${zh('ui.render.unnamed.person')} 已停用`);
    expect(text).not.toContain('staff:');
    expect(text).not.toMatch(/task[\da-f]{32}/);
  });
});
