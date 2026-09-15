import debug from 'debug';
import type { Context } from 'hono';

import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { getServerDB } from '@/database/server';
import { TaskNotificationService } from '@/server/services/taskNotification';

const log = debug('lobe-server:workflows:task:watchdog');

export interface WatchdogScanResult {
  checked: number;
  failed: string[];
}

/**
 * Scan stuck `running` tasks and mark them `failed` with an urgent brief.
 * Used by the QStash `/watchdog` handler and the local in-process scheduler.
 */
export async function runWatchdogScan(): Promise<WatchdogScanResult> {
  const db = await getServerDB();
  const stuckTasks = await TaskModel.findStuckTasks(db);
  const failed: string[] = [];

  for (const task of stuckTasks) {
    const wsId = task.workspaceId ?? undefined;
    const taskModel = new TaskModel(db, task.createdByUserId, wsId);
    await taskModel.updateStatus(task.id, 'failed', {
      completedAt: new Date(),
      error: 'Heartbeat timeout',
    });

    const briefModel = new BriefModel(db, task.createdByUserId, wsId);
    await briefModel.create({
      agentId: task.assigneeAgentId || undefined,
      priority: 'urgent',
      summary: `Task has been running without heartbeat update for more than ${task.heartbeatTimeout} seconds.`,
      taskId: task.id,
      title: `${task.identifier} heartbeat timeout`,
      trigger: 'task',
      type: 'error',
    });

    await new TaskNotificationService().notify({
      agentId: task.assigneeAgentId || undefined,
      content: 'Heartbeat timeout',
      db,
      taskId: task.id,
      taskIdentifier: task.identifier,
      taskName: task.name,
      topicId: task.currentTopicId ?? undefined,
      type: 'task_run_failed',
      userId: task.createdByUserId,
    });

    failed.push(task.identifier);
  }

  log('Watchdog scan: checked=%d failed=%d', stuckTasks.length, failed.length);
  return {
    checked: stuckTasks.length,
    failed,
  };
}

/**
 * Cron-style watchdog. Scans all `running` tasks where
 * `lastHeartbeatAt + heartbeatTimeout < now()` and marks them `failed`,
 * leaving an urgent brief for the user.
 *
 * No per-user authentication: this is a global sweep registered as a QStash
 * Schedule (cron). Signature verification is handled by the `qstashAuth`
 * middleware mounted on the route.
 */
export async function watchdog(c: Context) {
  try {
    const result = await runWatchdogScan();
    return c.json({
      checked: result.checked,
      failed: result.failed,
      success: true,
    });
  } catch (error) {
    console.error('[task/watchdog] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
