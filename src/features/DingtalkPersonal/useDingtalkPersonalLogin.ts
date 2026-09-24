'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type DingtalkPersonalLoginView,
  dingtalkPersonalService,
} from '@/services/dingtalkPersonal';

import { resolveDingtalkPersonalErrorCode } from './errors';

export const LOGIN_POLL_INTERVAL_MS = 3000;
/**
 * How long past the code's expiry a pending job is still asked about. A consent given in the last
 * seconds is only seen by the sidecar a moment later; after this the code cannot be used any more.
 */
export const LOGIN_EXPIRY_GRACE_MS = 15_000;

export interface UseDingtalkPersonalLoginParams {
  onSucceeded?: (login: DingtalkPersonalLoginView) => void;
  /**
   * A job the server still holds for this member (`getStatus().pendingLogin`). It is adopted so a
   * reload — or a second card on the page — resumes the same code instead of starting another.
   */
  pendingLogin?: DingtalkPersonalLoginView;
}

export interface DingtalkPersonalLoginController {
  /** Explicit cancel only: leaving the page never cancels, the server keeps finalizing. */
  cancel: () => Promise<void>;
  /**
   * The last cancel did not reach the server. The code may still be approved, so the job stays in
   * view (and polled) rather than pretending it is gone.
   */
  cancelFailed: boolean;
  cancelling: boolean;
  login?: DingtalkPersonalLoginView;
  /** Drops a finished job from view (after the status has caught up with it). */
  reset: () => void;
  start: () => Promise<void>;
  /** Set when `startLogin` threw; `code` is the router's error code when it carried one. */
  startError?: { code?: string };
  starting: boolean;
}

/**
 * One device-code login: start it, poll it every 3 s until it is over, cancel it on request.
 *
 * The code lives on the server for 15 minutes, so nothing here is torn down with the component
 * except the poll itself — a member who closes the card and consents on their phone is still
 * authorized by the server's own watcher.
 */
export const useDingtalkPersonalLogin = ({
  onSucceeded,
  pendingLogin,
}: UseDingtalkPersonalLoginParams = {}): DingtalkPersonalLoginController => {
  const [local, setLocal] = useState<DingtalkPersonalLoginView | undefined>();
  // A job this card already finished with (succeeded or cancelled) is never adopted again, even
  // while a stale status read still reports it as pending.
  const [settledJobId, setSettledJobId] = useState<string | undefined>();
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelFailed, setCancelFailed] = useState(false);
  const [startError, setStartError] = useState<{ code?: string } | undefined>();

  const adopted =
    !local && pendingLogin?.status === 'pending' && pendingLogin.jobId !== settledJobId
      ? pendingLogin
      : undefined;
  const login = local ?? adopted;

  const loginRef = useRef(login);
  loginRef.current = login;
  const onSucceededRef = useRef(onSucceeded);
  onSucceededRef.current = onSucceeded;
  const startingRef = useRef(false);

  const settle = useCallback((next: DingtalkPersonalLoginView) => {
    setLocal(next);
    setCancelFailed(false);
    if (next.status === 'succeeded') {
      setSettledJobId(next.jobId);
      onSucceededRef.current?.(next);
    }
  }, []);

  const pollingJobId = login?.status === 'pending' ? login.jobId : undefined;
  const pollingExpiresAt = login?.status === 'pending' ? login.expiresAt : undefined;

  useEffect(() => {
    if (!pollingJobId) return;

    let disposed = false;
    let inFlight = false;
    const deadline = Date.parse(pollingExpiresAt ?? '') + LOGIN_EXPIRY_GRACE_MS;

    const expireLocally = () => {
      const current = loginRef.current;
      if (current?.jobId === pollingJobId) setLocal({ ...current, status: 'expired' });
    };

    const tick = async () => {
      if (inFlight || disposed) return;
      if (Number.isFinite(deadline) && Date.now() > deadline) {
        expireLocally();
        return;
      }

      inFlight = true;
      try {
        const next = await dingtalkPersonalService.getLoginJob({ jobId: pollingJobId });
        if (!disposed && next.status !== 'pending') settle(next);
      } catch (error) {
        // The server forgets a job 30 min after it ends; anything else is a blip the next tick
        // retries.
        if (
          !disposed &&
          resolveDingtalkPersonalErrorCode(error) === 'DINGTALK_PERSONAL_LOGIN_NOT_FOUND'
        )
          expireLocally();
      } finally {
        inFlight = false;
      }
    };

    const timer = setInterval(() => void tick(), LOGIN_POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [pollingExpiresAt, pollingJobId, settle]);

  const start = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setStartError(undefined);
    try {
      settle(await dingtalkPersonalService.startLogin());
    } catch (error) {
      setStartError({ code: resolveDingtalkPersonalErrorCode(error) });
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }, [settle]);

  const cancel = useCallback(async () => {
    const current = loginRef.current;
    if (!current) return;

    setCancelling(true);
    setCancelFailed(false);
    try {
      await dingtalkPersonalService.cancelLogin({ jobId: current.jobId });
    } catch (error) {
      // Only a job the server no longer knows is as good as cancelled. Any other failure leaves a
      // code that can still be approved, so the card keeps showing (and polling) it.
      if (resolveDingtalkPersonalErrorCode(error) !== 'DINGTALK_PERSONAL_LOGIN_NOT_FOUND') {
        setCancelFailed(true);
        return;
      }
    } finally {
      setCancelling(false);
    }
    setSettledJobId(current.jobId);
    setLocal(undefined);
  }, []);

  const reset = useCallback(() => {
    const current = loginRef.current;
    if (current) setSettledJobId(current.jobId);
    setLocal(undefined);
    setStartError(undefined);
    setCancelFailed(false);
  }, []);

  return { cancel, cancelFailed, cancelling, login, reset, start, startError, starting };
};
