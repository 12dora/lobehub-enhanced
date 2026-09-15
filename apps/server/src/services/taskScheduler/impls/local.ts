import debug from 'debug';

import type { ScheduleNextTopicParams, TaskSchedulerImpl } from './type';

const log = debug('task-scheduler:local');

export type TaskExecutionCallback = (taskId: string, userId: string) => Promise<void>;

/**
 * Local task scheduler using setTimeout
 * For local development without QStash
 */
export class LocalTaskScheduler implements TaskSchedulerImpl {
  private executionCallback: TaskExecutionCallback | null = null;
  private pendingSchedules: Map<string, NodeJS.Timeout> = new Map();
  /** One pending timer per task — used by the local sweep worker to avoid double ticks. */
  private pendingByTaskId: Map<string, string> = new Map();
  private taskIdByScheduleId: Map<string, string> = new Map();

  setExecutionCallback(callback: TaskExecutionCallback): void {
    this.executionCallback = callback;
  }

  hasPendingForTask(taskId: string): boolean {
    return this.pendingByTaskId.has(taskId);
  }

  async scheduleNextTopic(params: ScheduleNextTopicParams): Promise<string> {
    const { taskId, userId, delay = 0 } = params;

    // Heartbeat tasks re-arm after each run; keep a single pending timer per task
    // so a restart catch-up worker and a live setTimeout cannot both fire.
    const existingId = this.pendingByTaskId.get(taskId);
    if (existingId) {
      await this.cancelScheduled(existingId);
    }

    const scheduleId = `local-task-${taskId}-${Date.now()}`;

    log('Scheduling next topic for task %s (delay: %ds)', taskId, delay);

    const timer = setTimeout(async () => {
      this.clearPending(scheduleId, taskId);

      if (!this.executionCallback) {
        log('Warning: No execution callback set');
        return;
      }

      try {
        log('Executing next topic for task %s', taskId);
        await this.executionCallback(taskId, userId);
      } catch (error) {
        log('Failed to execute next topic for task %s: %O', taskId, error);
      }
    }, delay * 1000);

    this.pendingSchedules.set(scheduleId, timer);
    this.pendingByTaskId.set(taskId, scheduleId);
    this.taskIdByScheduleId.set(scheduleId, taskId);
    return scheduleId;
  }

  async cancelScheduled(scheduleId: string): Promise<void> {
    const timer = this.pendingSchedules.get(scheduleId);
    if (timer) {
      clearTimeout(timer);
      this.pendingSchedules.delete(scheduleId);
      const taskId = this.taskIdByScheduleId.get(scheduleId);
      this.taskIdByScheduleId.delete(scheduleId);
      if (taskId && this.pendingByTaskId.get(taskId) === scheduleId) {
        this.pendingByTaskId.delete(taskId);
      }
      log('Canceled schedule %s', scheduleId);
    }
  }

  private clearPending(scheduleId: string, taskId: string): void {
    this.pendingSchedules.delete(scheduleId);
    this.taskIdByScheduleId.delete(scheduleId);
    if (this.pendingByTaskId.get(taskId) === scheduleId) {
      this.pendingByTaskId.delete(taskId);
    }
  }
}
