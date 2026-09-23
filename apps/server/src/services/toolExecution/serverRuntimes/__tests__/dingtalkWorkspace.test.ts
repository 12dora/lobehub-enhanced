// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IDingtalkWorkspaceService } from '../dingtalkWorkspace';
import { createDingtalkWorkspaceRuntime, dingtalkWorkspaceRuntime } from '../dingtalkWorkspace';

const mockTodoList = vi.fn();
const mockTodoCreate = vi.fn();
const mockTodoUpdate = vi.fn();
const mockTodoComplete = vi.fn();
const mockTodoDelete = vi.fn();
const mockCalendarListEvents = vi.fn();
const mockCalendarGetEvent = vi.fn();
const mockCalendarQueryFreeBusy = vi.fn();
const mockCalendarListMeetingRooms = vi.fn();
const mockCalendarCreateEvent = vi.fn();
const mockCalendarUpdateEvent = vi.fn();
const mockCalendarDeleteEvent = vi.fn();
const mockCalendarRespondEvent = vi.fn();
const mockSearchDirectory = vi.fn();

vi.mock('@/server/enterprise/services/dingtalkWorkspace/todo', () => ({
  DingtalkTodoService: vi.fn(() => ({
    completeTodo: mockTodoComplete,
    createTodo: mockTodoCreate,
    deleteTodo: mockTodoDelete,
    listTodos: mockTodoList,
    updateTodo: mockTodoUpdate,
  })),
}));

vi.mock('@/server/enterprise/services/dingtalkWorkspace/calendar', () => ({
  DingtalkCalendarService: vi.fn(() => ({
    createEvent: mockCalendarCreateEvent,
    deleteEvent: mockCalendarDeleteEvent,
    getEvent: mockCalendarGetEvent,
    listEvents: mockCalendarListEvents,
    listMeetingRooms: mockCalendarListMeetingRooms,
    queryFreeBusy: mockCalendarQueryFreeBusy,
    respondEvent: mockCalendarRespondEvent,
    updateEvent: mockCalendarUpdateEvent,
  })),
}));

vi.mock('@/server/enterprise/services/reminder', () => ({
  ReminderService: vi.fn(() => ({
    searchDirectory: mockSearchDirectory,
  })),
}));

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

describe('createDingtalkWorkspaceRuntime', () => {
  it('maps createTodo onto the injected service', async () => {
    const createTodo = vi.fn().mockResolvedValue({ subject: '交周报', taskId: 'todo-1' });
    const runtime = createDingtalkWorkspaceRuntime(makeService({ createTodo }));

    const result = await runtime.createTodo({ subject: '交周报' });

    expect(createTodo).toHaveBeenCalledWith({ subject: '交周报' });
    expect(result.success).toBe(true);
    expect(result.content).toContain('todo-1');
  });
});

describe('dingtalkWorkspaceRuntime.factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTodoCreate.mockResolvedValue({ subject: '交周报', taskId: 'todo-1' });
    mockSearchDirectory.mockResolvedValue({
      ambiguous: false,
      departments: [],
      serverNow: '2026-09-21T12:00:00+08:00',
      users: [],
    });
    mockCalendarCreateEvent.mockResolvedValue({ eventId: 'evt-1' });
  });

  it('constructs todo/calendar/directory services with db and userId', async () => {
    const { DingtalkTodoService } =
      await import('@/server/enterprise/services/dingtalkWorkspace/todo');
    const { DingtalkCalendarService } =
      await import('@/server/enterprise/services/dingtalkWorkspace/calendar');
    const { ReminderService } = await import('@/server/enterprise/services/reminder');
    const serverDB = {} as never;

    const runtime = await dingtalkWorkspaceRuntime.factory({
      serverDB,
      userId: 'user-1',
    } as never);

    expect(DingtalkTodoService).toHaveBeenCalledWith(serverDB, 'user-1');
    expect(DingtalkCalendarService).toHaveBeenCalledWith(serverDB, 'user-1');
    expect(ReminderService).toHaveBeenCalledWith(serverDB, 'user-1');

    await runtime.createTodo({ subject: '交周报' });
    expect(mockTodoCreate).toHaveBeenCalledWith({ subject: '交周报' });

    mockTodoList.mockResolvedValue({ appTodos: [], notes: [] });
    await runtime.listTodos({ done: false, refresh: true });
    expect(mockTodoList).toHaveBeenCalledWith({ done: false, refresh: true });

    await runtime.searchDirectory({ q: '陈柠' });
    expect(mockSearchDirectory).toHaveBeenCalledWith('陈柠', undefined);

    await runtime.createEvent({
      end: '2026-09-22T11:00:00+08:00',
      start: '2026-09-22T10:00:00+08:00',
      summary: '同步',
    });
    expect(mockCalendarCreateEvent).toHaveBeenCalledWith({
      end: '2026-09-22T11:00:00+08:00',
      start: '2026-09-22T10:00:00+08:00',
      summary: '同步',
    });
  });

  it('maps reminder minutes to DingTalk reminder objects before createEvent', async () => {
    const runtime = await dingtalkWorkspaceRuntime.factory({
      serverDB: {} as never,
      userId: 'user-1',
    } as never);

    await runtime.createEvent({
      end: '2026-09-22T11:00:00+08:00',
      reminders: [15],
      start: '2026-09-22T10:00:00+08:00',
      summary: '同步',
    });
    expect(mockCalendarCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        reminders: [{ method: 'dingtalk', minutes: 15 }],
      }),
    );
  });

  it('requires userId and serverDB', async () => {
    await expect(dingtalkWorkspaceRuntime.factory({ userId: 'user-1' } as never)).rejects.toThrow(
      'userId and serverDB are required',
    );
  });
});
