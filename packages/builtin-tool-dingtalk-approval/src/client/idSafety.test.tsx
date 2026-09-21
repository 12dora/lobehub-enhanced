/**
 * @vitest-environment happy-dom
 *
 * The production regression this guards: the delete-template confirm card read
 * 「删除模板「PROC-84322A73-E989-4C4E-B178-C4BA2EE5ECBB」」. Every client surface is fed
 * a payload carrying *only* our own identifiers, and the rendered text has to come
 * back free of them.
 *
 * The other half matters just as much: this is a confirmation UI, so the user's own
 * data has to survive untouched. A bank account, a 统一社会信用代码 or a contract
 * number is not an identifier to hide, and a preview line is never dropped.
 */
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import zhPlugin from '../../../../locales/zh-CN/plugin.json';
import { DingtalkApprovalApiName } from './apiNames';
import ConfirmCard from './components/ConfirmCard';
import Summary from './Inspector/Summary';
import Detail from './Render/Detail';
import ListResult from './Render/ListResult';
import WriteResult from './Render/WriteResult';

const dict = zhPlugin as Record<string, string>;

/** Real zh-CN copy, so a renamed or missing key fails here instead of shipping. */
const translate = (key: string, options?: Record<string, unknown>) => {
  const raw = dict[key];
  if (raw === undefined) throw new Error(`missing zh-CN key: ${key}`);
  return raw.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
};

const mocks = vi.hoisted(() => ({ data: undefined as unknown, error: undefined as unknown }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));

vi.mock('swr', () => ({
  default: () => ({ data: mocks.data, error: mocks.error, isLoading: false }),
}));

vi.mock('@/services/dingtalkApproval', () => ({
  dingtalkApprovalService: { preview: vi.fn() },
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
  Alert: ({ description, title }: { description?: ReactNode; title?: ReactNode }) => (
    <div role="alert">
      <span>{title}</span>
      {description}
    </div>
  ),
  Button: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
  Skeleton: () => <span />,
  SkeletonText: () => <span />,
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  toast: { error: vi.fn() },
}));

afterEach(() => cleanup());

const PROCESS_CODE = 'PROC-84322A73-E989-4C4E-B178-C4BA2EE5ECBB';
const RULE_ID = 'dar_7f3c19ab4d';
const INSTANCE_ID = '1f6a3c2b-4d5e-6f70-8192-a3b4c5d6e7f8';
const STAFF_TOKEN = 'staff:012345';
const DEPT_TOKEN = 'dept:998877';

/** Our own identifier formats — and only ours, so user data is never swept up. */
const FORBIDDEN: readonly [string, RegExp][] = [
  ['processCode', /PROC-[\dA-F]{8}-/i],
  ['rule id', /dar_/i],
  ['todo id', /task[\da-f]{32}/i],
  ['staff token', /staff:/i],
  ['dept token', /dept:/i],
];

/** Values a user legitimately types into an approval form. None may be touched. */
const USER_DATA = {
  bankAccount: '6222021234567890123',
  contractNo: 'HT-2026-0921-000123456789',
  creditCode: '91330600597214350R',
  note: '对照系统记录 1f6a3c2b-4d5e-6f70-8192-a3b4c5d6e7f8 核销',
  url: 'https://meet.dingtalk.com/j/aBcD1234EfGh5678',
};

const expectNoIdentifier = (text: string) => {
  for (const [label, pattern] of FORBIDDEN) {
    expect(pattern.test(text), `${label} leaked into: ${text}`).toBe(false);
  }
};

/** Args carrying nothing but identifiers — the shape the model produces most often. */
const ID_ONLY_ARGS = {
  name: PROCESS_CODE,
  processCode: PROCESS_CODE,
  processInstanceId: INSTANCE_ID,
  ruleId: RULE_ID,
  staffToken: STAFF_TOKEN,
  title: RULE_ID,
};

describe('Inspector shows an action, never an identifier', () => {
  const apiNames = Object.values(DingtalkApprovalApiName);

  it.each(apiNames)('%s', (apiName) => {
    const { container } = render(
      <Summary apiName={apiName} args={ID_ONLY_ARGS} identifier={'lobe-dingtalk-approval'} />,
    );
    const text = container.textContent ?? '';

    // The one-liner still names the action…
    expect(text).toContain(translate('builtins.lobe-dingtalk-approval.title'));
    expect(text).toContain(
      translate(`builtins.lobe-dingtalk-approval.ui.apiLabel.${apiName}` as const),
    );
    // …and adds no hint at all when the arguments only carry identifiers.
    expectNoIdentifier(text);
  });

  it('adds a hint when the arguments carry a name', () => {
    const { container } = render(
      <Summary
        apiName={DingtalkApprovalApiName.saveTemplate}
        args={{ ...ID_ONLY_ARGS, name: '差旅报销' }}
        identifier={'lobe-dingtalk-approval'}
      />,
    );

    expect(container.textContent).toContain('差旅报销');
  });
});

interface RenderCase {
  api: string;
  args?: Record<string, unknown>;
  /** Copy that has to survive, so an empty card cannot pass the identifier check. */
  expected: string;
  name: string;
  render: typeof Detail;
  state?: unknown;
}

const RENDER_CASES: readonly RenderCase[] = [
  {
    api: DingtalkApprovalApiName.listTemplates,
    expected: '未命名条目',
    name: 'template list holding only processCodes',
    render: ListResult,
    state: { templates: [{ name: PROCESS_CODE, processCode: PROCESS_CODE }], total: 1 },
  },
  {
    api: DingtalkApprovalApiName.listPendingApprovals,
    expected: '未命名条目',
    name: 'pending list whose rows carry no title at all',
    render: ListResult,
    state: { tasks: [{ processInstanceId: INSTANCE_ID, taskId: '2049183091773' }] },
  },
  {
    api: DingtalkApprovalApiName.listApprovalRules,
    expected: '未命名条目',
    name: 'rule list holding only rule ids',
    render: ListResult,
    state: { rules: [{ enabled: true, id: RULE_ID, name: RULE_ID }] },
  },
  {
    api: DingtalkApprovalApiName.listMyApplications,
    // A user-written title that happens to contain a UUID is data, not an id.
    expected: USER_DATA.note,
    name: 'application list whose title contains a long serial',
    render: ListResult,
    state: { instances: [{ processInstanceId: INSTANCE_ID, title: USER_DATA.note }] },
  },
  {
    api: DingtalkApprovalApiName.searchDirectory,
    // A `staff:` token is a person, so the row reads 「同事」 rather than 「未命名条目」.
    expected: '同事',
    name: 'directory hits holding only staff tokens',
    render: ListResult,
    state: { hits: { users: [{ name: STAFF_TOKEN, staffId: '0123456789' }] } },
  },
  {
    api: DingtalkApprovalApiName.getApprovalDetail,
    expected: '同事',
    name: 'approval detail whose form values are still staff tokens',
    render: Detail,
    state: {
      lines: [{ label: '审批人', value: STAFF_TOKEN }],
      processInstanceId: INSTANCE_ID,
    },
  },
  {
    api: DingtalkApprovalApiName.getTemplateSchema,
    expected: '未命名条目',
    name: 'template schema whose fields carry no label',
    render: Detail,
    state: {
      fields: [{ componentId: 'TextField_6B1F0A9C', required: true }],
      processCode: PROCESS_CODE,
    },
  },
  {
    api: DingtalkApprovalApiName.getApprovalDetail,
    // Form values are the user's own record. A bank account is not an identifier to
    // hide, and a detail card that swallowed it would be useless.
    expected: USER_DATA.bankAccount,
    name: 'approval detail carrying the account the user submitted',
    render: Detail,
    state: {
      lines: [
        { label: '收款账号', value: USER_DATA.bankAccount },
        { label: '统一社会信用代码', value: USER_DATA.creditCode },
        { label: '合同编号', value: USER_DATA.contractNo },
      ],
    },
  },
  {
    api: DingtalkApprovalApiName.deleteTemplate,
    args: { processCode: PROCESS_CODE },
    expected: '已删除模板',
    name: 'delete-template result',
    render: WriteResult,
    state: { processCode: PROCESS_CODE, success: true },
  },
  {
    api: DingtalkApprovalApiName.approveTask,
    args: { taskId: '2049183091773' },
    expected: '已同意审批',
    name: 'approve result',
    render: WriteResult,
    state: { success: true, taskId: '2049183091773' },
  },
  {
    api: DingtalkApprovalApiName.deleteApprovalRule,
    args: { ruleId: RULE_ID },
    expected: '已删除自动审批规则',
    name: 'delete-rule result',
    render: WriteResult,
    state: { rule: { id: RULE_ID }, success: true },
  },
];

describe('Render shows names or a neutral noun, never an identifier', () => {
  it.each(RENDER_CASES)('$name', ({ api, args, expected, render: Component, state }) => {
    const { container } = render(
      <Component
        apiName={api}
        args={args ?? {}}
        content={''}
        messageId={'msg_1'}
        pluginState={state}
      />,
    );
    const text = container.textContent ?? '';

    expect(text).toContain(expected);
    expectNoIdentifier(text);
  });
});

/** Renders the confirm card for a settled preview of these exact arguments. */
const renderConfirm = (apiName: string, args: Record<string, unknown>, preview: unknown) => {
  mocks.error = undefined;
  mocks.data = { preview, signature: JSON.stringify(args) };

  return render(
    <ConfirmCard apiName={apiName as typeof DingtalkApprovalApiName.deleteTemplate} args={args} />,
  );
};

describe('ConfirmCard scrubs a preview that still carries identifiers', () => {
  it('keeps the readable part of the title and names the id-only line', () => {
    const args = { processCode: PROCESS_CODE };
    const { container } = renderConfirm(DingtalkApprovalApiName.deleteTemplate, args, {
      actingAs: { name: '张三' },
      danger: true,
      lines: [
        { label: '模板', value: PROCESS_CODE },
        { label: '执行人', value: STAFF_TOKEN },
        { label: '范围', value: DEPT_TOKEN },
      ],
      title: `删除模板「${PROCESS_CODE}」`,
    });
    const text = container.textContent ?? '';

    expect(text).toContain('删除模板');
    expect(text).toContain('以 张三 的钉钉身份执行');
    // Every line the user is confirming is still there: the two audience tokens read
    // as nouns, and the 「模板」 line, whose value was only the processCode, is named
    // rather than silently removed.
    expect(text).toContain('模板');
    expect(text).toContain('未命名条目');
    expect(text).toContain('执行人');
    expect(text).toContain('同事');
    expect(text).toContain('范围');
    expect(text).toContain('部门');
    expectNoIdentifier(text);
  });

  it('leaves the data the user is about to approve exactly as it is', () => {
    const args = { processCode: PROCESS_CODE };
    const { container } = renderConfirm(DingtalkApprovalApiName.submitApproval, args, {
      lines: [
        { label: '收款账号', value: USER_DATA.bankAccount },
        { label: '统一社会信用代码', value: USER_DATA.creditCode },
        { label: '合同编号', value: USER_DATA.contractNo },
        { label: '备注', value: USER_DATA.note },
        { label: '会议链接', value: USER_DATA.url },
      ],
      title: '提交「工具借用审批」',
    });
    const text = container.textContent ?? '';

    expect(text).toContain('提交「工具借用审批」');
    for (const value of Object.values(USER_DATA)) {
      expect(text).toContain(value);
    }
  });

  it('keeps the raw arguments behind a collapsed diagnostics toggle on the error path', () => {
    mocks.data = undefined;
    mocks.error = new Error('DINGTALK_NOT_FOUND');

    const { container } = render(
      <ConfirmCard
        apiName={DingtalkApprovalApiName.deleteTemplate}
        args={{ processCode: PROCESS_CODE }}
      />,
    );
    const text = container.textContent ?? '';

    expect(text).toContain(translate('builtins.lobe-dingtalk-approval.ui.confirm.rawArgs'));
    expect(text).toContain(
      translate('builtins.lobe-dingtalk-approval.ui.error.DINGTALK_NOT_FOUND'),
    );
    // Collapsed by default: the payload is a diagnostics affordance, not the card.
    expectNoIdentifier(text);
  });
});
