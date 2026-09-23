import { lambdaClient } from '@/libs/trpc/client';

type ReminderInput = number | { method?: string; minutes: number };

const normalizeReminder = (item: ReminderInput) =>
  typeof item === 'number'
    ? { method: 'dingtalk' as const, minutes: item }
    : { method: item.method ?? ('dingtalk' as const), minutes: item.minutes };

const withReminders = <T extends { reminders?: ReminderInput[] }>(params: T) =>
  params.reminders ? { ...params, reminders: params.reminders.map(normalizeReminder) } : params;

/**
 * Client access to the 钉钉日程与待办 lambda router.
 * Mirrors `src/services/reminder.ts`: thin wrappers over `lambdaClient`.
 */
class DingtalkWorkspaceService {
  searchDirectory = async (params: { kind?: 'department' | 'user'; q: string }) => {
    return lambdaClient.dingtalkWorkspace.searchDirectory.query(params);
  };

  listTodos = async (params: { done?: boolean; refresh?: boolean } = {}) => {
    return lambdaClient.dingtalkWorkspace.todo.listTodos.query(params);
  };

  createTodo = async (params: {
    description?: string;
    dueTime?: string;
    executorTokens?: string[];
    priority?: 10 | 20 | 30 | 40;
    subject: string;
  }) => {
    return lambdaClient.dingtalkWorkspace.todo.createTodo.mutate(params);
  };

  updateTodo = async (params: {
    description?: string;
    done?: boolean;
    dueTime?: string | null;
    executorTokens?: string[];
    priority?: 10 | 20 | 30 | 40;
    subject?: string;
    taskId: string;
  }) => {
    return lambdaClient.dingtalkWorkspace.todo.updateTodo.mutate(params);
  };

  completeTodo = async (params: { taskId: string }) => {
    return lambdaClient.dingtalkWorkspace.todo.completeTodo.mutate(params);
  };

  deleteTodo = async (params: { taskId: string }) => {
    return lambdaClient.dingtalkWorkspace.todo.deleteTodo.mutate(params);
  };

  listEvents = async (params: { from: string; to: string }) => {
    return lambdaClient.dingtalkWorkspace.calendar.listEvents.query(params);
  };

  getEvent = async (params: { eventId: string }) => {
    return lambdaClient.dingtalkWorkspace.calendar.getEvent.query(params);
  };

  queryFreeBusy = async (params: { from: string; staffTokens: string[]; to: string }) => {
    return lambdaClient.dingtalkWorkspace.calendar.queryFreeBusy.query(params);
  };

  listMeetingRooms = async () => {
    return lambdaClient.dingtalkWorkspace.calendar.listMeetingRooms.query();
  };

  createEvent = async (params: {
    attendeeTokens?: string[];
    description?: string;
    end: string;
    isAllDay?: boolean;
    location?: string;
    onlineMeeting?: boolean;
    reminders?: number[];
    roomIds?: string[];
    start: string;
    summary: string;
  }) => {
    return lambdaClient.dingtalkWorkspace.calendar.createEvent.mutate(withReminders(params));
  };

  updateEvent = async (params: {
    attendeeTokens?: string[];
    description?: string;
    end?: string;
    eventId: string;
    isAllDay?: boolean;
    location?: string;
    onlineMeeting?: boolean;
    reminders?: number[];
    roomIds?: string[];
    start?: string;
    summary?: string;
  }) => {
    return lambdaClient.dingtalkWorkspace.calendar.updateEvent.mutate(withReminders(params));
  };

  deleteEvent = async (params: { eventId: string }) => {
    return lambdaClient.dingtalkWorkspace.calendar.deleteEvent.mutate(params);
  };

  respondEvent = async (params: {
    eventId: string;
    responseStatus: 'accepted' | 'declined' | 'needsAction' | 'tentative';
  }) => {
    return lambdaClient.dingtalkWorkspace.calendar.respondEvent.mutate(params);
  };

  preview = async (params: { apiName: string; args: Record<string, unknown> }) => {
    return lambdaClient.dingtalkWorkspace.preview.mutate(params);
  };
}

export const dingtalkWorkspaceService = new DingtalkWorkspaceService();
