import { randomUUID } from 'node:crypto';

import {
  REMINDER_NOTIFICATION_CATEGORY,
  REMINDER_NOTIFICATION_TYPE_RECEIVED,
} from '@lobechat/types';
import debug from 'debug';
import { inArray } from 'drizzle-orm';

import { getMessengerDingTalkConfig } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import { DingTalkDirectoryModel } from '@/database/models/dingtalkDirectory';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { NotificationModel } from '@/database/models/notification';
import type { ReminderFireDeliveryInput } from '@/database/models/reminder';
import { ReminderModel } from '@/database/models/reminder';
import { UserModel } from '@/database/models/user';
import type {
  ReminderItem,
  ReminderRecipientItem,
  ReminderRepeatRule,
} from '@/database/schemas/reminder';
import { reminderRecipients } from '@/database/schemas/reminder';
import type { LobeChatDatabase } from '@/database/type';
import { RELEASE_SWEEP_LOCK_SCRIPT } from '@/server/enterprise/services/taskScheduling/lock';
import type {
  SweepLockHandle,
  SweepLockResult,
} from '@/server/enterprise/services/taskScheduling/types';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { buildDingTalkIdentityEmail } from '@/server/services/messenger/platforms/dingtalk/const';
import type { DingTalkWorkNoticeOa } from '@/server/services/messenger/platforms/dingtalk/notifyApp';
import {
  buildNotifyRobotMarkdown,
  buildOaWorkNoticePayload,
  DINGTALK_OA_HEAD_TEXT_FALLBACK,
  DINGTALK_ROBOT_USERID_CHUNK,
  DINGTALK_WORK_NOTICE_USERID_CHUNK,
  isNotifyChannelEnabled,
  NOTIFY_CHANNEL_DISABLED,
  resolveWorkNoticeHeadText,
  sendRobotMessage,
  sendWorkNotice,
} from '@/server/services/messenger/platforms/dingtalk/notifyApp';

import {
  buildReminderNotice,
  formatFireClock,
  formatRepeatSummary,
  nextFireAt,
  REMINDER_DEFAULT_TZ,
} from './schedule';

const log = debug('lobe-server:reminder');

export const REMINDER_SWEEP_LOCK_KEY = 'reminder:sweep-lock';
export const REMINDER_SWEEP_LOCK_TTL_SECONDS = 5 * 60;
export const REMINDER_SWEEP_INTERVAL_MS = 60_000;
export const REMINDER_SWEEP_DUE_LIMIT = 50;
export const NOTIFY_APP_NOT_CONFIGURED = 'notify_app_not_configured';
export const CHANNEL_DISABLED = NOTIFY_CHANNEL_DISABLED;
export const INACTIVE_DELIVERY_REASON = 'inactive';
/** Push / task-name summary cap (tool `title` and content fallback). */
export const REMINDER_TITLE_MAX_CHARS = 12;

/** First line of the reminder body, trimmed to the push-title budget. */
export const reminderTitleFromContent = (content: string): string => {
  const line = content.trim().split(/\r?\n/, 1)[0] ?? '';
  return line.slice(0, REMINDER_TITLE_MAX_CHARS);
};

export const reminderSummaryTitle = (title: string | null | undefined, content: string): string => {
  const trimmed = title?.trim();
  if (trimmed) return trimmed.slice(0, REMINDER_TITLE_MAX_CHARS);
  return reminderTitleFromContent(content);
};

/** Kind segment of the push title: `<创建者>提醒你：<摘要>`. */
export const formatReminderPushKind = (creatorName: string, summary: string): string =>
  `${creatorName}提醒你：${summary}`;

/**
 * DingTalk overwrites `oa.head.text` with the 服务号 name; app identity lives in `body.title`.
 * Format: `<站点标题> · <创建者>提醒你：<摘要>`.
 */
export const formatReminderOaBodyTitle = (
  headText: string,
  summary: string,
  creatorName: string,
): string => `${headText} · ${formatReminderPushKind(creatorName, summary)}`;

const noopRelease = async (): Promise<void> => {};

const lockHandle = (
  result: SweepLockResult,
  release: SweepLockHandle['release'],
): SweepLockHandle => ({ release, result });

export const acquireReminderSweepLock = async (): Promise<SweepLockHandle> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) {
    console.warn('[reminder] Redis unavailable; running sweep without a cross-replica lock');
    return lockHandle('unavailable', noopRelease);
  }

  const token = randomUUID();

  try {
    const result = await redis.set(
      REMINDER_SWEEP_LOCK_KEY,
      token,
      'EX',
      REMINDER_SWEEP_LOCK_TTL_SECONDS,
      'NX',
    );
    if (result !== 'OK') {
      log('lock held by another replica, skip sweep');
      return lockHandle('held', noopRelease);
    }
  } catch (error) {
    console.warn('[reminder] Redis lock failed; running sweep anyway', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    return lockHandle('unavailable', noopRelease);
  }

  return lockHandle('acquired', async () => {
    try {
      await redis.eval(RELEASE_SWEEP_LOCK_SCRIPT, 1, REMINDER_SWEEP_LOCK_KEY, token);
    } catch (error) {
      console.warn('[reminder] Redis lock release failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  });
};

export interface ReminderSweepCounts {
  failed: number;
  fired: number;
  skipped: number;
}

export interface ReminderSweepResult {
  counts: ReminderSweepCounts;
  lock: SweepLockResult;
}

export interface ReminderSweepDeps {
  acquireLock?: () => Promise<SweepLockHandle>;
  createInboxNotification?: (input: {
    content: string;
    dedupeKey: string;
    title: string;
    userId: string;
  }) => Promise<void>;
  getUsers?: (staffIds: string[]) => Promise<Array<{ active: boolean; staffId: string }>>;
  isNotifyAppConfigured?: () => Promise<boolean>;
  isNotifyRobotEnabled?: () => Promise<boolean>;
  isWorkNoticeEnabled?: () => Promise<boolean>;
  listDue?: typeof ReminderModel.listDue;
  loadRecipients?: (reminderIds: string[]) => Promise<Map<string, ReminderRecipientItem[]>>;
  now?: Date;
  persistMode?: 'cas' | 'deliveries';
  recordFire?: typeof ReminderModel.recordFire;
  resolveHeadText?: () => Promise<string>;
  resolveUserId?: (staffId: string) => Promise<string | null>;
  sendRobotMessage?: typeof sendRobotMessage;
  sendWorkNotice?: typeof sendWorkNotice;
  subtreeMemberStaffIds?: (deptId: string) => Promise<string[]>;
}

const emptyCounts = (): ReminderSweepCounts => ({ failed: 0, fired: 0, skipped: 0 });

interface NotifyChannelFlags {
  configured: boolean;
  robotEnabled: boolean;
  workNoticeEnabled: boolean;
}

const resolveNotifyChannels = async (deps: ReminderSweepDeps): Promise<NotifyChannelFlags> => {
  if (deps.isNotifyAppConfigured || deps.isWorkNoticeEnabled || deps.isNotifyRobotEnabled) {
    const configured = await (deps.isNotifyAppConfigured ?? (async () => true))();
    return {
      configured,
      robotEnabled: configured ? await (deps.isNotifyRobotEnabled ?? (async () => true))() : false,
      workNoticeEnabled: configured
        ? await (deps.isWorkNoticeEnabled ?? (async () => true))()
        : false,
    };
  }

  const config = await getMessengerDingTalkConfig();
  const notifyApp = config?.notifyApp ?? null;
  if (!notifyApp) {
    return { configured: false, robotEnabled: false, workNoticeEnabled: false };
  }
  return {
    configured: true,
    robotEnabled: isNotifyChannelEnabled(notifyApp.notifyRobotEnabled),
    workNoticeEnabled: isNotifyChannelEnabled(notifyApp.notifyWorkNoticeEnabled),
  };
};

export const loadReminderRecipients = async (
  db: LobeChatDatabase,
  reminderIds: string[],
): Promise<Map<string, ReminderRecipientItem[]>> => {
  const byReminder = new Map<string, ReminderRecipientItem[]>();
  if (reminderIds.length === 0) return byReminder;
  const rows = await db
    .select()
    .from(reminderRecipients)
    .where(inArray(reminderRecipients.reminderId, reminderIds));
  for (const row of rows) {
    const list = byReminder.get(row.reminderId) ?? [];
    list.push(row);
    byReminder.set(row.reminderId, list);
  }
  return byReminder;
};

export const resolveUserIdFromStaffId = async (
  db: LobeChatDatabase,
  staffId: string,
): Promise<string | null> => {
  const link = await MessengerAccountLinkModel.findByPlatformUser(db, 'dingtalk', staffId, '');
  if (link?.userId) return link.userId;
  const user = await UserModel.findByEmail(db, buildDingTalkIdentityEmail(staffId));
  return user?.id ?? null;
};

interface ReminderFireRuntime {
  createInbox: (input: {
    content: string;
    dedupeKey: string;
    title: string;
    userId: string;
  }) => Promise<void>;
  getUsers: (staffIds: string[]) => Promise<Array<{ active: boolean; staffId: string }>>;
  headText: string;
  notifyConfigured: boolean;
  now: Date;
  persistMode: 'cas' | 'deliveries';
  recordFire: typeof ReminderModel.recordFire;
  resolveUserId: (staffId: string) => Promise<string | null>;
  robotEnabled: boolean;
  send: typeof sendWorkNotice;
  sendRobot: typeof sendRobotMessage;
  subtreeMemberStaffIds: (deptId: string) => Promise<string[]>;
  workNoticeEnabled: boolean;
}

const resolveFireRuntime = async (
  db: LobeChatDatabase,
  deps: ReminderSweepDeps,
): Promise<ReminderFireRuntime> => {
  const directory = new DingTalkDirectoryModel(db);
  const channels = await resolveNotifyChannels(deps);
  const notifyConfigured = channels.configured;
  const headText = notifyConfigured
    ? await (deps.resolveHeadText ?? resolveWorkNoticeHeadText)()
    : DINGTALK_OA_HEAD_TEXT_FALLBACK;

  return {
    createInbox:
      deps.createInboxNotification ??
      (async (input) => {
        const model = new NotificationModel(db, input.userId);
        await model.create({
          category: REMINDER_NOTIFICATION_CATEGORY,
          content: input.content,
          dedupeKey: input.dedupeKey,
          title: input.title,
          type: REMINDER_NOTIFICATION_TYPE_RECEIVED,
        });
      }),
    getUsers:
      deps.getUsers ??
      (async (staffIds: string[]) => {
        const rows = await directory.getUsers(staffIds);
        return rows.map((row) => ({ active: row.active, staffId: row.staffId }));
      }),
    headText,
    now: deps.now ?? new Date(),
    notifyConfigured,
    persistMode: deps.persistMode ?? 'cas',
    recordFire: deps.recordFire ?? ReminderModel.recordFire,
    resolveUserId:
      deps.resolveUserId ?? ((staffId: string) => resolveUserIdFromStaffId(db, staffId)),
    robotEnabled: channels.robotEnabled,
    send: deps.sendWorkNotice ?? sendWorkNotice,
    sendRobot: deps.sendRobotMessage ?? sendRobotMessage,
    subtreeMemberStaffIds:
      deps.subtreeMemberStaffIds ?? ((deptId: string) => directory.subtreeMemberStaffIds(deptId)),
    workNoticeEnabled: channels.workNoticeEnabled,
  };
};

const chunkStaffIds = (staffIds: string[], size: number): string[][] => {
  if (staffIds.length === 0) return [];
  const chunks: string[][] = [];
  for (let index = 0; index < staffIds.length; index += size) {
    chunks.push(staffIds.slice(index, index + size));
  }
  return chunks;
};

const expandStaffIds = async (
  recipients: ReminderRecipientItem[],
  deps: {
    getUsers: (staffIds: string[]) => Promise<Array<{ active: boolean; staffId: string }>>;
    subtreeMemberStaffIds: (deptId: string) => Promise<string[]>;
  },
): Promise<{ activeIds: string[]; inactiveIds: string[] }> => {
  const activeIds = new Set<string>();
  const inactiveIds = new Set<string>();
  const directIds: string[] = [];

  for (const recipient of recipients) {
    if (recipient.kind === 'user' && recipient.staffId) {
      directIds.push(recipient.staffId);
    } else if (recipient.kind === 'department' && recipient.deptId) {
      const members = await deps.subtreeMemberStaffIds(recipient.deptId);
      for (const staffId of members) activeIds.add(staffId);
    }
  }

  if (directIds.length > 0) {
    const users = await deps.getUsers([...new Set(directIds)]);
    const byId = new Map(users.map((user) => [user.staffId, user]));
    for (const staffId of directIds) {
      const user = byId.get(staffId);
      if (user?.active) activeIds.add(staffId);
      else inactiveIds.add(staffId);
    }
  }

  for (const staffId of activeIds) inactiveIds.delete(staffId);

  return { activeIds: [...activeIds], inactiveIds: [...inactiveIds] };
};

const deliverWorkNoticeChunk = async (input: {
  oa: DingTalkWorkNoticeOa;
  send: typeof sendWorkNotice;
  staffIds: string[];
}): Promise<{
  failedReason?: string;
  staffIds: string[];
  status: 'failed' | 'sent';
  taskId?: string;
}> => {
  try {
    const results = await input.send({
      oa: input.oa,
      staffIds: input.staffIds,
    });
    return { staffIds: input.staffIds, status: 'sent', taskId: results[0]?.taskId };
  } catch (error) {
    const failedReason =
      error instanceof Error && error.message ? error.message.slice(0, 500) : 'send_failed';
    log('sendWorkNotice failed: %s', failedReason);
    return { failedReason, staffIds: input.staffIds, status: 'failed' };
  }
};

const deliverRobotChunk = async (input: {
  markdown: { text: string; title: string };
  send: typeof sendRobotMessage;
  staffIds: string[];
}): Promise<{
  failedReason?: string;
  processQueryKey?: string;
  staffIds: string[];
  status: 'failed' | 'sent';
}> => {
  try {
    const results = await input.send({
      markdown: input.markdown,
      staffIds: input.staffIds,
    });
    return {
      processQueryKey: results[0]?.processQueryKey,
      staffIds: input.staffIds,
      status: 'sent',
    };
  } catch (error) {
    const failedReason =
      error instanceof Error && error.message ? error.message.slice(0, 500) : 'send_failed';
    log('sendRobotMessage failed: %s', failedReason);
    return { failedReason, staffIds: input.staffIds, status: 'failed' };
  }
};

export const buildReminderWorkNoticeOa = (input: {
  content: string;
  creatorName: string;
  firedAt: Date;
  headText: string;
  repeatRule?: ReminderRepeatRule | null;
  timezone: string;
  title: string;
}): DingTalkWorkNoticeOa => {
  const clock = formatFireClock(input.firedAt, input.timezone);
  const summary = formatRepeatSummary(input.repeatRule ?? null);
  return buildOaWorkNoticePayload({
    author: input.creatorName,
    content: input.content,
    form: [
      { key: '时间', value: summary ? `${clock} · ${summary}` : clock },
      { key: '来自', value: input.creatorName },
    ],
    headText: input.headText,
    title: formatReminderOaBodyTitle(input.headText, input.title, input.creatorName),
  });
};

export const buildReminderRobotMarkdown = (input: {
  content: string;
  creatorName: string;
  firedAt: Date;
  headText: string;
  repeatRule?: ReminderRepeatRule | null;
  timezone: string;
  title: string;
}): { text: string; title: string } => {
  const clock = formatFireClock(input.firedAt, input.timezone);
  const summary = formatRepeatSummary(input.repeatRule ?? null);
  const footer = summary
    ? `${clock} · ${summary} · 来自 ${input.creatorName}`
    : `${clock} · 来自 ${input.creatorName}`;
  return buildNotifyRobotMarkdown({
    content: input.content,
    footer,
    headText: input.headText,
    kind: formatReminderPushKind(input.creatorName, input.title),
  });
};

export const runReminderSweep = async (
  db: LobeChatDatabase,
  deps: ReminderSweepDeps = {},
): Promise<ReminderSweepResult> => {
  const lock = await (deps.acquireLock ?? acquireReminderSweepLock)();
  if (lock.result === 'held') {
    return { counts: emptyCounts(), lock: lock.result };
  }

  const counts = emptyCounts();
  const now = deps.now ?? new Date();

  try {
    const listDue = deps.listDue ?? ReminderModel.listDue;
    const due = await listDue(db, now, REMINDER_SWEEP_DUE_LIMIT);
    if (due.length === 0) return { counts, lock: lock.result };

    const runtime = await resolveFireRuntime(db, { ...deps, now });
    const loadRecipients =
      deps.loadRecipients ?? ((ids: string[]) => loadReminderRecipients(db, ids));
    const recipientsByReminder = await loadRecipients(due.map((row) => row.id));

    for (const reminder of due) {
      try {
        await fireOneReminder(db, reminder, recipientsByReminder.get(reminder.id) ?? [], runtime);
        counts.fired += 1;
      } catch (error) {
        counts.failed += 1;
        log('fire failed reminder=%s %O', reminder.id, error);
      }
    }

    return { counts, lock: lock.result };
  } finally {
    await lock.release();
  }
};

const fireOneReminder = async (
  db: LobeChatDatabase,
  reminder: ReminderItem,
  recipients: ReminderRecipientItem[],
  deps: ReminderFireRuntime,
  options: { title?: string } = {},
): Promise<{ deliveries: ReminderFireDeliveryInput[]; reminder: ReminderItem }> => {
  const { activeIds: staffIds, inactiveIds } = await expandStaffIds(recipients, deps);
  const tz = reminder.timezone || REMINDER_DEFAULT_TZ;
  const summaryTitle = reminderSummaryTitle(options.title, reminder.content);
  const inboxTitle = formatReminderOaBodyTitle(deps.headText, summaryTitle, reminder.creatorName);
  const inboxBody = buildReminderNotice({
    content: reminder.content,
    creatorName: reminder.creatorName,
    firedAt: deps.now,
    repeatRule: reminder.repeatRule ?? null,
    timezone: tz,
  });
  const oa = buildReminderWorkNoticeOa({
    content: reminder.content,
    creatorName: reminder.creatorName,
    firedAt: deps.now,
    headText: deps.headText,
    repeatRule: reminder.repeatRule ?? null,
    timezone: tz,
    title: summaryTitle,
  });
  const robotMarkdown = buildReminderRobotMarkdown({
    content: reminder.content,
    creatorName: reminder.creatorName,
    firedAt: deps.now,
    headText: deps.headText,
    repeatRule: reminder.repeatRule ?? null,
    timezone: tz,
    title: summaryTitle,
  });
  const userIds = new Map<string, string>();
  await Promise.all(
    [...staffIds, ...inactiveIds].map(async (staffId) => {
      const userId = await deps.resolveUserId(staffId);
      if (userId) userIds.set(staffId, userId);
    }),
  );

  const skippedChannel = (reason: string) => ({
    failedReason: reason,
    providerTaskId: null,
    robotFailedReason: reason,
    robotMessageId: null,
    robotStatus: 'skipped' as const,
  });

  const deliveries: ReminderFireDeliveryInput[] = inactiveIds.map((staffId) => ({
    ...skippedChannel(INACTIVE_DELIVERY_REASON),
    staffId,
    status: 'skipped' as const,
    userId: userIds.get(staffId) ?? null,
  }));

  const next = reminder.repeatRule
    ? nextFireAt(reminder.repeatRule as ReminderRepeatRule, deps.now, tz)
    : null;
  const resolveStatus = (hasActive: boolean) => {
    if (next) return 'scheduled' as const;
    if (reminder.taskId) return 'sent' as const;
    if (reminder.repeatRule) return 'expired' as const;
    return hasActive ? ('sent' as const) : ('failed' as const);
  };

  const persistFire = async (status: ReminderItem['status']): Promise<ReminderItem> => {
    if (deps.persistMode === 'deliveries') {
      try {
        await ReminderModel.insertDeliveries(db, {
          deliveries,
          firedAt: deps.now,
          reminderId: reminder.id,
        });
      } catch (error) {
        log('insert deliveries failed reminder=%s %O', reminder.id, error);
      }
      return reminder;
    }
    return deps.recordFire(db, {
      deliveries,
      firedAt: deps.now,
      nextFireAt: next,
      reminderId: reminder.id,
      status,
    });
  };

  if (staffIds.length === 0) {
    const updated = await persistFire(resolveStatus(false));
    return { deliveries, reminder: updated };
  }

  if (!deps.notifyConfigured) {
    for (const staffId of staffIds) {
      deliveries.push({
        ...skippedChannel(NOTIFY_APP_NOT_CONFIGURED),
        staffId,
        status: 'skipped',
        userId: userIds.get(staffId) ?? null,
      });
    }
  } else {
    const workByStaff = new Map<
      string,
      { failedReason?: string; status: 'failed' | 'sent' | 'skipped'; taskId?: string }
    >();
    const robotByStaff = new Map<
      string,
      { failedReason?: string; processQueryKey?: string; status: 'failed' | 'sent' | 'skipped' }
    >();

    try {
      await Promise.all([
        (async () => {
          if (!deps.workNoticeEnabled) {
            for (const staffId of staffIds) {
              workByStaff.set(staffId, { failedReason: CHANNEL_DISABLED, status: 'skipped' });
            }
            return;
          }
          for (const chunk of chunkStaffIds(staffIds, DINGTALK_WORK_NOTICE_USERID_CHUNK)) {
            const result = await deliverWorkNoticeChunk({ oa, send: deps.send, staffIds: chunk });
            for (const staffId of result.staffIds) {
              workByStaff.set(staffId, result);
            }
          }
        })(),
        (async () => {
          if (!deps.robotEnabled) {
            for (const staffId of staffIds) {
              robotByStaff.set(staffId, { failedReason: CHANNEL_DISABLED, status: 'skipped' });
            }
            return;
          }
          for (const chunk of chunkStaffIds(staffIds, DINGTALK_ROBOT_USERID_CHUNK)) {
            const result = await deliverRobotChunk({
              markdown: robotMarkdown,
              send: deps.sendRobot,
              staffIds: chunk,
            });
            for (const staffId of result.staffIds) {
              robotByStaff.set(staffId, result);
            }
          }
        })(),
      ]);

      for (const staffId of staffIds) {
        const work = workByStaff.get(staffId);
        const robot = robotByStaff.get(staffId);
        deliveries.push({
          failedReason: work?.failedReason ?? null,
          providerTaskId: work?.taskId ?? null,
          robotFailedReason: robot?.failedReason ?? null,
          robotMessageId: robot?.processQueryKey ?? null,
          robotStatus: robot?.status ?? 'failed',
          staffId,
          status: work?.status ?? 'failed',
          userId: userIds.get(staffId) ?? null,
        });
      }
    } catch (error) {
      log('deliver channels failed reminder=%s %O', reminder.id, error);
      const reason = error instanceof Error ? error.message : 'deliver_failed';
      for (const staffId of staffIds) {
        if (deliveries.some((row) => row.staffId === staffId)) continue;
        deliveries.push({
          failedReason: reason,
          providerTaskId: null,
          robotFailedReason: reason,
          robotMessageId: null,
          robotStatus: 'failed',
          staffId,
          status: 'failed',
          userId: userIds.get(staffId) ?? null,
        });
      }
      if (deps.persistMode !== 'deliveries') throw error;
    }
  }

  const firedAt = deps.now;

  const updated = await persistFire(resolveStatus(true));

  const dedupeKey = `reminder:${reminder.id}:${firedAt.toISOString()}`;
  for (const delivery of deliveries) {
    const delivered = delivery.status === 'sent' || delivery.robotStatus === 'sent';
    if (!delivered || !delivery.userId) continue;
    try {
      await deps.createInbox({
        content: inboxBody.text,
        dedupeKey,
        title: inboxTitle,
        userId: delivery.userId,
      });
    } catch (error) {
      log('inbox notify failed user=%s %O', delivery.userId, error);
    }
  }

  return { deliveries, reminder: updated };
};

export interface ReminderDeliverResult {
  failed: number;
  firedAt: Date;
  reminder: ReminderItem;
  sent: number;
  skipped: number;
}

const countDeliveries = (
  deliveries: ReminderFireDeliveryInput[],
): Pick<ReminderDeliverResult, 'failed' | 'sent' | 'skipped'> => {
  const counts = { failed: 0, sent: 0, skipped: 0 };
  for (const delivery of deliveries) {
    if (
      delivery.status === 'sent' ||
      delivery.status === 'failed' ||
      delivery.status === 'skipped'
    ) {
      counts[delivery.status] += 1;
    }
  }
  return counts;
};

/**
 * Deliver a single reminder through the same work-notice + robot + inbox path
 * as the legacy sweep. Used by reminder tasks (tick / 立即发送).
 */
export const deliverReminder = async (
  db: LobeChatDatabase,
  reminder: ReminderItem,
  deps: ReminderSweepDeps & { recipients?: ReminderRecipientItem[]; title?: string } = {},
): Promise<ReminderDeliverResult> => {
  const runtime = await resolveFireRuntime(db, deps);
  const recipients =
    deps.recipients ??
    (
      await (deps.loadRecipients ?? ((ids: string[]) => loadReminderRecipients(db, ids)))([
        reminder.id,
      ])
    ).get(reminder.id) ??
    [];
  const { deliveries, reminder: updated } = await fireOneReminder(
    db,
    reminder,
    recipients,
    runtime,
    { title: deps.title },
  );
  return { ...countDeliveries(deliveries), firedAt: runtime.now, reminder: updated };
};

export const isReminderWorkerRuntime = (env: Partial<NodeJS.ProcessEnv> = process.env): boolean => {
  if (!env.DATABASE_URL) return false;
  if (env.VERCEL === '1' || Boolean(env.VERCEL_ENV)) return false;
  if (env.NEXT_RUNTIME === 'edge') return false;
  if (env.AWS_LAMBDA_FUNCTION_NAME) return false;
  return true;
};

let started = false;
let timer: ReturnType<typeof setInterval> | undefined;

export const isReminderWorkerStarted = (): boolean => started;

export const ensureReminderWorkerStarted = (deps: ReminderSweepDeps = {}): void => {
  if (started) return;
  if (!isReminderWorkerRuntime()) {
    log('skip start: missing DATABASE_URL or serverless host');
    return;
  }

  started = true;
  const tick = () => {
    void (async () => {
      const db = await getServerDB();
      await runReminderSweep(db, deps);
    })().catch((error) => {
      console.error('[reminder] sweep failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    });
  };

  tick();
  timer = setInterval(tick, REMINDER_SWEEP_INTERVAL_MS);
  timer.unref();
  log('started interval=%dms', REMINDER_SWEEP_INTERVAL_MS);
};

export const stopReminderWorker = (): void => {
  started = false;
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
};

export const stopReminderWorkerForTest = (): void => {
  stopReminderWorker();
};
