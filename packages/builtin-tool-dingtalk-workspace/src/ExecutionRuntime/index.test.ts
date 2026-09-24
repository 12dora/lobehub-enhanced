import { describe, expect, it, vi } from 'vitest';

import type { IDingtalkWorkspaceService } from './index';
import {
  createDingtalkWorkspaceRuntime,
  DINGTALK_WORKSPACE_CONTENT_LIMIT,
  DINGTALK_WORKSPACE_INTERNAL_TOOL_CONTENT,
} from './index';

const makeService = (
  overrides: Partial<IDingtalkWorkspaceService> = {},
): IDingtalkWorkspaceService => ({
  completeTodo: vi.fn(),
  createEvent: vi.fn(),
  createTodo: vi.fn(),
  deleteEvent: vi.fn(),
  deleteTodo: vi.fn(),
  getEvent: vi.fn(),
  listEvents: vi.fn().mockResolvedValue({ items: [] }),
  listMeetingRooms: vi.fn().mockResolvedValue({ items: [] }),
  listTodos: vi.fn().mockResolvedValue({ items: [] }),
  queryFreeBusy: vi.fn().mockResolvedValue({ people: [] }),
  respondEvent: vi.fn(),
  searchDirectory: vi.fn().mockResolvedValue({
    ambiguous: false,
    departments: [],
    serverNow: '2026-09-21T12:00:00+08:00',
    users: [],
  }),
  updateEvent: vi.fn(),
  updateTodo: vi.fn(),
  ...overrides,
});

const coded = (code: string, message = code, extra?: Record<string, unknown>) =>
  Object.assign(new Error(message), { code, ...extra });

describe('DingtalkWorkspaceExecutionRuntime', () => {
  it('returns compact search JSON with serverNow and does not pretty-print', async () => {
    const searchDirectory = vi.fn().mockResolvedValue({
      ambiguous: true,
      departments: [],
      serverNow: '2026-09-21T12:00:00+08:00',
      users: [
        {
          deptPath: '捷发 / 安环部',
          leafDeptName: '安环部',
          name: '胡玉琴A',
          staffId: 'staff-1',
        },
        {
          deptPath: '捷发 / 财务部',
          leafDeptName: '财务部',
          name: '胡玉琴A',
          staffId: 'staff-2',
        },
      ],
    });
    const runtime = createDingtalkWorkspaceRuntime(makeService({ searchDirectory }));

    const result = await runtime.searchDirectory({ q: '胡玉琴A' });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      ambiguous: true,
      serverNow: '2026-09-21T12:00:00+08:00',
      userCount: 2,
    });
    expect(result.content).toContain('"serverNow":"2026-09-21T12:00:00+08:00"');
    expect(result.content).toContain('请列出「姓名 · 部门」请用户选择后再调用写入接口');
    expect(result.content).not.toMatch(/\n {2}"/);
    expect(searchDirectory).toHaveBeenCalledWith('胡玉琴A', undefined);
  });

  it('tells the model to copy searchDirectory staff tokens verbatim', async () => {
    const searchDirectory = vi.fn().mockResolvedValue({
      ambiguous: false,
      departments: [],
      serverNow: '2026-09-21T12:00:00+08:00',
      users: [{ leafDeptName: '外贸组', name: '陈柠', staffId: '173abc' }],
    });
    const runtime = createDingtalkWorkspaceRuntime(makeService({ searchDirectory }));

    const result = await runtime.searchDirectory({ q: '陈柠' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('staff:<id>');
    expect(result.content).toContain('原样传入');
    expect(result.content).toContain('不要改写汉字');
    expect(result.content).toContain('"staffId":"staff:173abc"');
    expect(result.content).not.toContain('"staffId":"173abc"');
  });

  it('summarizes createTodo and always attaches serverNow', async () => {
    const createTodo = vi.fn().mockResolvedValue({ subject: '交周报', taskId: 'todo-1' });
    const runtime = createDingtalkWorkspaceRuntime(makeService({ createTodo }));

    const result = await runtime.createTodo({
      dueTime: '2026-09-22T18:00:00+08:00',
      subject: '交周报',
    });

    expect(createTodo).toHaveBeenCalledWith({
      dueTime: '2026-09-22T18:00:00+08:00',
      subject: '交周报',
    });
    expect(result.success).toBe(true);
    expect(result.content).toContain('已创建待办「交周报」');
    expect(result.content.split('\n')[0]).not.toContain('todo-1');
    expect(result.content).toContain('"serverNow"');
    expect(result.content).toContain('todo-1');
  });

  it('names todo and calendar write success text without echoing ids', async () => {
    const runtime = createDingtalkWorkspaceRuntime(
      makeService({
        completeTodo: vi.fn().mockResolvedValue({ ok: true, subject: '写周报', taskId: 'todo-1' }),
        deleteEvent: vi.fn().mockResolvedValue({ eventId: 'evt-1', ok: true, summary: '周会' }),
        updateEvent: vi.fn().mockResolvedValue({ id: 'evt-1', summary: '同步会' }),
        updateTodo: vi.fn().mockResolvedValue({ ok: true, subject: '对账', taskId: 'todo-2' }),
      }),
    );

    const completed = await runtime.completeTodo({ taskId: 'todo-1' });
    expect(completed.content.split('\n')[0]).toBe('已完成待办「写周报」');
    expect(completed.content.split('\n')[0]).not.toContain('todo-1');

    const updatedTodo = await runtime.updateTodo({ subject: '对账', taskId: 'todo-2' });
    expect(updatedTodo.content.split('\n')[0]).toBe('已更新待办「对账」');
    expect(updatedTodo.content.split('\n')[0]).not.toContain('todo-2');

    const updatedEvent = await runtime.updateEvent({
      eventId: 'evt-1',
      summary: '同步会',
    });
    expect(updatedEvent.content.split('\n')[0]).toBe('已更新日程「同步会」');
    expect(updatedEvent.content.split('\n')[0]).not.toContain('evt-1');

    const deletedEvent = await runtime.deleteEvent({ eventId: 'evt-1' });
    expect(deletedEvent.content.split('\n')[0]).toBe('已删除日程「周会」');
    expect(deletedEvent.content.split('\n')[0]).not.toContain('evt-1');
  });

  it('strips titles from queryFreeBusy content instruction', async () => {
    const queryFreeBusy = vi.fn().mockResolvedValue({
      people: [
        {
          blocks: [{ end: '12:00', start: '11:00', status: 'BUSY' }],
          name: '李四 · 财务',
          staffToken: 'staff:li',
          unionId: 'union-li',
        },
      ],
    });
    const runtime = createDingtalkWorkspaceRuntime(makeService({ queryFreeBusy }));

    const result = await runtime.queryFreeBusy({
      from: '2026-09-22T09:00:00+08:00',
      staffTokens: ['staff:1'],
      to: '2026-09-22T18:00:00+08:00',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('仅返回忙闲时段');
    expect(result.content).toContain('"serverNow"');
    expect(result.content).toContain('"staffToken":"staff:li"');
    expect(result.content).not.toContain('union-li');
    expect(result.content).not.toContain('"staffToken":"李四');
  });

  it.each([
    ['DINGTALK_NOT_CONFIGURED', '钉钉服务号未配置'],
    ['DINGTALK_FEATURE_DISABLED', '该能力未开启'],
    ['DINGTALK_FORBIDDEN', '没有权限执行该操作'],
    ['DINGTALK_PREMIUM_REQUIRED', 'OA 审批高级版'],
    ['DINGTALK_NOT_FOUND', '未找到该待办或日程'],
    ['DINGTALK_INVALID', '参数无效'],
    ['DINGTALK_ROOM_UNAVAILABLE', '该时段无法预订'],
    ['DINGTALK_RATE_LIMITED', '钉钉接口限流'],
    ['DINGTALK_UNAVAILABLE', '钉钉服务暂时不可用'],
    ['DINGTALK_IDENTITY_UNBOUND', '未绑定钉钉身份'],
    ['DINGTALK_IDENTITY_UNVERIFIED', '钉钉身份未经验证'],
    ['DINGTALK_IDENTITY_INACTIVE', '已停用或已离职'],
    ['DINGTALK_NOT_TASK_OWNER', '当前处理人'],
    ['DINGTALK_NOT_ORIGINATOR', '仅发起人'],
    ['DINGTALK_NOT_APPROVAL_ADMIN', '审批管理员'],
    ['DINGTALK_AUTOMATION_OFF', '自动审批已关闭'],
    ['DINGTALK_RULE_LIMIT', '规则数量上限'],
  ] as const)('maps %s to Chinese model-facing guidance', async (code, snippet) => {
    const runtime = createDingtalkWorkspaceRuntime(
      makeService({ createTodo: vi.fn().mockRejectedValue(coded(code)) }),
    );

    const result = await runtime.createTodo({ subject: 'x' });

    expect(result.success).toBe(false);
    expect(result.content).toContain(code);
    expect(result.content).toContain(snippet);
    expect(result.content).toContain('"serverNow"');
    expect(result.error).toMatchObject({ code });
    expect(result.content).not.toContain('SELECT ');
  });

  it('lists DINGTALK_AMBIGUOUS candidates as 姓名 · 部门 and tells the model to ask', async () => {
    const runtime = createDingtalkWorkspaceRuntime(
      makeService({
        createEvent: vi.fn().mockRejectedValue(
          coded('DINGTALK_AMBIGUOUS', 'ambiguous', {
            candidates: [
              { leafDeptName: '安环部', name: '胡玉琴A', staffId: 's1' },
              { leafDeptName: '财务部', name: '胡玉琴A', staffId: 's2' },
            ],
          }),
        ),
      }),
    );

    const result = await runtime.createEvent({
      end: '2026-09-22T11:00:00+08:00',
      start: '2026-09-22T10:00:00+08:00',
      summary: '同步会',
      attendeeTokens: ['胡玉琴A'],
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('DINGTALK_AMBIGUOUS');
    expect(result.content).toContain('胡玉琴A · 安环部（staff:s1）');
    expect(result.content).toContain('胡玉琴A · 财务部（staff:s2）');
    expect(result.content).toContain('不要自行猜测');
    expect(result.content).toContain('"candidates"');
    expect(result.error).toMatchObject({
      candidates: [
        expect.objectContaining({ name: '胡玉琴A', staffId: 's1' }),
        expect.objectContaining({ name: '胡玉琴A', staffId: 's2' }),
      ],
      code: 'DINGTALK_AMBIGUOUS',
    });
  });

  it('does not leak raw upstream / SQL errors', async () => {
    const runtime = createDingtalkWorkspaceRuntime(
      makeService({
        deleteTodo: vi
          .fn()
          .mockRejectedValue(new Error('SELECT * FROM todos WHERE access_token=secret')),
      }),
    );

    const result = await runtime.deleteTodo({ taskId: 'todo-1' });

    expect(result.success).toBe(false);
    expect(result.content).toContain(DINGTALK_WORKSPACE_INTERNAL_TOOL_CONTENT);
    expect(result.content).not.toContain('SELECT');
    expect(result.content).not.toContain('access_token');
    expect(result.content).toContain('"serverNow"');
    expect(result.error).toMatchObject({ code: 'DINGTALK_INTERNAL' });
  });

  it('flattens todo done and calendar date objects for the UI', async () => {
    const listTodos = vi.fn().mockResolvedValue({
      items: [{ done: true, subject: '交周报', taskId: 'todo-1' }],
    });
    const listEvents = vi.fn().mockResolvedValue({
      items: [
        {
          end: { dateTime: '2026-09-22T11:00:00+08:00', timeZone: 'Asia/Shanghai' },
          id: 'evt-1',
          start: { dateTime: '2026-09-22T10:00:00+08:00', timeZone: 'Asia/Shanghai' },
          summary: '同步',
        },
      ],
    });
    const runtime = createDingtalkWorkspaceRuntime(makeService({ listEvents, listTodos }));

    const todos = await runtime.listTodos({ done: true });
    const events = await runtime.listEvents({
      from: '2026-09-22T00:00:00+08:00',
      to: '2026-09-23T00:00:00+08:00',
    });

    expect(todos.content).toContain('"isDone":true');
    expect(todos.content).toContain('todo-1');
    expect(events.content).toContain('"eventId":"evt-1"');
    expect(events.content).toContain('2026-09-22T10:00:00+08:00');
    expect(events.content).not.toContain('"timeZone"');
  });

  it('keeps merged todo notes and flattens assistant cards', async () => {
    const note =
      '你在钉钉客户端里自己创建的待办，以及其他应用推送的待办，钉钉未向本系统开放读取（需专属钉钉的待办读权限），这里只包含：待我审批的流程、由本助手创建的待办。';
    const listTodos = vi.fn().mockResolvedValue({
      appTodos: [{ done: false, source: 'assistant', subject: '周报', taskId: 't1' }],
      approvals: {
        count: 1,
        items: [{ source: 'approval', taskId: 'ap-1', title: '请假' }],
        truncated: false,
      },
      notes: [note],
      orgTodos: [{ done: true, source: 'org', subject: '客户端', taskId: 't2' }],
      truncated: false,
    });
    const runtime = createDingtalkWorkspaceRuntime(makeService({ listTodos }));

    const todos = await runtime.listTodos({});

    expect(todos.content).toContain(note);
    expect(todos.content).toContain('"source":"assistant"');
    expect(todos.content).toContain('"isDone":false');
    expect(todos.content).toContain('"source":"org"');
    expect(todos.content).toContain('"isDone":true');
    expect(todos.content).toContain('请假');
  });

  it('flattens personalTodos the same way as org and assistant todos', async () => {
    const listTodos = vi.fn().mockResolvedValue({
      personalTodos: [{ done: true, source: 'personal', subject: '客户端待办', taskId: 'tp-1' }],
      truncated: false,
    });
    const runtime = createDingtalkWorkspaceRuntime(makeService({ listTodos }));

    const todos = await runtime.listTodos({});

    expect(todos.content).toContain('"source":"personal"');
    expect(todos.content).toContain('"isDone":true');
    expect(todos.content).toContain('tp-1');
    expect(todos.state).toMatchObject({
      personalTodos: [
        expect.objectContaining({ isDone: true, source: 'personal', taskId: 'tp-1' }),
      ],
    });
  });

  it('trims an oversized personalTodos list under the content cap', async () => {
    const personalTodos = Array.from({ length: 150 }, (_, index) => ({
      done: false,
      source: 'personal',
      subject: `待办${index}${'详'.repeat(200)}`,
      taskId: `tp-${index}`,
    }));
    const listTodos = vi.fn().mockResolvedValue({ personalTodos, truncated: false });
    const runtime = createDingtalkWorkspaceRuntime(makeService({ listTodos }));

    const result = await runtime.listTodos({});

    expect(result.success).toBe(true);
    expect(result.content).toContain('"truncated":true');
    expect(result.content.length).toBeLessThanOrEqual(DINGTALK_WORKSPACE_CONTENT_LIMIT);
    expect(result.content).toContain('tp-0');
    const state = result.state as { personalTodos?: unknown[] };
    expect(state.personalTodos?.length ?? 0).toBeGreaterThan(0);
    expect(state.personalTodos?.length ?? 0).toBeLessThan(150);
  });

  it('reads DINGTALK_AMBIGUOUS candidates from a TRPC cause payload', async () => {
    const runtime = createDingtalkWorkspaceRuntime(
      makeService({
        createTodo: vi.fn().mockRejectedValue({
          cause: {
            data: {
              candidates: [{ deptPath: '安环部', name: '胡玉琴A', staffId: 's1' }],
              code: 'DINGTALK_AMBIGUOUS',
            },
          },
          message: 'DINGTALK_AMBIGUOUS',
        }),
      }),
    );

    const result = await runtime.createTodo({ subject: '交周报', executorTokens: ['胡玉琴A'] });

    expect(result.success).toBe(false);
    expect(result.content).toContain('DINGTALK_AMBIGUOUS');
    expect(result.content).toContain('胡玉琴A · 安环部（staff:s1）');
    expect(result.error).toMatchObject({
      candidates: [expect.objectContaining({ staffId: 's1' })],
      code: 'DINGTALK_AMBIGUOUS',
    });
  });

  it('reads DINGTALK_AMBIGUOUS candidates from tRPC data.errorData', async () => {
    const runtime = createDingtalkWorkspaceRuntime(
      makeService({
        createTodo: vi.fn().mockRejectedValue({
          data: {
            code: 'BAD_REQUEST',
            errorData: {
              candidates: [{ deptPath: '安环部', name: '胡玉琴A', staffId: 's1' }],
              code: 'DINGTALK_AMBIGUOUS',
            },
          },
          message: 'BAD_REQUEST',
        }),
      }),
    );

    const result = await runtime.createTodo({ subject: '交周报', executorTokens: ['胡玉琴A'] });

    expect(result.success).toBe(false);
    expect(result.content).toContain('DINGTALK_AMBIGUOUS');
    expect(result.content).toContain('胡玉琴A · 安环部（staff:s1）');
    expect(result.error).toMatchObject({
      candidates: [expect.objectContaining({ name: '胡玉琴A', staffId: 's1' })],
      code: 'DINGTALK_AMBIGUOUS',
    });
  });

  it('maps DINGTALK_ROOM_UNAVAILABLE roomIssues to Chinese booking guidance', async () => {
    const runtime = createDingtalkWorkspaceRuntime(
      makeService({
        createEvent: vi.fn().mockRejectedValue(
          coded('DINGTALK_ROOM_UNAVAILABLE', 'DINGTALK_ROOM_UNAVAILABLE', {
            cause: {
              data: {
                code: 'DINGTALK_ROOM_UNAVAILABLE',
                roomIssues: [{ reason: '预订时长不得少于 30 分钟', roomName: '捷发2楼会议室' }],
              },
            },
          }),
        ),
      }),
    );

    const result = await runtime.createEvent({
      end: '2026-09-22T10:20:00+08:00',
      roomIds: ['room-1'],
      start: '2026-09-22T10:00:00+08:00',
      summary: '同步会',
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('DINGTALK_ROOM_UNAVAILABLE');
    expect(result.content).toContain(
      '会议室「捷发2楼会议室」该时段无法预订:预订时长不得少于 30 分钟',
    );
    expect(result.content).toContain('请调整时间或更换会议室后重试');
    expect(result.content).not.toContain('meetingRoomNotAvailable');
    expect(result.content).not.toContain('developerMessage');
    expect(result.error).toMatchObject({ code: 'DINGTALK_ROOM_UNAVAILABLE' });
  });

  it('says the time was changed but the room was not on updateEvent room-unavailable', async () => {
    const runtime = createDingtalkWorkspaceRuntime(
      makeService({
        updateEvent: vi.fn().mockRejectedValue(
          coded('DINGTALK_ROOM_UNAVAILABLE', 'DINGTALK_ROOM_UNAVAILABLE', {
            cause: {
              data: {
                code: 'DINGTALK_ROOM_UNAVAILABLE',
                roomIssues: [{ reason: '该时段已被预订', roomName: '捷发2楼会议室' }],
                timeApplied: true,
              },
            },
          }),
        ),
      }),
    );

    const result = await runtime.updateEvent({
      end: '2026-09-22T15:00:00+08:00',
      eventId: 'evt-1',
      roomIds: ['room-B'],
      start: '2026-09-22T14:00:00+08:00',
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('日程时间已更新，会议室未更换');
    expect(result.content).toContain('会议室「捷发2楼会议室」该时段无法预订:该时段已被预订');
    expect(result.content).not.toContain('The reservation period');
  });

  it('keeps a safe DINGTALK_INVALID hint', async () => {
    const runtime = createDingtalkWorkspaceRuntime(
      makeService({
        createTodo: vi
          .fn()
          .mockRejectedValue(coded('DINGTALK_INVALID', 'dueTime 不能早于当前时间')),
      }),
    );

    const result = await runtime.createTodo({
      dueTime: '2020-01-01T00:00:00+08:00',
      subject: '过期',
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('DINGTALK_INVALID');
    expect(result.content).toContain('dueTime 不能早于当前时间');
  });

  it('truncates oversized read payloads, sets truncated, and keeps serverNow', async () => {
    const items = Array.from({ length: 80 }, (_, index) => ({
      description: '详'.repeat(400),
      end: { dateTime: '2026-09-22T11:00:00+08:00', timeZone: 'Asia/Shanghai' },
      id: `evt-${index}`,
      start: { dateTime: '2026-09-22T10:00:00+08:00', timeZone: 'Asia/Shanghai' },
      summary: `会议${index}`,
    }));
    const listEvents = vi.fn().mockResolvedValue({ items, serverNow: '2026-09-21T12:00:00+08:00' });
    const runtime = createDingtalkWorkspaceRuntime(makeService({ listEvents }));

    const result = await runtime.listEvents({
      from: '2026-09-22T00:00:00+08:00',
      to: '2026-09-23T00:00:00+08:00',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('"serverNow":"2026-09-21T12:00:00+08:00"');
    expect(result.content).toContain('"truncated":true');
    expect(result.content.length).toBeLessThanOrEqual(DINGTALK_WORKSPACE_CONTENT_LIMIT);
    expect(result.state).toMatchObject({ serverNow: '2026-09-21T12:00:00+08:00', truncated: true });
  });

  it('nests getEvent under state.event and strips organizer unionIds', async () => {
    const getEvent = vi.fn().mockResolvedValue({
      attendees: [{ displayName: '外部客户', unresolved: true }],
      id: 'evt-1',
      organizer: { displayName: '张三', id: 'union-me', self: true },
      summary: '周会',
    });
    const runtime = createDingtalkWorkspaceRuntime(makeService({ getEvent }));

    const result = await runtime.getEvent({ eventId: 'evt-1' });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      event: {
        attendees: [expect.objectContaining({ displayName: '外部客户', unresolved: true })],
        eventId: 'evt-1',
        organizer: expect.objectContaining({ displayName: '张三' }),
        summary: '周会',
      },
      success: true,
    });
    expect(result.state).not.toHaveProperty('summary');
    expect(result.state).not.toHaveProperty('eventId');
    const organizer = (result.state as { event?: { organizer?: Record<string, unknown> } })?.event
      ?.organizer;
    expect(organizer).not.toHaveProperty('id');
    expect(result.content).not.toContain('union-me');
    expect(result.content).toContain('"event"');
  });

  it('shrinks getEvent attendees and description instead of dropping the event', async () => {
    const getEvent = vi.fn().mockResolvedValue({
      attendees: Array.from({ length: 400 }, (_, index) => ({
        displayName: `参会人${index}-${'详'.repeat(80)}`,
        staffToken: `staff:${index}`,
      })),
      description: '说'.repeat(20_000),
      id: 'evt-keep',
      summary: '超长日程',
    });
    const runtime = createDingtalkWorkspaceRuntime(makeService({ getEvent }));

    const result = await runtime.getEvent({ eventId: 'evt-keep' });

    expect(result.success).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(DINGTALK_WORKSPACE_CONTENT_LIMIT);
    expect(result.content).toContain('"truncated":true');
    expect(result.content).toContain('evt-keep');
    expect(result.content).toContain('超长日程');
    expect(result.state).toMatchObject({
      event: expect.objectContaining({ eventId: 'evt-keep', summary: '超长日程' }),
    });
    const event = (result.state as { event?: { attendees?: unknown[]; description?: string } })
      ?.event;
    expect(event?.attendees?.length ?? 0).toBeLessThan(400);
  });
});
