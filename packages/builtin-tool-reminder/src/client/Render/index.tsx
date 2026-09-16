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
  ambiguous?: Array<{
    candidates: Array<{ leafDeptName: string; name: string; staffId: string }>;
    query: string;
  }>;
  audience?: Array<{ deptId: string; memberCount: number; name: string }>;
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
  needsClarification?: boolean;
  needsConfirmation?: boolean;
  reminder?: {
    content: string;
    identifier: string;
    nextFireAt?: Date | string | null;
    recipients?: Array<{
      deptName?: string;
      displayName: string;
      kind: 'department' | 'user';
      memberCount?: number | null;
    }>;
    scheduleSummary?: string;
  };
  unknown?: string[];
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
