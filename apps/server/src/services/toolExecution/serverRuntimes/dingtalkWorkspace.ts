import type { IDingtalkWorkspaceService } from '@lobechat/builtin-tool-dingtalk-workspace/executionRuntime';
import {
  createDingtalkWorkspaceRuntime,
  DingtalkWorkspaceExecutionRuntime,
} from '@lobechat/builtin-tool-dingtalk-workspace/executionRuntime';
import { DingtalkWorkspaceIdentifier } from '@lobechat/builtin-tool-dingtalk-workspace/manifest';

import { serverAppLinkResolver } from '@/server/utils/appLinks';

import type { ServerRuntimeRegistration } from './types';

export { createDingtalkWorkspaceRuntime, DingtalkWorkspaceExecutionRuntime };
export type { IDingtalkWorkspaceService };

export const dingtalkWorkspaceRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    const { serverDB, userId } = context;
    if (!userId || !serverDB) {
      throw new Error('userId and serverDB are required for DingTalk workspace execution');
    }

    // Domain services are owned by DT-tc-svc. Loaded lazily so unit tests can
    // inject a mock via createDingtalkWorkspaceRuntime without requiring them.
    const [{ DingtalkTodoService }, { DingtalkCalendarService }, { ReminderService }] =
      await Promise.all([
        import('@/server/enterprise/services/dingtalkWorkspace/todo'),
        import('@/server/enterprise/services/dingtalkWorkspace/calendar'),
        import('@/server/enterprise/services/reminder'),
      ]);

    const todo = new DingtalkTodoService(serverDB, userId, context.botPlatform);
    const calendar = new DingtalkCalendarService(serverDB, userId);
    const directory = new ReminderService(serverDB, userId);

    const normalizeReminder = (item: number | { method?: string; minutes: number }) =>
      typeof item === 'number'
        ? { method: 'dingtalk' as const, minutes: item }
        : { method: item.method ?? 'dingtalk', minutes: item.minutes };

    const withReminders = <
      T extends { reminders?: Array<number | { method?: string; minutes: number }> },
    >(
      args: T,
    ) => (args.reminders ? { ...args, reminders: args.reminders.map(normalizeReminder) } : args);

    return createDingtalkWorkspaceRuntime(
      {
        completeTodo: (args) => todo.completeTodo(args),
        completeTodos: (args) => todo.completeTodos(args),
        createEvent: (args) => calendar.createEvent(withReminders(args)),
        createTodo: (args) => todo.createTodo(args),
        deleteEvent: (args) => calendar.deleteEvent(args),
        deleteTodo: (args) => todo.deleteTodo(args),
        deleteTodos: (args) => todo.deleteTodos(args),
        getEvent: (args) => calendar.getEvent(args),
        listEvents: (args) => calendar.listEvents(args),
        listMeetingRooms: () => calendar.listMeetingRooms(),
        listTodos: (args) => todo.listTodos(args),
        queryFreeBusy: (args) => calendar.queryFreeBusy(args),
        respondEvent: (args) => calendar.respondEvent(args),
        searchDirectory: (q, kind) => directory.searchDirectory(q, kind),
        updateEvent: (args) => calendar.updateEvent(withReminders(args)),
        updateTodo: (args) => todo.updateTodo(args),
      },
      {
        platform: context.botPlatform,
        resolveLink: serverAppLinkResolver(context.botPlatform),
      },
    );
  },
  identifier: DingtalkWorkspaceIdentifier,
};
