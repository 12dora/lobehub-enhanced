import type { BuiltinServerRuntimeOutput, BuiltinToolResult } from '@lobechat/types';
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
  ReminderView,
  SearchDirectoryParams,
} from '../../types';
import { isNeedsConfirmationResult, ReminderApiName } from '../../types';

const log = debug('lobe-reminder:executor');

const toClientReminderStatus = (value: string | undefined) => {
  switch (value) {
    case 'canceled':
    case 'expired':
    case 'failed':
    case 'scheduled':
    case 'sent': {
      return value;
    }
    default: {
      return undefined;
    }
  }
};

const toReminderView = (row: {
  content: string;
  creatorName: string;
  fireAt: Date | string;
  id: string;
  recipients?: ReminderView['recipients'];
  repeat?: ReminderView['repeat'];
  repeatRule?: ReminderView['repeat'];
  status?: string | null;
}): ReminderView => ({
  content: row.content,
  creatorName: row.creatorName,
  fireAt: row.fireAt,
  id: row.id,
  recipients: row.recipients,
  repeat: row.repeat ?? row.repeatRule ?? undefined,
  status: row.status ?? undefined,
});

const requireResult = <T>(value: T | undefined, message: string): T => {
  if (value === undefined) throw new Error(message);
  return value;
};

const loadReminderService = async (): Promise<IReminderService> => {
  // Static app import like the task tool: the desktop (vite/rolldown) bundle cannot
  // resolve a dynamic `@/` import from inside a workspace package.
  return {
    cancel: (id) => reminderService.cancel(id),
    create: async (input) => {
      const result = requireResult(
        await reminderService.create(input),
        'Create reminder returned no result',
      );
      if (isNeedsConfirmationResult(result)) {
        return { audience: result.audience, needsConfirmation: true };
      }
      return toReminderView(result);
    },
    listCreated: async (opts) => {
      const rows = await reminderService.listCreated({
        limit: opts?.limit,
        status: toClientReminderStatus(opts?.status),
      });
      return (rows ?? []).map(toReminderView);
    },
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
