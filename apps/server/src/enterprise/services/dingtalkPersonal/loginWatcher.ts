import { getServerDB } from '@/database/core/db-adaptor';

import { getDingtalkPersonalLoginJob } from './brokerClient';
import { DingtalkPersonalError } from './errors';
import { splitDingtalkPersonalProfile } from './identity';
import {
  getStoredDingtalkPersonalLogin,
  isDingtalkPersonalLoginCancelled,
  updateStoredDingtalkPersonalLogin,
} from './loginStore';

export const DINGTALK_PERSONAL_LOGIN_POLL_MS = 4_000;
export const DINGTALK_PERSONAL_LOGIN_WATCH_MS = 16 * 60 * 1000;

interface LoginNotifyInput {
  db: unknown;
  errorCode?: string;
  ok: boolean;
  staffId: string;
  userId: string;
  userName?: string;
}

type NotifyLoader = () => Promise<{
  notifyDingtalkPersonalLoginResult?: (input: LoginNotifyInput) => Promise<unknown>;
}>;

const defaultNotifyLoader: NotifyLoader = () =>
  import('@/server/services/messenger/platforms/dingtalk/personalAuthCard') as Promise<
    Awaited<ReturnType<NotifyLoader>>
  >;

let notifyLoader: NotifyLoader = defaultNotifyLoader;

export const setDingtalkPersonalLoginNotifyLoaderForTest = (loader: NotifyLoader | null): void => {
  notifyLoader = loader ?? defaultNotifyLoader;
};

const notifyLogin = async (input: LoginNotifyInput): Promise<void> => {
  try {
    const mod = await notifyLoader();
    if (typeof mod.notifyDingtalkPersonalLoginResult !== 'function') return;
    await mod.notifyDingtalkPersonalLoginResult(input);
  } catch {
    // Missing card module or a DingTalk send failure must not undo the login row.
  }
};

interface WatchState {
  inFlight: boolean;
  startedAt: number;
  timer: ReturnType<typeof setInterval>;
}

const watchers = new Map<string, WatchState>();

export const stopDingtalkPersonalLoginWatch = (jobId: string): void => {
  const state = watchers.get(jobId);
  if (!state) return;
  clearInterval(state.timer);
  watchers.delete(jobId);
};

export const resetDingtalkPersonalLoginWatchersForTest = (): void => {
  for (const jobId of watchers.keys()) stopDingtalkPersonalLoginWatch(jobId);
  notifyLoader = defaultNotifyLoader;
};

const tick = async (jobId: string): Promise<void> => {
  const state = watchers.get(jobId);
  if (!state || state.inFlight) return;
  if (Date.now() - state.startedAt >= DINGTALK_PERSONAL_LOGIN_WATCH_MS) {
    stopDingtalkPersonalLoginWatch(jobId);
    return;
  }

  state.inFlight = true;
  try {
    const meta = await getStoredDingtalkPersonalLogin(jobId);
    if (!meta) {
      stopDingtalkPersonalLoginWatch(jobId);
      return;
    }
    // A pending cancel must win over a poll that already observed success.
    if (await isDingtalkPersonalLoginCancelled(jobId)) return;
    const job = await getDingtalkPersonalLoginJob(jobId);
    if (await isDingtalkPersonalLoginCancelled(jobId)) return;
    const { finalizeDingtalkPersonalLogin, interpretDingtalkPersonalLoginJob } =
      await import('./service');
    const interpreted = interpretDingtalkPersonalLoginJob(meta, job);
    await updateStoredDingtalkPersonalLogin(jobId, interpreted.view);
    if (job.status === 'pending') return;

    if (job.status === 'succeeded' && !interpreted.reject) {
      if (await isDingtalkPersonalLoginCancelled(jobId)) return;
      const db = await getServerDB();
      await finalizeDingtalkPersonalLogin(db, meta, job);
    }
    stopDingtalkPersonalLoginWatch(jobId);
    if (meta.origin !== 'dingtalk') return;
    const parts = splitDingtalkPersonalProfile(meta.expectedProfile);
    if (!parts) return;
    const db = await getServerDB();
    await notifyLogin({
      db,
      errorCode: interpreted.view.errorCode,
      ok: interpreted.view.status === 'succeeded',
      staffId: parts.staffId,
      userId: meta.userId,
      userName: interpreted.userName,
    });
  } catch (error) {
    if (
      error instanceof DingtalkPersonalError &&
      error.code === 'DINGTALK_PERSONAL_LOGIN_NOT_FOUND'
    ) {
      stopDingtalkPersonalLoginWatch(jobId);
    }
  } finally {
    const current = watchers.get(jobId);
    if (current) current.inFlight = false;
  }
};

export const watchDingtalkPersonalLogin = (jobId: string): void => {
  if (watchers.has(jobId)) return;
  const timer = setInterval(() => {
    void tick(jobId);
  }, DINGTALK_PERSONAL_LOGIN_POLL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  watchers.set(jobId, { inFlight: false, startedAt: Date.now(), timer });
};
