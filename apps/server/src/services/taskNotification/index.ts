import type { NotificationSettings, TaskNotificationType } from '@lobechat/types';
import { TASK_NOTIFICATION_CATEGORY } from '@lobechat/types';
import debug from 'debug';

import { NotificationModel } from '@/database/models/notification';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { MessengerPushService } from '@/server/services/messenger/push';

import {
  buildDingtalkMarkdown,
  dingtalkPushTitle,
  INBOX_CONTENT_MAX_CHARS,
  isHeartbeatTimeoutContent,
  localizeTaskNotifyContent,
  sanitizeNotificationContent,
  TASK_NOTIFY_UNKNOWN_ERROR_ZH,
  taskCompletedNotifyBody,
} from './content';
import { isChannelEnabledForType, mergeNotificationSettings } from './prefs';

const log = debug('lobe-server:task-notification');

const DINGTALK_ACTION_LABEL = '在 AIHub 中查看';

export interface TaskNotifyInput {
  agentId?: string;
  content: string;
  db: LobeChatDatabase;
  /** Used as the dedupe suffix when `topicId` is missing (and this is not a heartbeat timeout). */
  operationId?: string;
  taskId: string;
  taskIdentifier: string;
  taskName?: string | null;
  topicId?: string;
  type: TaskNotificationType;
  /** Task owner (notifications.userId). */
  userId: string;
}

/**
 * `task:{taskId}:{type}:{suffix}` — suffix is `topicId`, else `heartbeat-timeout`
 * for heartbeat failures, else `operationId`, else `kickoff`. Never `Date.now()`.
 */
export const buildTaskNotifyDedupeKey = (input: {
  content?: string;
  operationId?: string;
  taskId: string;
  topicId?: string;
  type: TaskNotificationType;
}): string => {
  const suffix =
    input.topicId ??
    (isHeartbeatTimeoutContent(input.content) ? 'heartbeat-timeout' : undefined) ??
    input.operationId ??
    'kickoff';
  return `task:${input.taskId}:${input.type}:${suffix}`;
};

export interface TopicCompleteNotifyInput {
  db: LobeChatDatabase;
  errorMessage?: string;
  lastAssistantContent?: string;
  reason: string;
  taskId: string;
  taskIdentifier: string;
  topicId?: string;
  userId: string;
  workspaceId?: string;
}

/**
 * Produces inbox rows + DingTalk pushes for task lifecycle events.
 *
 * Schema notes:
 * - `notifications` has no jsonb metadata column — `agentId` is accepted on
 *   the input for callers but is not persisted.
 * - `notification_deliveries.notification_id` is NOT NULL. When inbox is off
 *   and DingTalk is on, a parent row is inserted with `isArchived=true` so
 *   the delivery has a parent and the bell does not show it — including when
 *   the push is `skipped` (connector / user not mapped).
 * - Push `skipped` still writes a delivery row
 *   `{ channel: 'dingtalk', status: 'skipped', failedReason }`. Duplicate
 *   parents are prevented by `findByDedupeKey` plus `ON CONFLICT DO NOTHING`
 *   on `(userId, dedupeKey)`.
 */
export class TaskNotificationService {
  async notify(input: TaskNotifyInput): Promise<void> {
    try {
      await this.notifyUnsafe(input);
    } catch (error) {
      log('notify failed: task=%s type=%s %O', input.taskId, input.type, error);
    }
  }

  private async notifyUnsafe(input: TaskNotifyInput): Promise<void> {
    const { db, userId, taskId, taskIdentifier, type, topicId, operationId } = input;
    const taskName = input.taskName?.trim() || taskIdentifier;
    const rawContent = localizeTaskNotifyContent(input.content);
    const content = sanitizeNotificationContent(rawContent, INBOX_CONTENT_MAX_CHARS);
    const actionUrl = `/task/${taskId}`;
    const dedupeKey = buildTaskNotifyDedupeKey({
      content: input.content,
      operationId,
      taskId,
      topicId,
      type,
    });

    const userSettings = await new UserModel(db, userId).getUserSettings();
    const prefs = mergeNotificationSettings(
      userSettings?.notification as NotificationSettings | null | undefined,
    );
    const inboxEnabled = isChannelEnabledForType(prefs, 'inbox', type);
    const dingtalkEnabled = isChannelEnabledForType(prefs, 'dingtalk', type);

    if (!inboxEnabled && !dingtalkEnabled) {
      log('skip (channels off): task=%s type=%s', taskId, type);
      return;
    }

    const model = new NotificationModel(db, userId);
    const existing = await model.findByDedupeKey(dedupeKey);
    if (existing) {
      log('skip (dedupe): task=%s type=%s key=%s', taskId, type, dedupeKey);
      return;
    }

    const ensureParent = async () => {
      const created = await model.create({
        actionUrl,
        category: TASK_NOTIFICATION_CATEGORY,
        content,
        dedupeKey,
        isArchived: !inboxEnabled,
        title: taskName,
        type,
      });
      if (!created) {
        log('skip (create conflict): task=%s type=%s key=%s', taskId, type, dedupeKey);
      }
      return created;
    };

    const pushMessage = {
      actionLabel: DINGTALK_ACTION_LABEL,
      actionUrl,
      markdown: buildDingtalkMarkdown(taskName, rawContent, new Date()),
      title: dingtalkPushTitle(type, taskName),
    };

    const recordDingTalkDelivery = async (
      notificationId: string,
      push: Awaited<ReturnType<MessengerPushService['pushToUser']>>,
    ) => {
      if (push.status === 'skipped') {
        log('dingtalk skipped: task=%s reason=%s', taskId, push.reason);
        await model.createDelivery({
          channel: 'dingtalk',
          failedReason: push.reason,
          notificationId,
          status: 'skipped',
        });
        return;
      }
      if (push.status === 'sent') {
        await model.createDelivery({
          channel: 'dingtalk',
          notificationId,
          providerMessageId: push.providerMessageId,
          sentAt: new Date(),
          status: 'sent',
        });
        return;
      }
      await model.createDelivery({
        channel: 'dingtalk',
        failedReason: push.error,
        notificationId,
        status: 'failed',
      });
    };

    const created = await ensureParent();
    if (!created) return;

    if (inboxEnabled) {
      await model.createDelivery({
        channel: 'inbox',
        notificationId: created.id,
        sentAt: new Date(),
        status: 'sent',
      });
    }

    if (!dingtalkEnabled) return;

    const push = await new MessengerPushService(db).pushToUser({
      message: pushMessage,
      platform: 'dingtalk',
      userId,
    });
    await recordDingTalkDelivery(created.id, push);
  }
}

/**
 * Map a topic-complete (or park) lifecycle event onto notification types.
 * One run yields at most one row per type via `dedupeKey`.
 *
 * - `done` → `task_run_completed` (content = last assistant text, else handoff summary)
 * - `done` + task canceled → no run-completed notice (cancel won the race)
 * - `done` + task paused (checkpoint / review) → also `task_waiting_for_user`
 * - `done` + task completed (e.g. schedule cap) → also `task_completed`
 * - `error` → `task_run_failed`
 * - `waiting_for_human` → `task_waiting_for_user` (agent question)
 */
export const notifyAfterTopicComplete = async (input: TopicCompleteNotifyInput): Promise<void> => {
  try {
    const { db, userId, workspaceId, taskId, taskIdentifier, topicId, reason } = input;
    const task = await new TaskModel(db, userId, workspaceId).findById(taskId);
    const handoffSummary = topicId
      ? await readHandoffSummary(db, userId, workspaceId, taskId, topicId)
      : undefined;
    const runContent =
      input.lastAssistantContent?.trim() || handoffSummary || input.errorMessage?.trim() || '';

    const service = new TaskNotificationService();
    const base = {
      agentId: task?.assigneeAgentId ?? undefined,
      db,
      taskId,
      taskIdentifier,
      taskName: task?.name,
      topicId,
      userId,
    };

    if (reason === 'error') {
      await service.notify({
        ...base,
        content: input.errorMessage?.trim() || runContent || TASK_NOTIFY_UNKNOWN_ERROR_ZH,
        type: 'task_run_failed',
      });
      return;
    }

    if (reason === 'waiting_for_human') {
      await service.notify({
        ...base,
        content: runContent,
        type: 'task_waiting_for_user',
      });
      return;
    }

    if (reason !== 'done') return;

    // This read is after the run settles. A cancel that landed first must
    // not be announced as a completed run.
    if (task?.status === 'canceled') return;

    await service.notify({
      ...base,
      content: runContent,
      type: 'task_run_completed',
    });

    if (task?.status === 'paused') {
      await service.notify({
        ...base,
        content: runContent,
        type: 'task_waiting_for_user',
      });
    }

    if (task?.status === 'completed') {
      await service.notify({
        ...base,
        content: taskCompletedNotifyBody({
          fallbackTitle: task.name || taskIdentifier,
          lastAssistant: runContent,
        }),
        type: 'task_completed',
      });
    }
  } catch (error) {
    log('notifyAfterTopicComplete failed: task=%s %O', input.taskId, error);
  }
};

const readHandoffSummary = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  taskId: string,
  topicId: string,
): Promise<string | undefined> => {
  try {
    const rows = await new TaskTopicModel(db, userId, workspaceId).findByTaskId(taskId);
    const row = rows.find((item) => item.topicId === topicId);
    const handoff = row?.handoff as { content?: string; summary?: string } | null;
    return handoff?.summary?.trim() || handoff?.content?.trim() || undefined;
  } catch (error) {
    log('readHandoffSummary failed: task=%s topic=%s %O', taskId, topicId, error);
    return undefined;
  }
};

export {
  buildDingtalkMarkdown,
  DINGTALK_CONTENT_MAX_CHARS,
  dingtalkPushTitle,
  INBOX_CONTENT_MAX_CHARS,
  isHeartbeatTimeoutContent,
  localizeTaskNotifyContent,
  sanitizeNotificationContent,
  sanitizeTaskNameForMarkdown,
  TASK_NOTIFICATION_ZH_LABELS,
  TASK_NOTIFY_HEARTBEAT_TIMEOUT_ZH,
  TASK_NOTIFY_UNKNOWN_ERROR_ZH,
} from './content';
export { isChannelEnabledForType, mergeNotificationSettings } from './prefs';
