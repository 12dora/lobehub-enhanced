import { pickGenerateObjectEffortParams } from '@lobechat/model-runtime';
import type {
  ReminderScheduleInput,
  ResolvedReminderRecipient,
  TaskItem,
  TaskReminderConfig,
} from '@lobechat/types';
import {
  buildReminderInstruction,
  isReminderTaskConfig,
  parseReminderMentions,
  REMINDER_TIMEZONE,
  stripReminderMentions,
} from '@lobechat/types';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import debug from 'debug';

import { DingTalkDirectoryModel } from '@/database/models/dingtalkDirectory';
import type {
  ReceivedReminder,
  ReminderRecipientInput,
  ReminderWithRecipients,
} from '@/database/models/reminder';
import { ReminderModel } from '@/database/models/reminder';
import { TaskModel } from '@/database/models/task';
import { UserModel } from '@/database/models/user';
import type { ReminderItem } from '@/database/schemas/reminder';
import type { LobeChatDatabase } from '@/database/type';
import { idGenerator } from '@/database/utils/idGenerator';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { SystemAgentService } from '@/server/services/systemAgent';

import {
  REMINDER_CONTENT_EMPTY,
  REMINDER_FIRE_AT_LEAD_MS,
  REMINDER_LARGE_AUDIENCE_THRESHOLD,
  REMINDER_NOT_FOUND,
  REMINDER_TIME_PAST,
  ReminderService,
  ReminderServiceError,
} from './index';
import {
  buildReminderCron,
  describeReminderSchedule,
  formatServerNowIso,
  nextReminderFireAt,
  parseClockTime,
  REMINDER_DEFAULT_TZ,
  scheduleFromLegacy,
  scheduleToRepeatRule,
} from './schedule';
import type { ReminderDeliverResult, ReminderSweepDeps } from './worker';
import { deliverReminder as defaultDeliverReminder } from './worker';

export {
  REMINDER_CONTENT_EMPTY,
  REMINDER_NOT_FOUND,
  REMINDER_TIME_PAST,
  ReminderServiceError,
} from './index';

dayjs.extend(utc);
dayjs.extend(timezone);

const log = debug('lobe-server:reminder-task');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STAFF_PREFIX = 'staff:';
const DEPT_PREFIX = 'dept:';
const REMINDER_SCHEDULE_SCHEMA_NAME = 'reminder_schedule';

const REMINDER_SCHEDULE_SCHEMA = {
  name: REMINDER_SCHEDULE_SCHEMA_NAME,
  schema: {
    additionalProperties: false,
    properties: {
      schedule: {
        anyOf: [
          {
            additionalProperties: false,
            properties: {
              date: { type: 'string' },
              kind: { enum: ['once', 'daily', 'weekly', 'monthly'], type: 'string' },
              monthDays: { items: { type: 'integer' }, type: 'array' },
              time: { type: 'string' },
              until: { type: 'string' },
              weekdays: { items: { type: 'integer' }, type: 'array' },
            },
            required: ['kind', 'time'],
            type: 'object',
          },
          { type: 'null' },
        ],
      },
    },
    required: ['schedule'],
    type: 'object' as const,
  },
};

export type RecipientQuery = string;

export type ReminderProfile = ReminderWithRecipients;

export interface ReminderAmbiguousCandidate {
  deptPath: string;
  leafDeptName: string;
  name: string;
  staffId: string;
}

export interface ReminderAmbiguousQuery {
  candidates: ReminderAmbiguousCandidate[];
  query: string;
}

export interface ReminderLargeAudience {
  deptId: string;
  memberCount: number;
  name: string;
}

export type ResolveOutcome =
  | {
      largeAudience: ReminderLargeAudience[];
      ok: true;
      recipients: ResolvedReminderRecipient[];
    }
  | { ambiguous: ReminderAmbiguousQuery[]; ok: false; unknown: string[] };

export interface CreatedReminderRow {
  content: string;
  firedCount: number;
  lastDelivery?: { failed: number; firedAt: Date; sent: number; skipped: number };
  lastFiredAt: Date | null;
  nextFireAt: Date;
  recipients: ResolvedReminderRecipient[];
  reminderId: string;
  scheduleSummary: string;
  status: 'canceled' | 'completed' | 'scheduled';
  taskId: string;
  taskIdentifier: string;
}

export interface CreateReminderTaskInput {
  confirmLargeAudience?: boolean;
  content: string;
  createdByAgentId?: string | null;
  recipients: RecipientQuery[];
  schedule: ReminderScheduleInput;
  topicId?: string | null;
}

export type CreateReminderTaskResult =
  | { reminder: ReminderProfile; status: 'created'; task: TaskItem }
  | { ambiguous: ReminderAmbiguousQuery[]; status: 'needs_clarification'; unknown: string[] }
  | { audience: ReminderLargeAudience[]; status: 'needs_confirmation' };

export interface SaveReminderTaskInput {
  editorData?: unknown;
  instruction: string;
  taskId: string;
}

export type SaveReminderTaskResult =
  | {
      interpretation: {
        content: string;
        recipients: ResolvedReminderRecipient[];
        schedule: ReminderScheduleInput;
        scheduleChanged: boolean;
      };
      reminder: ReminderProfile;
      status: 'saved';
      task: TaskItem;
    }
  | { ambiguous: ReminderAmbiguousQuery[]; status: 'needs_clarification'; unknown: string[] };

export interface ReminderTaskServiceDeps {
  deliverReminder?: (
    db: LobeChatDatabase,
    reminder: ReminderItem,
    deps?: ReminderSweepDeps & { recipients?: ReminderProfile['recipients'] },
  ) => Promise<ReminderDeliverResult>;
  interpretSchedule?: (input: {
    body: string;
    currentSchedule: ReminderScheduleInput;
    now: Date;
  }) => Promise<ReminderScheduleInput | null>;
}

const creatorDisplayName = (
  user: {
    email?: string | null;
    fullName?: string | null;
    username?: string | null;
  } | null,
): string => {
  const fullName = user?.fullName?.trim();
  if (fullName) return fullName;
  const username = user?.username?.trim();
  if (username) return username;
  const email = user?.email?.trim();
  if (email) return email;
  return '用户';
};

const titleFromContent = (content: string): string => content.trim().slice(0, 40);

const shanghaiDate = (now: Date): string => dayjs(now).tz(REMINDER_DEFAULT_TZ).format('YYYY-MM-DD');

const uniqueSorted = (values: number[] | undefined, min: number, max: number): number[] => {
  if (!values || values.length === 0) return [];
  return [...new Set(values.filter((value) => value >= min && value <= max))].sort((a, b) => a - b);
};

const normalizeSchedule = (schedule: ReminderScheduleInput): ReminderScheduleInput => ({
  kind: schedule.kind,
  time: schedule.time,
  ...(schedule.date ? { date: schedule.date } : {}),
  ...(schedule.until ? { until: schedule.until } : {}),
  ...(uniqueSorted(schedule.weekdays, 1, 7).length
    ? { weekdays: uniqueSorted(schedule.weekdays, 1, 7) }
    : {}),
  ...(uniqueSorted(schedule.monthDays, 1, 31).length
    ? { monthDays: uniqueSorted(schedule.monthDays, 1, 31) }
    : {}),
});

export const schedulesEqual = (a: ReminderScheduleInput, b: ReminderScheduleInput): boolean =>
  JSON.stringify(normalizeSchedule(a)) === JSON.stringify(normalizeSchedule(b));

const parseLlmSchedule = (raw: unknown): ReminderScheduleInput | null => {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind;
  if (kind !== 'once' && kind !== 'daily' && kind !== 'weekly' && kind !== 'monthly') return null;
  if (typeof obj.time !== 'string' || !parseClockTime(obj.time)) return null;
  const schedule: ReminderScheduleInput = { kind, time: obj.time };
  if (typeof obj.date === 'string' && DATE_RE.test(obj.date)) schedule.date = obj.date;
  if (typeof obj.until === 'string' && DATE_RE.test(obj.until)) schedule.until = obj.until;
  if (Array.isArray(obj.weekdays)) {
    schedule.weekdays = uniqueSorted(
      obj.weekdays.filter((value): value is number => typeof value === 'number'),
      1,
      7,
    );
  }
  if (Array.isArray(obj.monthDays)) {
    schedule.monthDays = uniqueSorted(
      obj.monthDays.filter((value): value is number => typeof value === 'number'),
      1,
      31,
    );
  }
  if (kind === 'once' && !schedule.date) return null;
  if (kind === 'weekly' && !schedule.weekdays?.length) return null;
  if (kind === 'monthly' && !schedule.monthDays?.length) return null;
  return schedule;
};

const deptQualifierMatches = (
  user: { deptPath: string; leafDeptName: string },
  dept: string,
): boolean => {
  if (user.leafDeptName === dept) return true;
  return user.deptPath
    .split(/\s*\/\s*/)
    .filter(Boolean)
    .includes(dept);
};

const toRecipientInput = (recipient: ResolvedReminderRecipient): ReminderRecipientInput => ({
  deptId: recipient.deptId ?? null,
  deptName: recipient.deptName,
  deptPath: recipient.deptPath,
  displayName: recipient.displayName,
  kind: recipient.kind,
  memberCount: recipient.memberCount ?? null,
  staffId: recipient.staffId ?? null,
});

const toResolvedRecipient = (
  row: ReminderProfile['recipients'][number],
): ResolvedReminderRecipient => ({
  deptId: row.deptId ?? undefined,
  deptName: row.deptName,
  deptPath: row.deptPath,
  displayName: row.displayName,
  kind: row.kind,
  memberCount: row.memberCount ?? undefined,
  staffId: row.staffId ?? undefined,
});

const reminderConfigOf = (task: TaskItem): TaskReminderConfig | null =>
  isReminderTaskConfig(task.config) ? task.config.reminder : null;

const asTaskStatus = (status: string): CreatedReminderRow['status'] => {
  if (status === 'completed' || status === 'canceled') return status;
  return 'scheduled';
};

const assertOnceNotPast = (schedule: ReminderScheduleInput, fireAt: Date | null, now: Date) => {
  if (schedule.kind !== 'once') return;
  if (!fireAt || fireAt.getTime() <= now.getTime() + REMINDER_FIRE_AT_LEAD_MS) {
    throw new ReminderServiceError(REMINDER_TIME_PAST);
  }
};

export class ReminderTaskService {
  private readonly deliver: NonNullable<ReminderTaskServiceDeps['deliverReminder']>;
  private readonly directory: DingTalkDirectoryModel;
  private readonly interpretScheduleFn?: ReminderTaskServiceDeps['interpretSchedule'];
  private readonly reminderModel: ReminderModel;
  private readonly taskModel: TaskModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
    deps: ReminderTaskServiceDeps = {},
  ) {
    this.directory = new DingTalkDirectoryModel(db);
    this.reminderModel = new ReminderModel(db, userId);
    this.taskModel = new TaskModel(db, userId, workspaceId);
    this.deliver = deps.deliverReminder ?? defaultDeliverReminder;
    this.interpretScheduleFn = deps.interpretSchedule;
  }

  resolveRecipients = async (queries: RecipientQuery[]): Promise<ResolveOutcome> => {
    const recipients: ResolvedReminderRecipient[] = [];
    const ambiguous: ReminderAmbiguousQuery[] = [];
    const unknown: string[] = [];
    const seen = new Set<string>();
    const largeAudience: ReminderLargeAudience[] = [];

    for (const raw of queries) {
      const query = raw.trim();
      if (!query) {
        unknown.push(raw);
        continue;
      }

      const resolved = await this.resolveOneQuery(query);
      if (resolved.kind === 'unknown') {
        unknown.push(query);
        continue;
      }
      if (resolved.kind === 'ambiguous') {
        ambiguous.push({ candidates: resolved.candidates, query });
        continue;
      }

      const key =
        resolved.recipient.kind === 'user'
          ? `user:${resolved.recipient.staffId}`
          : `department:${resolved.recipient.deptId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      recipients.push(resolved.recipient);
      if (
        resolved.recipient.kind === 'department' &&
        (resolved.recipient.memberCount ?? 0) > REMINDER_LARGE_AUDIENCE_THRESHOLD
      ) {
        largeAudience.push({
          deptId: resolved.recipient.deptId!,
          memberCount: resolved.recipient.memberCount ?? 0,
          name: resolved.recipient.displayName,
        });
      }
    }

    if (ambiguous.length > 0 || unknown.length > 0) {
      return { ambiguous, ok: false, unknown };
    }
    return { largeAudience, ok: true, recipients };
  };

  createReminderTask = async (
    input: CreateReminderTaskInput,
  ): Promise<CreateReminderTaskResult> => {
    const content = input.content.trim();
    if (!content) {
      throw new ReminderServiceError(REMINDER_CONTENT_EMPTY, 'Reminder content is required');
    }

    const resolved = await this.resolveRecipients(input.recipients);
    if (!resolved.ok) {
      return {
        ambiguous: resolved.ambiguous,
        status: 'needs_clarification',
        unknown: resolved.unknown,
      };
    }
    if (resolved.recipients.length === 0) {
      return { ambiguous: [], status: 'needs_clarification', unknown: input.recipients };
    }
    if (resolved.largeAudience.length > 0 && !input.confirmLargeAudience) {
      return { audience: resolved.largeAudience, status: 'needs_confirmation' };
    }

    const now = new Date();
    const fireAt = nextReminderFireAt(input.schedule, now);
    assertOnceNotPast(input.schedule, fireAt, now);
    if (!fireAt) {
      throw new ReminderServiceError(REMINDER_TIME_PAST);
    }

    const once = input.schedule.kind === 'once';
    const scheduleSummary = describeReminderSchedule(input.schedule);
    const cron = buildReminderCron(input.schedule);
    const repeatRule = scheduleToRepeatRule(input.schedule);
    const instruction = buildReminderInstruction(resolved.recipients, content);
    const reminderId = idGenerator('reminders');
    const user = await UserModel.findById(this.db, this.userId);
    const reminderConfig: TaskReminderConfig = {
      kind: 'reminder',
      once,
      reminderId,
      schedule: input.schedule,
      scheduleSummary,
      until: input.schedule.until ?? null,
    };

    let task: TaskItem | undefined;
    try {
      task = await this.taskModel.create({
        assigneeAgentId: null,
        automationMode: 'schedule',
        config: { reminder: reminderConfig },
        context: { scheduler: { scheduleStartedAt: now.toISOString() } },
        createdByAgentId: input.createdByAgentId ?? null,
        instruction,
        name: titleFromContent(content),
        schedulePattern: cron,
        scheduleTimezone: REMINDER_TIMEZONE,
        status: 'scheduled',
      });
      const reminder = await this.reminderModel.createForTask({
        content,
        createdByAgentId: input.createdByAgentId ?? null,
        creatorName: creatorDisplayName(user ?? null),
        fireAt,
        id: reminderId,
        recipients: resolved.recipients.map(toRecipientInput),
        repeatRule,
        taskId: task.id,
        timezone: REMINDER_DEFAULT_TZ,
        topicId: input.topicId ?? null,
      });
      log('created reminder-task task=%s reminder=%s', task.id, reminder.id);
      return { reminder, status: 'created', task };
    } catch (error) {
      if (task) {
        await this.taskModel.delete(task.id).catch((cleanupError) => {
          log('cleanup task=%s after reminder create failed: %O', task?.id, cleanupError);
        });
      }
      throw error;
    }
  };

  saveReminderTask = async (input: SaveReminderTaskInput): Promise<SaveReminderTaskResult> => {
    const task = await this.requireReminderTask(input.taskId);
    const mentions = parseReminderMentions(input.instruction);
    const queries = mentions.map((token) =>
      token.dept ? `${token.name}·${token.dept}` : token.name,
    );
    const resolved = await this.resolveRecipients(queries);
    if (!resolved.ok) {
      return {
        ambiguous: resolved.ambiguous,
        status: 'needs_clarification',
        unknown: resolved.unknown,
      };
    }
    if (resolved.recipients.length === 0) {
      return { ambiguous: [], status: 'needs_clarification', unknown: queries };
    }

    const content = stripReminderMentions(input.instruction);
    if (!content) {
      throw new ReminderServiceError(REMINDER_CONTENT_EMPTY, 'Reminder content is required');
    }

    const reminder = await this.reminderModel.findByTaskId(task.id);
    if (!reminder) throw new ReminderServiceError(REMINDER_NOT_FOUND);

    const currentSchedule =
      reminderConfigOf(task)?.schedule ?? scheduleFromLegacy(reminder.fireAt, reminder.repeatRule);
    const now = new Date();
    let schedule = currentSchedule;
    let scheduleChanged = false;
    try {
      const interpreted = await this.interpretSchedule({
        body: input.instruction,
        currentSchedule,
        now,
      });
      if (interpreted && !schedulesEqual(interpreted, currentSchedule)) {
        schedule = interpreted;
        scheduleChanged = true;
      }
    } catch (error) {
      log('schedule re-interpret failed, keeping current: %O', error);
      schedule = currentSchedule;
      scheduleChanged = false;
    }

    const fireAt = nextReminderFireAt(schedule, now);
    if (scheduleChanged) {
      assertOnceNotPast(schedule, fireAt, now);
      if (!fireAt) throw new ReminderServiceError(REMINDER_TIME_PAST);
    }
    if (!fireAt) throw new ReminderServiceError(REMINDER_TIME_PAST);

    const once = schedule.kind === 'once';
    const scheduleSummary = describeReminderSchedule(schedule);
    const instruction = buildReminderInstruction(resolved.recipients, content);
    const previousConfig =
      typeof task.config === 'object' && task.config
        ? (task.config as Record<string, unknown>)
        : {};
    const reminderConfig: TaskReminderConfig = {
      kind: 'reminder',
      once,
      reminderId: reminder.id,
      schedule,
      scheduleSummary,
      until: schedule.until ?? null,
    };

    const updatedTask = await this.taskModel.update(task.id, {
      config: { ...previousConfig, reminder: reminderConfig },
      ...(input.editorData !== undefined ? { editorData: input.editorData } : {}),
      instruction,
      name: titleFromContent(content),
      schedulePattern: buildReminderCron(schedule),
      scheduleTimezone: REMINDER_TIMEZONE,
    });
    if (!updatedTask) throw new ReminderServiceError(REMINDER_NOT_FOUND);

    const updatedReminder = await this.reminderModel.updateProfile(reminder.id, {
      content,
      fireAt,
      recipients: resolved.recipients.map(toRecipientInput),
      repeatRule: scheduleToRepeatRule(schedule),
    });

    return {
      interpretation: {
        content,
        recipients: resolved.recipients,
        schedule,
        scheduleChanged,
      },
      reminder: updatedReminder,
      status: 'saved',
      task: updatedTask,
    };
  };

  listCreated = async (opts?: {
    includeFinished?: boolean;
    limit?: number;
  }): Promise<CreatedReminderRow[]> => {
    const profiles = await this.reminderModel.listCreatedByTasks(opts);
    const taskIds = profiles
      .map((row) => row.taskId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const tasks = await this.taskModel.findByIds(taskIds);
    const tasksById = new Map(tasks.map((row) => [row.id, row]));

    const rows: CreatedReminderRow[] = [];
    for (const profile of profiles) {
      if (!profile.taskId) continue;
      const task = tasksById.get(profile.taskId);
      if (!task) continue;
      const config = reminderConfigOf(task);
      rows.push({
        content: profile.content,
        firedCount: profile.firedCount,
        lastDelivery: profile.lastFiredAt
          ? { ...profile.deliveryCounts, firedAt: profile.lastFiredAt }
          : undefined,
        lastFiredAt: profile.lastFiredAt,
        nextFireAt: profile.fireAt,
        recipients: profile.recipients.map(toResolvedRecipient),
        reminderId: profile.id,
        scheduleSummary:
          config?.scheduleSummary ??
          describeReminderSchedule(scheduleFromLegacy(profile.fireAt, profile.repeatRule)),
        status: asTaskStatus(task.status),
        taskId: task.id,
        taskIdentifier: task.identifier,
      });
    }
    return rows;
  };

  listReceived = async (opts?: { limit?: number }): Promise<ReceivedReminder[]> =>
    new ReminderService(this.db, this.userId).listReceived(opts);

  cancel = async (taskId: string): Promise<void> => {
    const task = await this.requireReminderTask(taskId);
    await this.taskModel.updateStatus(task.id, 'canceled', { completedAt: new Date() });
    const reminder = await this.reminderModel.findByTaskId(task.id);
    if (!reminder) return;
    await this.reminderModel.updateProfile(reminder.id, {
      canceledAt: new Date(),
      status: 'canceled',
    });
  };

  fireNow = async (
    taskId: string,
  ): Promise<{ failed: number; firedAt: Date; sent: number; skipped: number }> => {
    const task = await this.requireReminderTask(taskId);
    const reminder = await this.reminderModel.findByTaskId(task.id);
    if (!reminder) throw new ReminderServiceError(REMINDER_NOT_FOUND);
    if (reminder.status === 'canceled') throw new ReminderServiceError(REMINDER_NOT_FOUND);

    const result = await this.deliver(this.db, reminder, { recipients: reminder.recipients });
    await this.taskModel.updateHeartbeat(task.id);
    await this.completeIfTerminal(task, reminderConfigOf(task), result);
    return {
      failed: result.failed,
      firedAt: result.firedAt,
      sent: result.sent,
      skipped: result.skipped,
    };
  };

  fireForTick = async (
    taskId: string,
    now: Date,
  ): Promise<'fired' | 'not_reminder' | 'skipped_until'> => {
    const task = await this.taskModel.findById(taskId);
    if (!task) return 'not_reminder';
    const config = reminderConfigOf(task);
    if (!config) return 'not_reminder';

    const reminder = await this.reminderModel.findByTaskId(task.id);
    if (!reminder) return 'not_reminder';

    const until = config.until ?? config.schedule.until ?? null;
    if (until && shanghaiDate(now) > until) {
      await this.taskModel.updateStatus(task.id, 'completed', { completedAt: now });
      if (reminder.status === 'scheduled') {
        await this.reminderModel.updateProfile(reminder.id, { status: 'sent' });
      }
      return 'skipped_until';
    }

    const result = await this.deliver(this.db, reminder, {
      now,
      recipients: reminder.recipients,
    });
    await this.taskModel.updateHeartbeat(task.id);
    await this.completeIfTerminal(task, config, result, now);
    return 'fired';
  };

  private completeIfTerminal = async (
    task: TaskItem,
    config: TaskReminderConfig | null,
    result: ReminderDeliverResult,
    now: Date = result.firedAt,
  ) => {
    const once = config?.once ?? !result.reminder.repeatRule;
    if (!once && result.reminder.status === 'scheduled') return;
    await this.taskModel.updateStatus(task.id, 'completed', { completedAt: now });
    if (result.reminder.status === 'scheduled') {
      await this.reminderModel.updateProfile(result.reminder.id, { status: 'sent' });
    }
  };

  private requireReminderTask = async (taskId: string): Promise<TaskItem> => {
    const task = await this.taskModel.resolve(taskId);
    if (!task || !isReminderTaskConfig(task.config)) {
      throw new ReminderServiceError(REMINDER_NOT_FOUND);
    }
    return task;
  };

  private interpretSchedule = async (input: {
    body: string;
    currentSchedule: ReminderScheduleInput;
    now: Date;
  }): Promise<ReminderScheduleInput | null> => {
    if (this.interpretScheduleFn) return this.interpretScheduleFn(input);

    const systemAgent = new SystemAgentService(this.db, this.userId, this.workspaceId);
    const { model, provider, ...effortParams } = await systemAgent.getTaskModelConfig('topic');
    const serverNow = formatServerNowIso(input.now);
    const prompt = [
      `当前服务器时间（Asia/Shanghai）：${serverNow}`,
      '',
      '当前日程 JSON：',
      JSON.stringify(input.currentSchedule),
      '',
      '提醒正文：',
      input.body,
      '',
      '从正文中识别时间表达并输出结构化日程。若正文没有时间表达，schedule 返回 null（保留当前日程）。',
      '时区一律 Asia/Shanghai。「每天/每周/每月」对应 daily/weekly/monthly；否则为 once（下一次出现的日期+时间）。',
      'weekly.weekdays 为 1-7（周一=1）。monthly.monthDays 为 1-31。time 为 HH:mm。once.date 与 until 为 YYYY-MM-DD。',
    ].join('\n');

    const modelRuntime = await initModelRuntimeFromDB(
      this.db,
      this.userId,
      provider,
      this.workspaceId,
    );
    const result = await modelRuntime.generateObject(
      {
        messages: [{ content: prompt, role: 'user' }],
        model,
        schema: REMINDER_SCHEDULE_SCHEMA,
        ...pickGenerateObjectEffortParams(effortParams),
      },
      { metadata: { trigger: 'reminder_schedule' } },
    );
    const schedule = (result as { schedule?: unknown } | null)?.schedule;
    if (schedule === null || schedule === undefined) return null;
    return parseLlmSchedule(schedule);
  };

  private resolveOneQuery = async (
    query: string,
  ): Promise<
    | { kind: 'ambiguous'; candidates: ReminderAmbiguousCandidate[] }
    | { kind: 'ok'; recipient: ResolvedReminderRecipient }
    | { kind: 'unknown' }
  > => {
    if (query.startsWith(STAFF_PREFIX)) {
      const staffId = query.slice(STAFF_PREFIX.length).trim();
      if (!staffId) return { kind: 'unknown' };
      const [user] = await this.directory.getUsers([staffId]);
      if (!user?.active) return { kind: 'unknown' };
      return { kind: 'ok', recipient: this.userToRecipient(user) };
    }
    if (query.startsWith(DEPT_PREFIX)) {
      const deptId = query.slice(DEPT_PREFIX.length).trim();
      if (!deptId) return { kind: 'unknown' };
      return this.resolveDepartmentById(deptId);
    }

    const separator = query.indexOf('·');
    const name = separator === -1 ? query : query.slice(0, separator);
    const dept = separator === -1 ? undefined : query.slice(separator + 1);
    if (!name) return { kind: 'unknown' };

    const hits = await this.directory.search(name, {
      kind: dept ? 'user' : undefined,
      limit: 50,
    });
    const users = hits.users.filter((user) => user.active && user.name === name);
    const narrowed = dept ? users.filter((user) => deptQualifierMatches(user, dept)) : users;

    if (dept) {
      if (narrowed.length === 1)
        return { kind: 'ok', recipient: this.userHitToRecipient(narrowed[0]) };
      if (narrowed.length > 1) {
        return { candidates: narrowed.map(this.toAmbiguousCandidate), kind: 'ambiguous' };
      }
      return { kind: 'unknown' };
    }

    if (narrowed.length > 1) {
      return { candidates: narrowed.map(this.toAmbiguousCandidate), kind: 'ambiguous' };
    }
    if (narrowed.length === 1) {
      return { kind: 'ok', recipient: this.userHitToRecipient(narrowed[0]) };
    }

    const departments = hits.departments.filter((row) => row.name === name);
    if (departments.length === 1) {
      return this.departmentHitToRecipient(departments[0]);
    }
    return { kind: 'unknown' };
  };

  private resolveDepartmentById = async (
    deptId: string,
  ): Promise<{ kind: 'ok'; recipient: ResolvedReminderRecipient } | { kind: 'unknown' }> => {
    const department = await this.directory.getDepartment(deptId);
    if (!department) return { kind: 'unknown' };
    const memberStaffIds = await this.directory.subtreeMemberStaffIds(deptId);
    return {
      kind: 'ok',
      recipient: {
        deptId,
        deptName: department.name,
        deptPath: department.pathNames,
        displayName: department.name,
        kind: 'department',
        memberCount: memberStaffIds.length,
      },
    };
  };

  private departmentHitToRecipient = (hit: {
    deptId: string;
    memberCount: number;
    name: string;
    pathNames: string;
  }): { kind: 'ok'; recipient: ResolvedReminderRecipient } => ({
    kind: 'ok',
    recipient: {
      deptId: hit.deptId,
      deptName: hit.name,
      deptPath: hit.pathNames,
      displayName: hit.name,
      kind: 'department',
      memberCount: hit.memberCount,
    },
  });

  private userToRecipient = (user: {
    deptPath: string;
    leafDeptId: string | null;
    leafDeptName: string;
    name: string;
    staffId: string;
  }): ResolvedReminderRecipient => ({
    deptId: user.leafDeptId ?? undefined,
    deptName: user.leafDeptName,
    deptPath: user.deptPath,
    displayName: user.name,
    kind: 'user',
    staffId: user.staffId,
  });

  private userHitToRecipient = (user: {
    deptPath: string;
    leafDeptId: string | null;
    leafDeptName: string;
    name: string;
    staffId: string;
  }): ResolvedReminderRecipient => this.userToRecipient(user);

  private toAmbiguousCandidate = (user: {
    deptPath: string;
    leafDeptName: string;
    name: string;
    staffId: string;
  }): ReminderAmbiguousCandidate => ({
    deptPath: user.deptPath,
    leafDeptName: user.leafDeptName,
    name: user.name,
    staffId: user.staffId,
  });
}
