/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchDirectory = vi.fn().mockResolvedValue({
  ambiguous: false,
  departments: [],
  serverNow: '2026-09-21T12:00:00+08:00',
  users: [],
});
const listTodos = vi.fn().mockResolvedValue({ items: [] });
const createTodo = vi.fn();
const updateTodo = vi.fn();
const completeTodo = vi.fn();
const deleteTodo = vi.fn();
const listEvents = vi.fn().mockResolvedValue({ items: [] });
const getEvent = vi.fn();
const queryFreeBusy = vi.fn().mockResolvedValue({ people: [] });
const listMeetingRooms = vi.fn().mockResolvedValue({ items: [] });
const createEvent = vi.fn();
const updateEvent = vi.fn();
const deleteEvent = vi.fn();
const respondEvent = vi.fn();
const preview = vi.fn();

vi.mock('@/services/dingtalkWorkspace', () => ({
  dingtalkWorkspaceService: {
    completeTodo,
    createEvent,
    createTodo,
    deleteEvent,
    deleteTodo,
    getEvent,
    listEvents,
    listMeetingRooms,
    listTodos,
    preview,
    queryFreeBusy,
    respondEvent,
    searchDirectory,
    updateEvent,
    updateTodo,
  },
}));

const { dingtalkWorkspaceExecutor } = await import('./index');

describe('dingtalkWorkspaceExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchDirectory.mockResolvedValue({
      ambiguous: false,
      departments: [],
      serverNow: '2026-09-21T12:00:00+08:00',
      users: [],
    });
  });

  it('forwards listTodos done and refresh', async () => {
    await dingtalkWorkspaceExecutor.listTodos({ done: false, refresh: true });
    expect(listTodos).toHaveBeenCalledWith({ done: false, refresh: true });
  });

  it('passes { q, kind } to dingtalkWorkspaceService.searchDirectory', async () => {
    await dingtalkWorkspaceExecutor.searchDirectory({ kind: 'user', q: '安环' });
    expect(searchDirectory).toHaveBeenCalledWith({ kind: 'user', q: '安环' });
  });

  it('forwards createTodo subject and dueTime', async () => {
    createTodo.mockResolvedValueOnce({ subject: '交周报', taskId: 'todo-1' });
    await dingtalkWorkspaceExecutor.createTodo({
      dueTime: '2026-09-22T18:00:00+08:00',
      subject: '交周报',
    });
    expect(createTodo).toHaveBeenCalledWith({
      dueTime: '2026-09-22T18:00:00+08:00',
      subject: '交周报',
    });
  });

  it('forwards createEvent and completeTodo ids', async () => {
    createEvent.mockResolvedValueOnce({ eventId: 'evt-1', summary: '同步' });
    completeTodo.mockResolvedValueOnce({ taskId: 'todo-1' });
    await dingtalkWorkspaceExecutor.createEvent({
      end: '2026-09-22T11:00:00+08:00',
      start: '2026-09-22T10:00:00+08:00',
      summary: '同步',
    });
    await dingtalkWorkspaceExecutor.completeTodo({ taskId: 'todo-1' });
    expect(createEvent).toHaveBeenCalledWith({
      end: '2026-09-22T11:00:00+08:00',
      start: '2026-09-22T10:00:00+08:00',
      summary: '同步',
    });
    expect(completeTodo).toHaveBeenCalledWith({ taskId: 'todo-1' });
  });

  it('forwards updateTodo dueTime null', async () => {
    updateTodo.mockResolvedValueOnce({ ok: true, taskId: 'todo-1' });
    await dingtalkWorkspaceExecutor.updateTodo({ dueTime: null, taskId: 'todo-1' });
    expect(updateTodo).toHaveBeenCalledWith({ dueTime: null, taskId: 'todo-1' });
  });
});
