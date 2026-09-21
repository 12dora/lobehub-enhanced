// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DingtalkWorkspaceError } from '../errors';
import {
  paceInstanceDetail,
  paceInstanceIdsQuery,
  resetApprovalApiPaceForTest,
  sleepUnref,
} from './scanPace';

describe('approval scan pacing', () => {
  beforeEach(() => {
    resetApprovalApiPaceForTest({ maxRps: Number.POSITIVE_INFINITY });
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('unrefs sleep timers so retries do not keep the process alive', async () => {
    const unref = vi.fn();
    const spy = vi.spyOn(global, 'setTimeout').mockImplementation((handler) => {
      if (typeof handler === 'function') queueMicrotask(() => (handler as () => void)());
      return { unref } as unknown as ReturnType<typeof setTimeout>;
    });
    await sleepUnref(500);
    expect(unref).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('retries a rate-limited call up to three times with 500ms/1s/2s backoff', async () => {
    vi.useFakeTimers();
    resetApprovalApiPaceForTest({ maxRps: Number.POSITIVE_INFINITY });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_RATE_LIMITED'))
      .mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_RATE_LIMITED'))
      .mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_RATE_LIMITED'))
      .mockResolvedValueOnce('ok');
    const pending = paceInstanceIdsQuery(fn);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('spaces instance-id and instance-detail starts so each API stays at 8 rps', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetApprovalApiPaceForTest({ concurrency: 2, maxRps: 8 });
    const queryStarts: number[] = [];
    const detailStarts: number[] = [];
    const query = Promise.all(
      Array.from({ length: 3 }, () =>
        paceInstanceIdsQuery(async () => {
          queryStarts.push(Date.now());
        }),
      ),
    );
    const detail = Promise.all(
      Array.from({ length: 3 }, () =>
        paceInstanceDetail(async () => {
          detailStarts.push(Date.now());
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(300);
    await Promise.all([query, detail]);
    expect(queryStarts[1]! - queryStarts[0]!).toBeGreaterThanOrEqual(125);
    expect(queryStarts[2]! - queryStarts[1]!).toBeGreaterThanOrEqual(125);
    expect(detailStarts[1]! - detailStarts[0]!).toBeGreaterThanOrEqual(125);
  });
});
