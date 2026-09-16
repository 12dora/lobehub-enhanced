import type { BuiltinRender } from '@lobechat/types';

import { ReminderApiName } from '../../types';
import CancelReminderRender from './CancelReminder';
import CreateReminderRender from './CreateReminder';
import ListRemindersRender from './ListReminders';
import SearchDirectoryRender from './SearchDirectory';

/**
 * Props for the lobe-reminder result card (kept for consumers that only need
 * the payload shape; the components below take `BuiltinRenderProps`).
 */
export interface ReminderRenderProps {
  hits?: {
    departments?: Array<{
      deptId: string;
      memberCount?: number;
      name: string;
      pathNames?: string;
    }>;
    users?: Array<{
      deptPath?: string;
      leafDeptName?: string;
      name: string;
      staffId: string;
    }>;
  };
  needsConfirmation?: {
    audience: Array<{ deptId: string; memberCount: number; name: string }>;
  };
  reminder?: {
    content: string;
    creatorName: string;
    fireAt: Date | string;
    id: string;
    recipients?: Array<{
      deptName?: string;
      displayName: string;
      kind: 'department' | 'user';
      memberCount?: number | null;
    }>;
    repeat?: {
      freq: 'daily' | 'monthly' | 'weekly';
      time: string;
    } | null;
  };
}

/**
 * Reminder tool Render components registry: every API gets a focused result
 * card so a reminder created from chat reads like the tasks page row.
 */
export const ReminderRenders: Record<string, BuiltinRender> = {
  [ReminderApiName.cancelReminder]: CancelReminderRender as BuiltinRender,
  [ReminderApiName.createReminder]: CreateReminderRender as BuiltinRender,
  [ReminderApiName.listReminders]: ListRemindersRender as BuiltinRender,
  [ReminderApiName.searchDirectory]: SearchDirectoryRender as BuiltinRender,
};

export { default as CancelReminderRender } from './CancelReminder';
export { default as CreateReminderRender } from './CreateReminder';
export { default as ListRemindersRender } from './ListReminders';
export { default as SearchDirectoryRender } from './SearchDirectory';
