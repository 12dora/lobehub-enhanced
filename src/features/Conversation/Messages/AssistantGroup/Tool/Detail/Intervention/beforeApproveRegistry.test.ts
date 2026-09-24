import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BeforeApproveRefusedError,
  BeforeApproveTimeoutError,
  getBeforeApproveSnapshot,
  markInterventionMounted,
  registerBeforeApproveCheck,
  runBeforeApproveChecks,
  runBeforeApproveWhenReady,
} from './beforeApproveRegistry';

const cleanups: Array<() => void> = [];
const track = (cleanup: () => void) => {
  cleanups.push(cleanup);
  return cleanup;
};

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
  vi.useRealTimers();
});

/** What a DingTalk confirm card's check throws until its preview arrived. */
const loadingCheck = () =>
  vi.fn(() => {
    throw new Error('DINGTALK_PERSONAL_PREVIEW_LOADING');
  });

/** Settles the promise's state without awaiting it. */
const watch = (promise: Promise<void>) => {
  const state: { error?: unknown; status: 'pending' | 'rejected' | 'resolved' } = {
    status: 'pending',
  };
  promise.then(
    () => {
      state.status = 'resolved';
    },
    (error) => {
      state.status = 'rejected';
      state.error = error;
    },
  );
  return state;
};

describe('beforeApproveRegistry', () => {
  it('tracks checks and the mounted card per tool message', () => {
    const check = vi.fn();
    const unregister = registerBeforeApproveCheck('reg-1', 'confirm', check);
    const unmark = markInterventionMounted('reg-1');

    expect(getBeforeApproveSnapshot('reg-1')).toMatchObject({ checkCount: 1, mounted: true });

    unregister();
    unmark();
    expect(getBeforeApproveSnapshot('reg-1')).toMatchObject({ checkCount: 0, mounted: false });
  });

  it('a stale cleanup never removes the registration that replaced it', () => {
    const first = registerBeforeApproveCheck('reg-2', 'confirm', vi.fn());
    track(registerBeforeApproveCheck('reg-2', 'confirm', vi.fn()));

    first();

    expect(getBeforeApproveSnapshot('reg-2').checkCount).toBe(1);
  });

  it('runs every check once', async () => {
    const a = vi.fn();
    const b = vi.fn(async () => {});
    track(registerBeforeApproveCheck('reg-3', 'a', a));
    track(registerBeforeApproveCheck('reg-3', 'b', b));

    await runBeforeApproveChecks('reg-3');

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe('runBeforeApproveWhenReady', () => {
  it('resolves right away for a mounted card without checks', async () => {
    track(markInterventionMounted('ready-1'));

    await expect(runBeforeApproveWhenReady('ready-1')).resolves.toBeUndefined();
  });

  it('waits until the card is on screen', async () => {
    const state = watch(runBeforeApproveWhenReady('ready-2'));
    await Promise.resolve();
    await Promise.resolve();
    expect(state.status).toBe('pending');

    track(markInterventionMounted('ready-2'));
    await vi.waitFor(() => expect(state.status).toBe('resolved'));
  });

  it('waits for a loading preview and runs the check the card re-registered', async () => {
    vi.useFakeTimers();
    const loading = loadingCheck();
    const unregisterLoading = registerBeforeApproveCheck('ready-3', 'confirm', loading);
    track(markInterventionMounted('ready-3'));

    const state = watch(runBeforeApproveWhenReady('ready-3', { settleMs: 5000 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.status).toBe('pending');

    // Preview arrived: the card re-registers as cleanup + register in one commit.
    const ready = vi.fn();
    unregisterLoading();
    track(registerBeforeApproveCheck('ready-3', 'confirm', ready));
    await vi.advanceTimersByTimeAsync(0);

    expect(state.status).toBe('resolved');
    expect(ready).toHaveBeenCalledTimes(1);
    // Never probed while loading: no "still loading" toast from the card.
    expect(loading).not.toHaveBeenCalled();
  });

  it('probes a check that never re-registers once it has been quiet long enough', async () => {
    vi.useFakeTimers();
    const check = vi.fn();
    track(registerBeforeApproveCheck('ready-4', 'flush', check));
    track(markInterventionMounted('ready-4'));

    const state = watch(runBeforeApproveWhenReady('ready-4', { settleMs: 2000 }));
    await vi.advanceTimersByTimeAsync(1999);
    expect(check).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);
    expect(state.status).toBe('resolved');
  });

  it('after a "still loading" answer waits for the card to re-register before asking again', async () => {
    vi.useFakeTimers();
    const loading = loadingCheck();
    const unregisterLoading = registerBeforeApproveCheck('ready-5', 'confirm', loading);
    track(markInterventionMounted('ready-5'));

    const state = watch(runBeforeApproveWhenReady('ready-5', { settleMs: 100 }));
    await vi.advanceTimersByTimeAsync(100);
    expect(loading).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(loading).toHaveBeenCalledTimes(1);
    expect(state.status).toBe('pending');

    const ready = vi.fn();
    unregisterLoading();
    track(registerBeforeApproveCheck('ready-5', 'confirm', ready));
    await vi.advanceTimersByTimeAsync(0);

    expect(ready).toHaveBeenCalledTimes(1);
    expect(state.status).toBe('resolved');
  });

  it('never probes a check that reports it is pending', async () => {
    vi.useFakeTimers();
    const pending = vi.fn();
    const unregisterPending = registerBeforeApproveCheck('ready-6', 'confirm', pending, {
      pending: true,
    });
    track(markInterventionMounted('ready-6'));

    const state = watch(runBeforeApproveWhenReady('ready-6', { settleMs: 100 }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pending).not.toHaveBeenCalled();
    expect(state.status).toBe('pending');

    const ready = vi.fn();
    unregisterPending();
    track(registerBeforeApproveCheck('ready-6', 'confirm', ready));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.status).toBe('resolved');
  });

  it('rejects with the refusal when the check refuses', async () => {
    vi.useFakeTimers();
    const refusal = new Error('DINGTALK_PREVIEW_ERROR');
    const unregisterLoading = registerBeforeApproveCheck('ready-7', 'confirm', loadingCheck());
    track(markInterventionMounted('ready-7'));

    const state = watch(runBeforeApproveWhenReady('ready-7', { settleMs: 5000 }));

    // Preview failed (e.g. NOT_FOUND): the card re-registers a refusing check.
    unregisterLoading();
    track(
      registerBeforeApproveCheck('ready-7', 'confirm', () => {
        throw refusal;
      }),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(state.status).toBe('rejected');
    expect(state.error).toBeInstanceOf(BeforeApproveRefusedError);
    expect((state.error as BeforeApproveRefusedError).reason).toBe(refusal);
  });

  it('times out when the card never becomes approvable', async () => {
    vi.useFakeTimers();

    const state = watch(runBeforeApproveWhenReady('ready-8', { timeoutMs: 20_000 }));
    await vi.advanceTimersByTimeAsync(19_999);
    expect(state.status).toBe('pending');

    await vi.advanceTimersByTimeAsync(1);
    expect(state.status).toBe('rejected');
    expect(state.error).toBeInstanceOf(BeforeApproveTimeoutError);
  });

  it('stops waiting when aborted', async () => {
    const check = vi.fn();
    track(registerBeforeApproveCheck('ready-9', 'confirm', check));
    const controller = new AbortController();

    const state = watch(runBeforeApproveWhenReady('ready-9', { signal: controller.signal }));
    controller.abort();
    await vi.waitFor(() => expect(state.status).toBe('rejected'));

    track(markInterventionMounted('ready-9'));
    await Promise.resolve();
    expect(check).not.toHaveBeenCalled();
  });
});
