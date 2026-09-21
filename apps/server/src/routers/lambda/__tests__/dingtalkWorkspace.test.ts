// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTodo = {
  completeTodo: vi.fn(),
  createTodo: vi.fn(),
  deleteTodo: vi.fn(),
  listTodos: vi.fn(),
  preview: vi.fn(),
  updateTodo: vi.fn(),
};

const mockCalendar = {
  createEvent: vi.fn(),
  deleteEvent: vi.fn(),
  getEvent: vi.fn(),
  listEvents: vi.fn(),
  listMeetingRooms: vi.fn(),
  preview: vi.fn(),
  queryFreeBusy: vi.fn(),
  respondEvent: vi.fn(),
  updateEvent: vi.fn(),
};

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

vi.mock('@/server/enterprise/services/dingtalkWorkspace/todo', () => ({
  DingtalkTodoService: vi.fn(() => mockTodo),
  isTodoWriteApiName: (value: string) =>
    ['createTodo', 'updateTodo', 'completeTodo', 'deleteTodo'].includes(value),
}));

vi.mock('@/server/enterprise/services/dingtalkWorkspace/calendar', () => ({
  DingtalkCalendarService: vi.fn(() => mockCalendar),
  isCalendarWriteApiName: (value: string) =>
    ['createEvent', 'updateEvent', 'deleteEvent', 'respondEvent'].includes(value),
}));

const { dingtalkWorkspaceRouter } = await import('../dingtalkWorkspace');
const { DingtalkWorkspaceError } =
  await import('@/server/enterprise/services/dingtalkWorkspace/errors');

const createCaller = () =>
  dingtalkWorkspaceRouter.createCaller({ serverDB: {}, userId: 'user-1' } as never);

describe('dingtalkWorkspaceRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('nests todo and calendar procedures', async () => {
    mockTodo.listTodos.mockResolvedValueOnce({ items: [], truncated: false });
    mockCalendar.listMeetingRooms.mockResolvedValueOnce({ items: [] });
    await createCaller().todo.listTodos({});
    await createCaller().calendar.listMeetingRooms();
    expect(mockTodo.listTodos).toHaveBeenCalledWith({});
    expect(mockCalendar.listMeetingRooms).toHaveBeenCalled();
  });

  it('preview dispatches todo writes to the todo service', async () => {
    mockTodo.preview.mockResolvedValueOnce({
      actingAs: { deptPath: '', name: '张三' },
      danger: false,
      lines: [],
      title: '创建待办',
      warnings: [],
    });
    await createCaller().preview({ apiName: 'createTodo', args: { subject: '对账' } });
    expect(mockTodo.preview).toHaveBeenCalledWith({
      apiName: 'createTodo',
      args: { subject: '对账' },
    });
  });

  it('maps DingtalkWorkspaceError to a stable code without leaking upstream text', async () => {
    mockTodo.createTodo.mockRejectedValueOnce(
      new DingtalkWorkspaceError('DINGTALK_FORBIDDEN', 'AccessDenied'),
    );
    await expect(createCaller().todo.createTodo({ subject: 'x' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'DINGTALK_FORBIDDEN',
    });
  });

  it('maps unknown failures to DINGTALK_UNAVAILABLE', async () => {
    mockTodo.createTodo.mockRejectedValueOnce(new Error('ECONNRESET postgres://secret'));
    await expect(createCaller().todo.createTodo({ subject: 'x' })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'DINGTALK_UNAVAILABLE',
    });
  });

  it('accepts createEvent reminders as minute numbers', async () => {
    mockCalendar.createEvent.mockResolvedValueOnce({ id: 'evt-1' });
    await createCaller().calendar.createEvent({
      end: '2026-09-22T11:00:00+08:00',
      reminders: [15],
      start: '2026-09-22T10:00:00+08:00',
      summary: '会',
    });
    expect(mockCalendar.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ reminders: [15] }),
    );
  });

  it('accepts updateTodo dueTime null and 101 executorTokens', async () => {
    mockTodo.updateTodo.mockResolvedValueOnce({ ok: true, taskId: 't1' });
    const tokens = Array.from({ length: 101 }, (_, index) => `staff:e${index}`);
    await createCaller().todo.updateTodo({
      dueTime: null,
      executorTokens: tokens,
      taskId: 't1',
    });
    expect(mockTodo.updateTodo).toHaveBeenCalledWith({
      dueTime: null,
      executorTokens: tokens,
      taskId: 't1',
    });
  });

  it('forwards DINGTALK_AMBIGUOUS candidates in error data', async () => {
    const error = new DingtalkWorkspaceError('DINGTALK_AMBIGUOUS') as InstanceType<
      typeof DingtalkWorkspaceError
    > & {
      candidates: Array<{ name: string; staffId: string }>;
    };
    error.candidates = [{ name: '李四', staffId: 'a' }];
    mockCalendar.createEvent.mockRejectedValueOnce(error);
    await expect(
      createCaller().calendar.createEvent({
        end: '2026-09-22T11:00:00+08:00',
        start: '2026-09-22T10:00:00+08:00',
        summary: '会',
      }),
    ).rejects.toMatchObject({
      cause: { data: { candidates: [{ name: '李四', staffId: 'a' }], code: 'DINGTALK_AMBIGUOUS' } },
      message: 'DINGTALK_AMBIGUOUS',
    });
  });

  it('forwards DINGTALK_ROOM_UNAVAILABLE roomIssues in error data', async () => {
    const error = new DingtalkWorkspaceError('DINGTALK_ROOM_UNAVAILABLE') as InstanceType<
      typeof DingtalkWorkspaceError
    > & {
      roomIssues: Array<{ reason: string; roomName: string }>;
      timeApplied: boolean;
    };
    error.roomIssues = [{ reason: '预订时长不得少于 30 分钟', roomName: '捷发2楼会议室' }];
    error.timeApplied = true;
    mockCalendar.updateEvent.mockRejectedValueOnce(error);
    await expect(
      createCaller().calendar.updateEvent({
        eventId: 'evt-1',
        roomIds: ['room-B'],
        start: '2026-09-22T14:00:00+08:00',
      }),
    ).rejects.toMatchObject({
      cause: {
        data: {
          code: 'DINGTALK_ROOM_UNAVAILABLE',
          roomIssues: [{ reason: '预订时长不得少于 30 分钟', roomName: '捷发2楼会议室' }],
          timeApplied: true,
        },
      },
      message: 'DINGTALK_ROOM_UNAVAILABLE',
    });
  });
});
