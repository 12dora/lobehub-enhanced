import debug from 'debug';
import type { Context } from 'hono';

import { runHeartbeatTick } from '@/server/services/taskRunner/heartbeatTick';

const log = debug('lobe-server:workflows:task:heartbeat-tick');

export interface HeartbeatTickPayload {
  taskId: string;
  userId: string;
}

export interface HeartbeatDueInput {
  heartbeatInterval: number | null | undefined;
  lastHeartbeatAt: Date | string | null | undefined;
  now?: Date;
}

/**
 * Whether a heartbeat-mode task's next tick (`lastHeartbeatAt + heartbeatInterval`)
 * is due. `lastHeartbeatAt == null` means never ticked → due (restart catch-up).
 * Pure: no I/O. Shared by the QStash handler's local worker catch-up path.
 */
export const isHeartbeatTickDue = (input: HeartbeatDueInput): boolean => {
  const { heartbeatInterval, lastHeartbeatAt, now = new Date() } = input;
  if (!heartbeatInterval || heartbeatInterval <= 0) return false;
  if (!lastHeartbeatAt) return true;
  const last = lastHeartbeatAt instanceof Date ? lastHeartbeatAt : new Date(lastHeartbeatAt);
  if (Number.isNaN(last.getTime())) return true;
  return last.getTime() + heartbeatInterval * 1000 <= now.getTime();
};

export async function heartbeatTick(c: Context) {
  try {
    const body = (await c.req.json()) as HeartbeatTickPayload;
    const { taskId, userId } = body;
    if (!taskId || !userId) {
      return c.json({ error: 'Missing required fields: taskId, userId' }, 400);
    }

    log('Received tick: taskId=%s userId=%s', taskId, userId);
    const outcome = await runHeartbeatTick(taskId, userId);
    return c.json({ success: true, ...outcome });
  } catch (error) {
    console.error('[task/heartbeat-tick] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
