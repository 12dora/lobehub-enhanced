import type {
  BuiltinServerRuntimeOutput,
  BuiltinToolContext,
  BuiltinToolResult,
} from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';
import debug from 'debug';

import { reminderService } from '@/services/reminder';

import type { IReminderService } from '../../ExecutionRuntime';
import { ReminderExecutionRuntime } from '../../ExecutionRuntime';
import { ReminderIdentifier } from '../../manifest';
import type {
  CancelReminderParams,
  CreateReminderParams,
  ListRemindersParams,
  ReceivedReminderView,
  SearchDirectoryParams,
} from '../../types';
import { ReminderApiName } from '../../types';

const log = debug('lobe-reminder:executor');

const requireResult = <T>(value: T | undefined, message: string): T => {
  if (value === undefined) throw new Error(message);
  return value;
};

const loadReminderService = async (): Promise<IReminderService> => {
  // Static app import like the task tool: the desktop (vite/rolldown) bundle cannot
  // resolve a dynamic `@/` import from inside a workspace package.
  return {
    cancel: (taskId) => reminderService.cancel(taskId),
    create: async (input) =>
      requireResult(await reminderService.create(input), 'Create reminder returned no result'),
    listCreated: async (opts) =>
      (await reminderService.listCreated({
        includeFinished: opts?.includeFinished,
        limit: opts?.limit,
      })) ?? [],
    listReceived: async (opts): Promise<ReceivedReminderView[]> =>
      (await reminderService.listReceived(opts)) ?? [],
    searchDirectory: async (q, kind) =>
      requireResult(
        await reminderService.searchDirectory({ kind, q }),
        'Search directory returned no result',
      ),
  };
};

class ReminderExecutor extends BaseExecutor<typeof ReminderApiName> {
  readonly identifier = ReminderIdentifier;
  protected readonly apiEnum = ReminderApiName;
  private runtimePromise?: Promise<ReminderExecutionRuntime>;

  private getRuntime() {
    this.runtimePromise ??= loadReminderService().then(
      (service) => new ReminderExecutionRuntime(service),
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

  createReminder = async (
    params: CreateReminderParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('createReminder recipients=%o', params.recipients);
      const runtime = await this.getRuntime();
      return this.toResult(
        await runtime.createReminder({
          ...params,
          createdByAgentId: ctx?.agentId,
          topicId: ctx?.topicId,
        }),
      );
    } catch (error) {
      return this.errorResult(error, 'CreateReminderFailed');
    }
  };

  listReminders = async (params: ListRemindersParams = {}): Promise<BuiltinToolResult> => {
    try {
      log('listReminders scope=%s', params.scope);
      const runtime = await this.getRuntime();
      return this.toResult(await runtime.listReminders(params));
    } catch (error) {
      return this.errorResult(error, 'ListRemindersFailed');
    }
  };

  cancelReminder = async (params: CancelReminderParams): Promise<BuiltinToolResult> => {
    try {
      log('cancelReminder taskId=%s', params.taskId);
      const runtime = await this.getRuntime();
      return this.toResult(await runtime.cancelReminder(params));
    } catch (error) {
      return this.errorResult(error, 'CancelReminderFailed');
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

export const reminderExecutor = new ReminderExecutor();
