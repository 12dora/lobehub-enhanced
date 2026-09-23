/**
 * @vitest-environment happy-dom
 *
 * Sibling of the approval toolset's guard, for the same production bug class: a card
 * that shows the identifier it was called with instead of the thing it acted on.
 *
 * The mask is narrow on purpose, so the other half of the table matters just as
 * much: a todo subject, an event summary or a location is the user's own text, and a
 * long number inside it stays exactly as they typed it.
 */
import type { BuiltinRenderProps } from '@lobechat/types';
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import zhPlugin from '../../../../locales/zh-CN/plugin.json';
import { DINGTALK_WORKSPACE_DOMAINS, DingtalkWorkspaceApiName } from './apiNames';
import ConfirmCard from './components/ConfirmCard';
import Summary from './Inspector/Summary';
import DirectoryList from './Render/DirectoryList';
import EventDetail from './Render/EventDetail';
import EventList from './Render/EventList';
import FreeBusyList from './Render/FreeBusyList';
import RoomList from './Render/RoomList';
import TodoList from './Render/TodoList';
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

const TODO_ID = 'task6b1f0a9c8e7d4b3a5c9e2f81d4b70a36';
const TASK_ID = '2049183091773';
const EVENT_ID = '1f6a3c2b-4d5e-6f70-8192-a3b4c5d6e7f8';
const ROOM_ID = '6b1f0a9c8e7d4b3a';
const UNION_ID = 'ziPPFsMVAOhVHHAIzMwiAiEiE';
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

/** Text a user legitimately writes into a todo or an event. None may be touched. */
const USER_DATA = {
  bankAccount: '6222021234567890123',
  contractNo: 'HT-2026-0921-000123456789',
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
  attendeeTokens: [STAFF_TOKEN],
  eventId: EVENT_ID,
  name: STAFF_TOKEN,
  roomId: ROOM_ID,
  taskId: TASK_ID,
};

describe('Inspector shows an action, never an identifier', () => {
  const apiNames = Object.values(DingtalkWorkspaceApiName);

  it.each(apiNames)('%s', (apiName) => {
    const { container } = render(
      <Summary apiName={apiName} args={ID_ONLY_ARGS} identifier={'lobe-dingtalk-workspace'} />,
    );
    const text = container.textContent ?? '';

    // The one-liner still names the domain and the action…
    expect(text).toContain(
      translate(
        `builtins.lobe-dingtalk-workspace.ui.domain.${DINGTALK_WORKSPACE_DOMAINS[apiName]}` as const,
      ),
    );
    expect(text).toContain(
      translate(`builtins.lobe-dingtalk-workspace.ui.apiLabel.${apiName}` as const),
    );
    // …and adds no hint at all when the arguments only carry identifiers.
    expectNoIdentifier(text);
  });

  it('adds a hint when the arguments carry a subject', () => {
    const { container } = render(
      <Summary
        apiName={DingtalkWorkspaceApiName.createTodo}
        args={{ ...ID_ONLY_ARGS, subject: '写周报' }}
        identifier={'lobe-dingtalk-workspace'}
      />,
    );

    expect(container.textContent).toContain('写周报');
  });
});

/**
 * Each render owns its own `pluginState` type, so the table holds them behind the
 * props they all accept. `never` keeps that widening honest: the cast lives in one
 * place, at the single render call below.
 */
type IdSafeProps = BuiltinRenderProps<Record<string, unknown>, never>;
type IdSafeRender = (props: IdSafeProps) => ReactNode;

interface RenderCase {
  api: string;
  args?: Record<string, unknown>;
  /** Copy that has to survive, so an empty card cannot pass the identifier check. */
  expected: string;
  name: string;
  render: IdSafeRender;
  state?: unknown;
}

const RENDER_CASES: readonly RenderCase[] = [
  {
    api: DingtalkWorkspaceApiName.listTodos,
    expected: '未命名待办',
    name: 'todo list whose subject is still the DingTalk todo id',
    render: TodoList,
    state: { count: 1, items: [{ isDone: false, subject: TODO_ID, taskId: TODO_ID }] },
  },
  {
    api: DingtalkWorkspaceApiName.listTodos,
    expected: '未命名待办',
    name: 'merged todo list whose assistant todo subject is still the DingTalk todo id',
    render: TodoList,
    state: {
      appTodos: [{ done: false, isDone: false, subject: TODO_ID, taskId: TODO_ID }],
      approvals: {
        count: 1,
        items: [{ originatorName: STAFF_TOKEN, taskId: TASK_ID, title: STAFF_TOKEN }],
      },
      notes: [],
    },
  },
  {
    api: DingtalkWorkspaceApiName.listEvents,
    expected: '未命名日程',
    name: 'event list whose rows carry no summary',
    render: EventList,
    state: { count: 1, items: [{ eventId: EVENT_ID }] },
  },
  {
    api: DingtalkWorkspaceApiName.getEvent,
    expected: '未命名日程',
    name: 'event detail whose event carries no summary',
    render: EventDetail,
    state: { event: { eventId: EVENT_ID, start: '2026-09-21T09:30:00+08:00' }, success: true },
  },
  {
    api: DingtalkWorkspaceApiName.listMeetingRooms,
    expected: '未命名会议室',
    name: 'room list whose rows carry no name',
    render: RoomList,
    state: { count: 1, items: [{ roomCapacity: 12, roomId: ROOM_ID }] },
  },
  {
    api: DingtalkWorkspaceApiName.queryFreeBusy,
    expected: '同事',
    name: 'free/busy rows the service could not resolve to a name',
    render: FreeBusyList,
    state: { people: [{ blocks: [], staffToken: STAFF_TOKEN, unionId: UNION_ID }], success: true },
  },
  {
    api: DingtalkWorkspaceApiName.searchDirectory,
    expected: '部门',
    name: 'directory hits holding only tokens',
    render: DirectoryList,
    state: {
      ambiguous: false,
      departmentCount: 1,
      hits: {
        departments: [{ deptId: '998877', name: DEPT_TOKEN }],
        users: [{ name: STAFF_TOKEN, staffId: UNION_ID }],
      },
      userCount: 1,
    },
  },
  {
    api: DingtalkWorkspaceApiName.listTodos,
    // The subject is the user's own text: a long account number is not an id.
    expected: USER_DATA.bankAccount,
    name: 'todo list whose subject contains an account number',
    render: TodoList,
    state: {
      count: 1,
      items: [{ isDone: false, subject: `核对收款账号 ${USER_DATA.bankAccount}`, taskId: TODO_ID }],
    },
  },
  {
    api: DingtalkWorkspaceApiName.listEvents,
    expected: USER_DATA.url,
    name: 'event list whose summary and location are the user’s own text',
    render: EventList,
    state: {
      count: 1,
      items: [{ eventId: EVENT_ID, location: USER_DATA.url, summary: USER_DATA.note }],
    },
  },
  {
    api: DingtalkWorkspaceApiName.getEvent,
    expected: USER_DATA.contractNo,
    name: 'event detail whose notes carry a contract number',
    render: EventDetail,
    state: {
      event: {
        description: `合同 ${USER_DATA.contractNo}`,
        eventId: EVENT_ID,
        location: USER_DATA.url,
        summary: USER_DATA.note,
      },
      success: true,
    },
  },
  {
    api: DingtalkWorkspaceApiName.deleteTodo,
    args: { taskId: TASK_ID },
    expected: '已删除待办',
    name: 'delete-todo result',
    render: WriteResult,
    state: { success: true, taskId: TASK_ID },
  },
  {
    api: DingtalkWorkspaceApiName.deleteEvent,
    args: { eventId: EVENT_ID },
    expected: '已删除日程',
    name: 'delete-event result',
    render: WriteResult,
    state: { eventId: EVENT_ID, success: true },
  },
  {
    api: DingtalkWorkspaceApiName.respondEvent,
    args: { eventId: EVENT_ID, response: 'accepted' },
    expected: '已回复日程邀请',
    name: 'respond-event result',
    render: WriteResult,
    state: { success: true },
  },
];

describe('Render shows names or a neutral noun, never an identifier', () => {
  it.each(RENDER_CASES)('$name', ({ api, args, expected, render: Component, state }) => {
    const props = {
      apiName: api,
      args: args ?? {},
      content: '',
      messageId: 'msg_1',
      pluginState: state,
    } as unknown as IdSafeProps;
    const { container } = render(<Component {...props} />);
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
    <ConfirmCard apiName={apiName as typeof DingtalkWorkspaceApiName.deleteTodo} args={args} />,
  );
};

describe('ConfirmCard scrubs a preview that still carries identifiers', () => {
  it('keeps the readable part of the title and names the id-only line', () => {
    const args = { taskId: TODO_ID };
    const { container } = renderConfirm(DingtalkWorkspaceApiName.deleteTodo, args, {
      actingAs: { name: '张三' },
      danger: true,
      lines: [
        { label: '待办', value: TODO_ID },
        { label: '执行人', value: STAFF_TOKEN },
        { label: '范围', value: DEPT_TOKEN },
      ],
      title: `删除待办「${TODO_ID}」`,
    });
    const text = container.textContent ?? '';

    expect(text).toContain('删除待办');
    expect(text).toContain('以 张三 的钉钉身份执行');
    // Every line the user is confirming is still there: the audience tokens read as
    // nouns, and the 「待办」 line, whose value was only the todo id, is named rather
    // than silently removed.
    expect(text).toContain('未命名条目');
    expect(text).toContain('执行人');
    expect(text).toContain('同事');
    expect(text).toContain('范围');
    expect(text).toContain('部门');
    expectNoIdentifier(text);
  });

  it('leaves the data the user is about to approve exactly as it is', () => {
    const args = { subject: '核对账号' };
    const { container } = renderConfirm(DingtalkWorkspaceApiName.createTodo, args, {
      lines: [
        { label: '收款账号', value: USER_DATA.bankAccount },
        { label: '合同编号', value: USER_DATA.contractNo },
        { label: '备注', value: USER_DATA.note },
        { label: '会议链接', value: USER_DATA.url },
      ],
      title: '创建「核对收款账号」',
    });
    const text = container.textContent ?? '';

    expect(text).toContain('创建「核对收款账号」');
    for (const value of Object.values(USER_DATA)) {
      expect(text).toContain(value);
    }
  });

  it('keeps the raw arguments behind a collapsed diagnostics toggle on the error path', () => {
    mocks.data = undefined;
    mocks.error = new Error('DINGTALK_ROOM_UNAVAILABLE');

    const { container } = render(
      <ConfirmCard apiName={DingtalkWorkspaceApiName.createEvent} args={{ roomId: ROOM_ID }} />,
    );
    const text = container.textContent ?? '';

    expect(text).toContain(translate('builtins.lobe-dingtalk-workspace.ui.confirm.rawArgs'));
    // The room code now maps to its own message instead of the generic 「操作失败」.
    expect(text).toContain(
      translate('builtins.lobe-dingtalk-workspace.ui.error.DINGTALK_ROOM_UNAVAILABLE'),
    );
    // Collapsed by default: the payload is a diagnostics affordance, not the card.
    expectNoIdentifier(text);
  });
});
