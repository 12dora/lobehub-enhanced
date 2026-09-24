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
    ['DINGTALK_NOT_CONFIGURED', '在 IM 连接器中配置钉钉通知应用'],
    ['DINGTALK_FEATURE_DISABLED', '在 IM 连接器的「工作台能力」中'],
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

  it('adds a one-click link for identity, admin, and apply-url errors', async () => {
    const unbound = createDingtalkWorkspaceRuntime(
      makeService({
        createTodo: vi.fn().mockRejectedValue(coded('DINGTALK_IDENTITY_UNBOUND')),
      }),
    );
    const web = await unbound.createTodo({ subject: 'x' });
    expect(web.content).toContain(`[用钉钉登录](/settings/messenger/dingtalk)`);
    expect(web.content).toContain('请先用钉钉登录本平台');

    const dingtalkRuntime = createDingtalkWorkspaceRuntime(
      makeService({
        createTodo: vi.fn().mockRejectedValue(coded('DINGTALK_IDENTITY_UNBOUND')),
      }),
      {
        platform: 'dingtalk',
        resolveLink: (path) =>
          `https://chat.example.com/dingtalk/sso?redirect=${encodeURIComponent(path)}`,
      },
    );
    const ding = await dingtalkRuntime.createTodo({ subject: 'x' });
    expect(ding.content).toContain(
      '[用钉钉登录](https://chat.example.com/dingtalk/sso?redirect=%2F)',
    );
    expect(ding.content).not.toMatch(/\]\(<http/);

    const adminRuntime = createDingtalkWorkspaceRuntime(
      makeService({
        createTodo: vi.fn().mockRejectedValue(coded('DINGTALK_FEATURE_DISABLED')),
      }),
    );
    const disabled = await adminRuntime.createTodo({ subject: 'x' });
    expect(disabled.content).toContain('[IM 连接器设置](/admin/system/general?tab=im-connectors)');

    const applyUrl = 'https://open-dev.dingtalk.com/appscope/apply?content=abc';
    const forbiddenRuntime = createDingtalkWorkspaceRuntime(
      makeService({
        createTodo: vi
          .fn()
          .mockRejectedValue(coded('DINGTALK_FORBIDDEN', 'DINGTALK_FORBIDDEN', { applyUrl })),
      }),
    );
    const forbidden = await forbiddenRuntime.createTodo({ subject: 'x' });
    expect(forbidden.content).toContain(`[申请权限](${applyUrl})`);

    const inactive = createDingtalkWorkspaceRuntime(
      makeService({
        createTodo: vi.fn().mockRejectedValue(coded('DINGTALK_IDENTITY_INACTIVE')),
      }),
    );
    expect((await inactive.createTodo({ subject: 'x' })).content).toContain(
      '[钉钉管理后台](https://oa.dingtalk.com/)',
    );
  });

  it('formats a completeTodos result and does not call the single API when the batch exists', async () => {
    const completeTodo = vi.fn();
    const completeTodos = vi.fn().mockResolvedValue({
      items: [
        { id: 't1', ok: true, title: '写周报' },
        { errorCode: 'DINGTALK_NOT_FOUND', id: 't2', ok: false },
        { id: 't3', ok: false, skipped: true },
      ],
    });
    const runtime = createDingtalkWorkspaceRuntime(makeService({ completeTodo, completeTodos }));
    const result = await runtime.completeTodos({ taskIds: ['t1', 't2', 't3'] });

    expect(completeTodo).not.toHaveBeenCalled();
    expect(completeTodos).toHaveBeenCalledWith({ taskIds: ['t1', 't2', 't3'] });
    expect(result.success).toBe(true);
    expect(result.content).toBe(
      [
        '已完成 1 项待办，2 项失败',
        '✓ 写周报',
        '✗ t2：未找到该待办或日程（DINGTALK_NOT_FOUND）。请先 listTodos / listEvents 确认 id，且只能操作通过本工具创建的待办。',
        '✗ t3：未执行',
      ].join('\n'),
    );
    expect(result.state).toMatchObject({
      action: 'completeTodos',
      failed: 2,
      kind: 'batchWrite',
      succeeded: 1,
      summary: '已完成 1 项待办，2 项失败',
      total: 3,
    });
    const items = (result.state as { items: Array<Record<string, unknown>> }).items;
    expect(items[1]).toEqual({
      error: '没有找到该待办',
      errorCode: 'DINGTALK_NOT_FOUND',
      id: 't2',
      ok: false,
    });
    expect(items[2]).toEqual({ error: '未执行', id: 't3', ok: false });
    expect(String(items[1]?.error)).not.toMatch(/DINGTALK_|listTodos|不要向用户/);
  });

  it('returns VALIDATION before any todo write when ids are duplicated', async () => {
    const completeTodos = vi.fn();
    const runtime = createDingtalkWorkspaceRuntime(makeService({ completeTodos }));
    const result = await runtime.completeTodos({ taskIds: ['t1', 't1'] });
    expect(completeTodos).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: 'VALIDATION', message: '待办 id 不能重复。' });
  });

  it('marks an all-failed deleteTodos batch unsuccessful with the first error', async () => {
    const deleteTodos = vi.fn().mockResolvedValue({
      items: [{ errorCode: 'DINGTALK_FORBIDDEN', id: 't1', ok: false }],
    });
    const runtime = createDingtalkWorkspaceRuntime(makeService({ deleteTodos }));
    const result = await runtime.deleteTodos({ taskIds: ['t1'] });
    expect(result.success).toBe(false);
    expect(result.content.split('\n')[0]).toBe('已删除 0 项待办，1 项失败');
    expect(result.error).toMatchObject({ code: 'DINGTALK_FORBIDDEN' });
    expect(String(result.error?.message)).toContain('没有权限执行该操作');
  });

  it('falls back to sequential completeTodo and stops on rate limit', async () => {
    const completeTodo = vi
      .fn()
      .mockResolvedValueOnce({ subject: '写周报' })
      .mockRejectedValueOnce(coded('DINGTALK_RATE_LIMITED'));
    const runtime = createDingtalkWorkspaceRuntime(makeService({ completeTodo }));
    const result = await runtime.completeTodos({ taskIds: ['t1', 't2', 't3'] });
    expect(completeTodo).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(result.content).toContain('✓ 写周报');
    expect(result.content).toContain('✗ t2：钉钉接口限流');
    expect(result.content).toContain('DINGTALK_RATE_LIMITED');
    expect(result.content).toContain('✗ t3：未执行');
    const items = (result.state as { items: Array<Record<string, unknown>> }).items;
    expect(items[1]).toEqual({
      error: '请求过于频繁',
      errorCode: 'DINGTALK_RATE_LIMITED',
      id: 't2',
      ok: false,
    });
    expect(String(items[1]?.error)).not.toMatch(/DINGTALK_|不要并行/);
  });

  it('puts a sanitized apply link on a forbidden batch item', async () => {
    const applyUrl = 'https://open-dev.dingtalk.com/appscope/apply?content=abc';
    const deleteTodos = vi.fn().mockResolvedValue({
      items: [
        { applyUrl, errorCode: 'DINGTALK_FORBIDDEN', id: 't1', ok: false, title: '写周报' },
        {
          applyUrl: 'https://evil.example/phish',
          errorCode: 'DINGTALK_NOT_FOUND',
          id: 't2',
          ok: false,
        },
      ],
    });
    const runtime = createDingtalkWorkspaceRuntime(makeService({ deleteTodos }));
    const result = await runtime.deleteTodos({ taskIds: ['t1', 't2'] });
    expect(result.content).toContain('✗ 写周报：');
    expect(result.content).toContain(`[申请权限](${applyUrl})`);
    expect(result.content).not.toContain('evil.example');
    const items = (result.state as { items: Array<Record<string, unknown>> }).items;
    expect(items[0]).toMatchObject({
      actionLabel: '申请权限',
      actionUrl: applyUrl,
      error: '没有权限执行该操作',
      errorCode: 'DINGTALK_FORBIDDEN',
      id: 't1',
      ok: false,
      title: '写周报',
    });
    expect(items[1]).toEqual({
      error: '没有找到该待办',
      errorCode: 'DINGTALK_NOT_FOUND',
      id: 't2',
      ok: false,
    });
    expect(String(items[0]?.error)).not.toContain(applyUrl);
    expect(JSON.stringify(items)).not.toContain('evil.example');
  });

  it('continues a fallback batch after a creator 403 and stops on an app-permission 403', async () => {
    const continued = vi
      .fn()
      .mockRejectedValueOnce(coded('DINGTALK_FORBIDDEN', 'not creator'))
      .mockResolvedValueOnce({ subject: '对账' });
    const runtime = createDingtalkWorkspaceRuntime(makeService({ completeTodo: continued }));
    const kept = await runtime.completeTodos({ taskIds: ['t1', 't2'] });
    expect(continued).toHaveBeenCalledTimes(2);
    expect(kept.content).toContain('✓ 对账');
    expect(kept.content).not.toContain('未执行');

    const applyUrl = 'https://open-dev.dingtalk.com/appscope/apply?content=abc';
    const stopped = vi.fn().mockRejectedValueOnce(
      coded('DINGTALK_FORBIDDEN', 'DINGTALK_FORBIDDEN', {
        applyUrl,
        missingScopes: ['Todo.Todo.Write'],
      }),
    );
    const stopping = createDingtalkWorkspaceRuntime(makeService({ deleteTodo: stopped }));
    const result = await stopping.deleteTodos({ taskIds: ['t1', 't2'] });
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(result.content).toContain(`[申请权限](${applyUrl})`);
    expect(result.content).toContain('✗ t2：未执行');
  });

  it('stops a fallback todo batch after two consecutive unavailable responses', async () => {
    const completeTodo = vi
      .fn()
      .mockRejectedValueOnce(coded('DINGTALK_UNAVAILABLE'))
      .mockResolvedValueOnce({ subject: '对账' })
      .mockRejectedValueOnce(coded('DINGTALK_UNAVAILABLE'))
      .mockRejectedValueOnce(coded('DINGTALK_UNAVAILABLE'));
    const runtime = createDingtalkWorkspaceRuntime(makeService({ completeTodo }));
    const result = await runtime.completeTodos({ taskIds: ['a', 'b', 'c', 'd', 'e'] });
    expect(completeTodo).toHaveBeenCalledTimes(4);
    expect(result.content).toContain('✓ 对账');
    expect(result.content).toContain('✗ e：未执行');
    expect(result.content).not.toContain('✗ d：未执行');
  });

  it('stops a fallback batch when a lambda 403 carries applyUrl in errorData', async () => {
    const applyUrl = 'https://open-dev.dingtalk.com/appscope/apply?content=abc';
    const completeTodo = vi.fn().mockRejectedValue({
      data: {
        code: 'FORBIDDEN',
        errorData: {
          applyUrl,
          code: 'DINGTALK_FORBIDDEN',
          missingScopes: ['Todo.Todo.Write'],
        },
      },
      message: 'DINGTALK_FORBIDDEN',
    });
    const runtime = createDingtalkWorkspaceRuntime(makeService({ completeTodo }));
    const result = await runtime.completeTodos({ taskIds: ['t1', 't2'] });
    expect(completeTodo).toHaveBeenCalledTimes(1);
    expect(result.content).toContain(`[申请权限](${applyUrl})`);
    expect(result.content).toContain('✗ t2：未执行');
    const items = (result.state as { items: Array<Record<string, unknown>> }).items;
    expect(items[0]).toMatchObject({
      actionLabel: '申请权限',
      actionUrl: applyUrl,
      error: '没有权限执行该操作',
      errorCode: 'DINGTALK_FORBIDDEN',
    });
    expect(String(items[0]?.error)).not.toMatch(/DINGTALK_|listTodos/);
  });

  it('puts a settings link on a disabled batch item', async () => {
    const settings = 'https://aihub.example.com/admin/system/general?tab=im-connectors';
    const completeTodos = vi.fn().mockResolvedValue({
      items: [{ errorCode: 'DINGTALK_FEATURE_DISABLED', id: 't1', ok: false }],
    });
    const runtime = createDingtalkWorkspaceRuntime(makeService({ completeTodos }), {
      resolveLink: (path) => (path === '/admin/system/general?tab=im-connectors' ? settings : path),
    });
    const result = await runtime.completeTodos({ taskIds: ['t1'] });
    const item = (result.state as { items: Array<Record<string, unknown>> }).items[0];
    expect(item).toMatchObject({
      actionLabel: '前往设置',
      actionUrl: settings,
      error: '该能力未开启',
      errorCode: 'DINGTALK_FEATURE_DISABLED',
    });
    expect(String(item?.error)).not.toMatch(/DINGTALK_|不要向用户/);
    expect(result.content).toContain(settings);

    const relative = createDingtalkWorkspaceRuntime(
      makeService({
        completeTodos: vi.fn().mockResolvedValue({
          items: [{ errorCode: 'DINGTALK_FEATURE_DISABLED', id: 't1', ok: false }],
        }),
      }),
    );
    const web = await relative.completeTodos({ taskIds: ['t1'] });
    expect((web.state as { items: Array<Record<string, unknown>> }).items[0]).toMatchObject({
      actionLabel: '前往设置',
      actionUrl: '/admin/system/general?tab=im-connectors',
      error: '该能力未开启',
    });
  });
});
