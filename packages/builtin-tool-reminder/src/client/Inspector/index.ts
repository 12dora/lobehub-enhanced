import type { BuiltinInspector } from '@lobechat/types';

import { ReminderApiName } from '../../types';
import { CancelReminderInspector } from './CancelReminder';
import { CreateReminderInspector } from './CreateReminder';
import { ListRemindersInspector } from './ListReminders';
import { SearchDirectoryInspector } from './SearchDirectory';

/**
 * Reminder tool Inspector components registry.
 *
 * Inspector components customize the title/header area of tool calls
 * in the conversation UI for the lobe-reminder built-in tool.
 */
export const ReminderInspectors: Record<string, BuiltinInspector> = {
  [ReminderApiName.cancelReminder]: CancelReminderInspector as BuiltinInspector,
  [ReminderApiName.createReminder]: CreateReminderInspector as BuiltinInspector,
  [ReminderApiName.listReminders]: ListRemindersInspector as BuiltinInspector,
  [ReminderApiName.searchDirectory]: SearchDirectoryInspector as BuiltinInspector,
};

export { CancelReminderInspector } from './CancelReminder';
export { CreateReminderInspector } from './CreateReminder';
export { ListRemindersInspector } from './ListReminders';
export { SearchDirectoryInspector } from './SearchDirectory';
