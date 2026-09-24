/**
 * @vitest-environment happy-dom
 */
import type { BuiltinRenderProps } from '@lobechat/types';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import zhPlugin from '../../../../../locales/zh-CN/plugin.json';
import { DingtalkApprovalInspectors } from '../Inspector';
import { DingtalkApprovalInterventions } from '../Intervention';
import { DingtalkApprovalRenders } from './index';
import WriteResult from './WriteResult';

const dict = zhPlugin as Record<string, string>;

/** Real zh-CN copy, so a renamed or missing key fails here instead of shipping. */
const translate = (key: string, options?: Record<string, unknown>) => {
  const raw = dict[key];
  if (raw === undefined) throw new Error(`missing zh-CN key: ${key}`);
  return raw.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
};

const zh = (key: string, options?: Record<string, unknown>) =>
  translate(`builtins.lobe-dingtalk-approval.${key}`, options);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh-CN' }, t: translate }),
}));

vi.mock('@/services/dingtalkApproval', () => ({
  dingtalkApprovalService: { preview: vi.fn() },
}));

// The shared link renderer comes from the workspace client entry; keep its own
// service out of this test.
vi.mock('@/services/dingtalkWorkspace', () => ({ dingtalkWorkspaceService: {} }));

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

const TASK_ID = '2049183091773';

const props = (
  apiName: string,
  pluginState?: unknown,
  pluginError?: unknown,
): BuiltinRenderProps<Record<string, unknown>, any> => ({
  apiName,
  args: { tasks: [{ processInstanceId: 'pi-1', taskId: TASK_ID }] },
  content: '',
  messageId: 'msg_1',
  pluginError,
  pluginState,
});

const batch = (overrides: Record<string, unknown> = {}) => ({
  action: 'approveTasks',
  failed: 1,
  items: [
    { id: TASK_ID, ok: true, title: '张三提交的请假' },
    { id: '2049183091774', ok: true, title: '李四提交的报销' },
    { error: '该审批已被他人处理（DINGTALK_NOT_TASK_OWNER）', id: '2049183091775', ok: false },
  ],
  kind: 'batchWrite',
  succeeded: 2,
  summary: '已同意 2 项审批，1 项失败',
  total: 3,
  ...overrides,
});

const statuses = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-status]')].map((row) => row.getAttribute('data-status'));

describe('batch write registration', () => {
  it.each(['approveTasks', 'refuseTasks'])('%s has a render, confirm and inspector', (api) => {
    expect(DingtalkApprovalRenders[api]).toBe(WriteResult);
    expect(DingtalkApprovalInterventions[api]).toBeDefined();
    expect(DingtalkApprovalInspectors[api]).toBeDefined();
  });
});

describe('WriteResult for a batch write', () => {
  it('shows the summary and one ✓ / ✗ row per approval, with the reason for a failure', () => {
    const { container } = render(<WriteResult {...props('approveTasks', batch())} />);
    const text = container.textContent ?? '';

    expect(screen.getByText('已同意 2 项审批，1 项失败')).toBeTruthy();
    expect(statuses(container)).toEqual(['ok', 'ok', 'failed']);
    expect(screen.getByText('张三提交的请假')).toBeTruthy();
    // An approval without a title reads as a neutral noun, and the trailing code is
    // for the model.
    expect(container.querySelector('[data-status="failed"]')?.textContent).toBe(
      `${zh('ui.render.unnamed.item')}该审批已被他人处理`,
    );
    expect(text).not.toContain(TASK_ID);
    // Not the single-write line: the batch result speaks for itself.
    expect(text).not.toContain(zh('ui.written.approveTask'));
  });

  it('keeps the rows under the mapped error when every approval failed', () => {
    const { container } = render(
      <WriteResult
        {...props(
          'refuseTasks',
          batch({
            action: 'refuseTasks',
            failed: 2,
            items: [
              { error: '请求过于频繁', id: TASK_ID, ok: false, title: '张三提交的请假' },
              { error: '未执行', id: '2049183091774', ok: false, title: '李四提交的报销' },
            ],
            succeeded: 0,
            summary: '2 项审批均未拒绝',
          }),
          { body: { code: 'DINGTALK_RATE_LIMITED' } },
        )}
      />,
    );

    expect(screen.getByRole('alert').textContent).toBe(zh('ui.error.DINGTALK_RATE_LIMITED'));
    expect(screen.getByText('2 项审批均未拒绝')).toBeTruthy();
    expect(screen.getByText('未执行')).toBeTruthy();
    expect(statuses(container)).toEqual(['failed', 'failed']);
  });

  it('says an unexplained failure failed and falls back to the counts without a summary', () => {
    const { container } = render(
      <WriteResult
        {...props(
          'approveTasks',
          batch({ items: [{ id: TASK_ID, ok: false, title: '张三提交的请假' }, 7], summary: '' }),
        )}
      />,
    );

    expect(screen.getByText(zh('ui.error.unknown'))).toBeTruthy();
    expect(screen.getByText(zh('ui.batch.result', { failed: 1, succeeded: 0 }))).toBeTruthy();
    expect(statuses(container)).toEqual(['failed']);
  });

  it('turns a permission link in a failure reason into a link instead of raw markdown', () => {
    const href = 'https://open-dev.dingtalk.com/fe/app#/corp/app/123/permission';
    const { container } = render(
      <WriteResult
        {...props(
          'approveTasks',
          batch({
            failed: 1,
            items: [
              { id: TASK_ID, ok: true, title: '张三提交的请假' },
              {
                error: `应用缺少审批权限，请 [申请权限](${href})（DINGTALK_FORBIDDEN）`,
                id: '2049183091775',
                ok: false,
                title: '李四提交的报销',
              },
            ],
            succeeded: 1,
            summary: '已同意 1 项审批，1 项失败',
            total: 2,
          }),
        )}
      />,
    );
    const failed = container.querySelector('[data-status="failed"]') as HTMLElement;
    const link = within(failed).getByRole('link', { name: '申请权限' });

    expect(link.getAttribute('href')).toBe(href);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(failed.textContent).toBe('李四提交的报销应用缺少审批权限，请 申请权限');
    expect(failed.textContent).not.toContain('](');
  });

  it('keeps an in-app link in the app and still masks identifiers around it', () => {
    const { container } = render(
      <WriteResult
        {...props(
          'refuseTasks',
          batch({
            action: 'refuseTasks',
            failed: 1,
            items: [
              {
                error: '已转交给 staff:012345 处理，请先[去授权](/settings/connector)',
                id: TASK_ID,
                ok: false,
                title: '张三提交的请假',
              },
            ],
            succeeded: 0,
            summary: '1 项审批未拒绝',
            total: 1,
          }),
        )}
      />,
    );
    const failed = container.querySelector('[data-status="failed"]') as HTMLElement;
    const link = within(failed).getByRole('link', { name: '去授权' });

    expect(link.getAttribute('href')).toBe('/settings/connector');
    expect(link.getAttribute('target')).toBeNull();
    expect(failed.textContent).toBe(
      `张三提交的请假已转交给 ${zh('ui.render.unnamed.person')} 处理，请先去授权`,
    );
    expect(failed.textContent).not.toContain('staff:');
  });

  it('shows an unsafe link target as plain text', () => {
    const { container } = render(
      <WriteResult
        {...props(
          'approveTasks',
          batch({
            items: [
              {
                error: '请 [申请权限](javascript:alert(1))',
                id: TASK_ID,
                ok: false,
                title: '张三',
              },
            ],
            summary: '',
          }),
        )}
      />,
    );
    const failed = container.querySelector('[data-status="failed"]') as HTMLElement;

    expect(failed.querySelector('a')).toBeNull();
    expect(failed.textContent).toContain('[申请权限](javascript:alert(1))');
  });

  it('claims nothing for a batch call without its item list', () => {
    const { container } = render(<WriteResult {...props('approveTasks', { success: true })} />);

    expect(container.innerHTML).toBe('');
  });

  it('still maps a batch failure that carries no item list', () => {
    render(<WriteResult {...props('refuseTasks', undefined, { message: 'DINGTALK_FORBIDDEN' })} />);

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
        { id: TASK_ID, ok: true, title: '张三提交的请假' },
        { id: '2049183091775', ok: false, title: '李四提交的报销', ...item },
      ],
      succeeded: 1,
      summary: '已同意 1 项审批，1 项失败',
      total: 2,
    });

  it('cleans a legacy model-facing sentence: no code, no instructions for the model', () => {
    const { container } = render(
      <WriteResult
        {...props(
          'approveTasks',
          oneFailure({
            error:
              '钉钉服务暂时不可用（DINGTALK_UNAVAILABLE），请稍后重试。不要向用户展示技术细节。',
          }),
        )}
      />,
    );
    const text = failedRow(container).textContent ?? '';

    expect(text).toBe('李四提交的报销钉钉服务暂时不可用，请稍后重试。');
    expect(text).not.toContain('DINGTALK_');
    expect(text).not.toContain('不要向用户');
  });

  it('shows the translated message of a known code instead of the sentence', () => {
    const { container } = render(
      <WriteResult
        {...props(
          'refuseTasks',
          oneFailure({ error: '该审批当前由他人处理', errorCode: 'DINGTALK_NOT_TASK_OWNER' }),
        )}
      />,
    );

    expect(failedRow(container).textContent).toBe(
      `李四提交的报销${zh('ui.error.DINGTALK_NOT_TASK_OWNER')}`,
    );
  });

  it('links the https permission page with the server label, next to the mapped message', () => {
    const href = 'https://open-dev.dingtalk.com/fe/app#/corp/app/123/permission';
    const { container } = render(
      <WriteResult
        {...props(
          'approveTasks',
          oneFailure({
            actionLabel: '申请权限',
            actionUrl: href,
            error: '应用缺少审批权限',
            errorCode: 'DINGTALK_FORBIDDEN',
          }),
        )}
      />,
    );
    const failed = failedRow(container);
    const link = within(failed).getByRole('link', { name: '申请权限' });

    expect(link.getAttribute('href')).toBe(href);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(failed.textContent).toBe(`李四提交的报销${zh('ui.error.DINGTALK_FORBIDDEN')} 申请权限`);
  });

  it('names a link without a label with the neutral 「去处理」 copy', () => {
    const href = 'https://open-dev.dingtalk.com/fe/app#/corp/app/123/permission';
    const { container } = render(
      <WriteResult
        {...props('approveTasks', oneFailure({ actionUrl: href, errorCode: 'DINGTALK_FORBIDDEN' }))}
      />,
    );

    expect(
      within(failedRow(container))
        .getByRole('link', { name: translate('builtins.dingtalk.action.resolve') })
        .getAttribute('href'),
    ).toBe(href);
  });

  it.each(['http://open-dev.dingtalk.com/permission', 'javascript:alert(1)', '//evil.example/x'])(
    'never links a non-https target: %s',
    (actionUrl) => {
      const { container } = render(
        <WriteResult
          {...props(
            'approveTasks',
            oneFailure({ actionLabel: '申请权限', actionUrl, error: '应用缺少审批权限' }),
          )}
        />,
      );

      expect(failedRow(container).querySelector('a')).toBeNull();
      expect(failedRow(container).textContent).toBe('李四提交的报销应用缺少审批权限');
    },
  );

  it('does not link the same page twice when a legacy reason already links it', () => {
    const href = 'https://open-dev.dingtalk.com/fe/app#/corp/app/123/permission';
    const { container } = render(
      <WriteResult
        {...props(
          'approveTasks',
          oneFailure({ actionUrl: href, error: `应用缺少审批权限，请 [申请权限](${href})` }),
        )}
      />,
    );

    expect(within(failedRow(container)).getAllByRole('link')).toHaveLength(1);
  });

  it('keeps a skipped approval as 「未执行」', () => {
    const { container } = render(
      <WriteResult
        {...props('approveTasks', oneFailure({ error: '未执行', errorCode: 'DINGTALK_FORBIDDEN' }))}
      />,
    );

    expect(failedRow(container).textContent).toBe('李四提交的报销未执行');
  });
});
