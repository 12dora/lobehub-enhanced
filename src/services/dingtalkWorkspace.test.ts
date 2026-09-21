import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { dingtalkWorkspaceService } from './dingtalkWorkspace';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    dingtalkWorkspace: {
      calendar: {
        createEvent: { mutate: vi.fn() },
        deleteEvent: { mutate: vi.fn() },
        getEvent: { query: vi.fn() },
        listEvents: { query: vi.fn() },
        listMeetingRooms: { query: vi.fn() },
        queryFreeBusy: { query: vi.fn() },
        respondEvent: { mutate: vi.fn() },
        updateEvent: { mutate: vi.fn() },
      },
      preview: { mutate: vi.fn() },
      searchDirectory: { query: vi.fn() },
      todo: {
        completeTodo: { mutate: vi.fn() },
        createTodo: { mutate: vi.fn() },
        deleteTodo: { mutate: vi.fn() },
        listTodos: { query: vi.fn() },
        updateTodo: { mutate: vi.fn() },
      },
    },
  },
}));

const workspace = (lambdaClient as any).dingtalkWorkspace;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dingtalkWorkspaceService', () => {
  it('searchDirectory and listTodos query with params', async () => {
    workspace.searchDirectory.query.mockResolvedValueOnce({ users: [] });
    workspace.todo.listTodos.query.mockResolvedValueOnce({ items: [] });
    await dingtalkWorkspaceService.searchDirectory({ q: '安环' });
    await dingtalkWorkspaceService.listTodos({ done: false });
    expect(workspace.searchDirectory.query).toHaveBeenCalledWith({ q: '安环' });
    expect(workspace.todo.listTodos.query).toHaveBeenCalledWith({ done: false });
  });

  it('todo writes mutate the nested todo router', async () => {
    await dingtalkWorkspaceService.createTodo({ subject: '交周报' });
    await dingtalkWorkspaceService.updateTodo({ subject: '改', taskId: 'todo-1' });
    await dingtalkWorkspaceService.completeTodo({ taskId: 'todo-1' });
    await dingtalkWorkspaceService.deleteTodo({ taskId: 'todo-1' });
    expect(workspace.todo.createTodo.mutate).toHaveBeenCalledWith({ subject: '交周报' });
    expect(workspace.todo.updateTodo.mutate).toHaveBeenCalledWith({
      subject: '改',
      taskId: 'todo-1',
    });
    expect(workspace.todo.completeTodo.mutate).toHaveBeenCalledWith({ taskId: 'todo-1' });
    expect(workspace.todo.deleteTodo.mutate).toHaveBeenCalledWith({ taskId: 'todo-1' });
  });

  it('forwards updateTodo dueTime null to clear the due time', async () => {
    await dingtalkWorkspaceService.updateTodo({ dueTime: null, taskId: 'todo-1' });
    expect(workspace.todo.updateTodo.mutate).toHaveBeenCalledWith({
      dueTime: null,
      taskId: 'todo-1',
    });
  });

  it('calendar reads query and writes mutate', async () => {
    const range = { from: '2026-09-22T09:00:00+08:00', to: '2026-09-22T18:00:00+08:00' };
    await dingtalkWorkspaceService.listEvents(range);
    await dingtalkWorkspaceService.getEvent({ eventId: 'evt-1' });
    await dingtalkWorkspaceService.queryFreeBusy({
      ...range,
      staffTokens: ['staff:1'],
    });
    await dingtalkWorkspaceService.listMeetingRooms();
    await dingtalkWorkspaceService.createEvent({
      end: range.to,
      start: range.from,
      summary: '同步',
    });
    await dingtalkWorkspaceService.respondEvent({
      eventId: 'evt-1',
      responseStatus: 'accepted',
    });
    expect(workspace.calendar.listEvents.query).toHaveBeenCalledWith(range);
    expect(workspace.calendar.getEvent.query).toHaveBeenCalledWith({ eventId: 'evt-1' });
    expect(workspace.calendar.listMeetingRooms.query).toHaveBeenCalledWith();
    expect(workspace.calendar.createEvent.mutate).toHaveBeenCalledWith({
      end: range.to,
      start: range.from,
      summary: '同步',
    });
    expect(workspace.calendar.respondEvent.mutate).toHaveBeenCalledWith({
      eventId: 'evt-1',
      responseStatus: 'accepted',
    });
  });

  it('preview mutates apiName and args for confirm cards', async () => {
    workspace.preview.mutate.mockResolvedValueOnce({
      actingAs: { deptPath: '安环部', name: '陈柠' },
      danger: false,
      lines: [],
      title: '创建待办',
      warnings: [],
    });
    await dingtalkWorkspaceService.preview({
      apiName: 'createTodo',
      args: { subject: '交周报' },
    });
    expect(workspace.preview.mutate).toHaveBeenCalledWith({
      apiName: 'createTodo',
      args: { subject: '交周报' },
    });
  });

  it('maps reminder minutes to DingTalk reminder objects', async () => {
    await dingtalkWorkspaceService.createEvent({
      end: '2026-09-22T11:00:00+08:00',
      reminders: [15],
      start: '2026-09-22T10:00:00+08:00',
      summary: '同步',
    });
    expect(workspace.calendar.createEvent.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        reminders: [{ method: 'dingtalk', minutes: 15 }],
      }),
    );
  });
});
