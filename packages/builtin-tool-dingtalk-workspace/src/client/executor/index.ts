import type { BuiltinServerRuntimeOutput, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';
import debug from 'debug';

import { dingtalkWorkspaceService } from '@/services/dingtalkWorkspace';

import type { IDingtalkWorkspaceService } from '../../ExecutionRuntime';
import { DingtalkWorkspaceExecutionRuntime } from '../../ExecutionRuntime';
import { DingtalkWorkspaceIdentifier } from '../../manifest';
import type {
  CompleteTodoParams,
  CreateEventParams,
  CreateTodoParams,
  DeleteEventParams,
  DeleteTodoParams,
  GetEventParams,
  ListEventsParams,
  ListMeetingRoomsParams,
  ListTodosParams,
  QueryFreeBusyParams,
  RespondEventParams,
  SearchDirectoryParams,
  UpdateEventParams,
  UpdateTodoParams,
} from '../../types';
import { DingtalkWorkspaceApiName } from '../../types';

const log = debug('lobe-dingtalk-workspace:executor');

const requireResult = <T>(value: T | undefined, message: string): T => {
  if (value === undefined) throw new Error(message);
  return value;
};

const loadWorkspaceService = async (): Promise<IDingtalkWorkspaceService> => {
  // Static app import like the reminder tool: the desktop (vite/rolldown) bundle cannot
  // resolve a dynamic `@/` import from inside a workspace package.
  return {
    completeTodo: (args) => dingtalkWorkspaceService.completeTodo(args),
    createEvent: (args) => dingtalkWorkspaceService.createEvent(args),
    createTodo: (args) => dingtalkWorkspaceService.createTodo(args),
    deleteEvent: (args) => dingtalkWorkspaceService.deleteEvent(args),
    deleteTodo: (args) => dingtalkWorkspaceService.deleteTodo(args),
    getEvent: (args) => dingtalkWorkspaceService.getEvent(args),
    listEvents: (args) => dingtalkWorkspaceService.listEvents(args),
    listMeetingRooms: () => dingtalkWorkspaceService.listMeetingRooms(),
    listTodos: (args) => dingtalkWorkspaceService.listTodos(args),
    queryFreeBusy: (args) => dingtalkWorkspaceService.queryFreeBusy(args),
    respondEvent: (args) => dingtalkWorkspaceService.respondEvent(args),
    searchDirectory: async (q, kind) =>
      requireResult(
        await dingtalkWorkspaceService.searchDirectory({ kind, q }),
        'Search directory returned no result',
      ),
    updateEvent: (args) => dingtalkWorkspaceService.updateEvent(args),
    updateTodo: (args) => dingtalkWorkspaceService.updateTodo(args),
  };
};

class DingtalkWorkspaceExecutor extends BaseExecutor<typeof DingtalkWorkspaceApiName> {
  readonly identifier = DingtalkWorkspaceIdentifier;
  protected readonly apiEnum = DingtalkWorkspaceApiName;
  private runtimePromise?: Promise<DingtalkWorkspaceExecutionRuntime>;

  private getRuntime() {
    this.runtimePromise ??= loadWorkspaceService().then(
      (service) => new DingtalkWorkspaceExecutionRuntime(service),
    );
    return this.runtimePromise;
  }

  searchDirectory = async (params: SearchDirectoryParams): Promise<BuiltinToolResult> => {
    try {
      log('searchDirectory q=%s kind=%s', params.q, params.kind);
      const runtime = await this.getRuntime();
      return this.toResult(await runtime.searchDirectory(params));
    } catch (error) {
      return this.errorResult(error, 'SearchDirectoryFailed');
    }
  };

  listTodos = async (params: ListTodosParams = {}): Promise<BuiltinToolResult> => {
    try {
      log('listTodos done=%s', params.done);
      const runtime = await this.getRuntime();
      return this.toResult(await runtime.listTodos(params));
    } catch (error) {
      return this.errorResult(error, 'ListTodosFailed');
    }
  };

  createTodo = async (params: CreateTodoParams): Promise<BuiltinToolResult> => {
    try {
      log('createTodo subject=%s', params.subject);
      const runtime = await this.getRuntime();
      return this.toResult(await runtime.createTodo(params));
    } catch (error) {
      return this.errorResult(error, 'CreateTodoFailed');
    }
  };

  updateTodo = async (params: UpdateTodoParams): Promise<BuiltinToolResult> => {
    try {
      log('updateTodo taskId=%s', params.taskId);
      const runtime = await this.getRuntime();
      return this.toResult(await runtime.updateTodo(params));
    } catch (error) {
      return this.errorResult(error, 'UpdateTodoFailed');
    }
  };

  completeTodo = async (params: CompleteTodoParams): Promise<BuiltinToolResult> => {
    try {
      log('completeTodo taskId=%s', params.taskId);
      const runtime = await this.getRuntime();
      return this.toResult(await runtime.completeTodo(params));
    } catch (error) {
      return this.errorResult(error, 'CompleteTodoFailed');
    }
  };

  deleteTodo = async (params: DeleteTodoParams): Promise<BuiltinToolResult> => {
    try {
      log('deleteTodo taskId=%s', params.taskId);
      const runtime = await this.getRuntime();
      return this.toResult(await runtime.deleteTodo(params));
    } catch (error) {
      return this.errorResult(error, 'DeleteTodoFailed');
    }
  };

  listEvents = async (params: ListEventsParams): Promise<BuiltinToolResult> => {
    try {
      log('listEvents from=%s to=%s', params.from, params.to);
      const runtime = await this.getRuntime();
      return this.toResult(await runtime.listEvents(params));
    } catch (error) {
      return this.errorResult(error, 'ListEventsFailed');
    }
  };

  getEvent = async (params: GetEventParams): Promise<BuiltinToolResult> => {
    try {
      log('getEvent eventId=%s', params.eventId);
      const runtime = await this.getRuntime();
      return this.toResult(await runtime.getEvent(params));
    } catch (error) {
      return this.errorResult(error, 'GetEventFailed');
    }
  };

  queryFreeBusy = async (params: QueryFreeBusyParams): Promise<BuiltinToolResult> => {
    try {
      log('queryFreeBusy count=%s', params.staffTokens?.length);
      const runtime = await this.getRuntime();
      return this.toResult(await runtime.queryFreeBusy(params));
    } catch (error) {
      return this.errorResult(error, 'QueryFreeBusyFailed');
    }
  };

  listMeetingRooms = async (_params: ListMeetingRoomsParams = {}): Promise<BuiltinToolResult> => {
    try {
      log('listMeetingRooms');
      const runtime = await this.getRuntime();
      return this.toResult(await runtime.listMeetingRooms());
    } catch (error) {
      return this.errorResult(error, 'ListMeetingRoomsFailed');
    }
  };

  createEvent = async (params: CreateEventParams): Promise<BuiltinToolResult> => {
    try {
      log('createEvent summary=%s', params.summary);
      const runtime = await this.getRuntime();
      return this.toResult(await runtime.createEvent(params));
    } catch (error) {
      return this.errorResult(error, 'CreateEventFailed');
    }
  };

  updateEvent = async (params: UpdateEventParams): Promise<BuiltinToolResult> => {
    try {
      log('updateEvent eventId=%s', params.eventId);
      const runtime = await this.getRuntime();
      return this.toResult(await runtime.updateEvent(params));
    } catch (error) {
      return this.errorResult(error, 'UpdateEventFailed');
    }
  };

  deleteEvent = async (params: DeleteEventParams): Promise<BuiltinToolResult> => {
    try {
      log('deleteEvent eventId=%s', params.eventId);
      const runtime = await this.getRuntime();
      return this.toResult(await runtime.deleteEvent(params));
    } catch (error) {
      return this.errorResult(error, 'DeleteEventFailed');
    }
  };

  respondEvent = async (params: RespondEventParams): Promise<BuiltinToolResult> => {
    try {
      log('respondEvent eventId=%s status=%s', params.eventId, params.responseStatus);
      const runtime = await this.getRuntime();
      return this.toResult(await runtime.respondEvent(params));
    } catch (error) {
      return this.errorResult(error, 'RespondEventFailed');
    }
  };

  private toResult(output: BuiltinServerRuntimeOutput): BuiltinToolResult {
    const errMsg = typeof output.error?.message === 'string' ? output.error.message : undefined;
    const safe = output.content || errMsg || 'Tool execution failed';
    if (!output.success) {
      return {
        content: safe,
        error: output.error
          ? { body: output.error, message: errMsg ?? safe, type: 'PluginServerError' }
          : undefined,
        state: output.state,
        success: false,
      };
    }
    return { content: safe, state: output.state, success: true };
  }

  private errorResult(err: unknown, type: string): BuiltinToolResult {
    const message = err instanceof Error ? err.message : String(err) || 'Unknown error';
    return { content: `Failed: ${message}`, error: { message, type }, success: false };
  }
}

export const dingtalkWorkspaceExecutor = new DingtalkWorkspaceExecutor();
