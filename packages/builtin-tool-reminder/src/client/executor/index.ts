import type { BuiltinServerRuntimeOutput, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';
import debug from 'debug';

import type { IReminderService } from '../../ExecutionRuntime';
import { ReminderExecutionRuntime } from '../../ExecutionRuntime';
import { ReminderIdentifier } from '../../manifest';
import type {
  CancelReminderParams,
  CreateReminderParams,
  ListRemindersParams,
  SearchDirectoryParams,
} from '../../types';
import { ReminderApiName } from '../../types';

const log = debug('lobe-reminder:executor');

const loadReminderService = async (): Promise<IReminderService> => {
  // R2 owns src/services/reminder.ts (searchDirectory / create / listCreated /
  // listReceived / cancel). Loaded lazily so this module can register before
  // that file exists.
  const { reminderService } = await import('@/services/reminder');
  return {
    cancel: (id) => reminderService.cancel(id),
    create: (input) => reminderService.create(input),
    listCreated: (opts) => reminderService.listCreated(opts),
    listReceived: (opts) => reminderService.listReceived(opts),
    searchDirectory: (q, kind) => reminderService.searchDirectory(q, kind),
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

  createReminder = async (params: CreateReminderParams): Promise<BuiltinToolResult> => {
    try {
      log('createReminder recipients=%o fireAt=%s', params.recipients, params.fireAt);
      const runtime = await this.getRuntime();
      return this.toResult(await runtime.createReminder(params));
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
      log('cancelReminder id=%s', params.id);
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
