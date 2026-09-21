import { DingtalkWorkspaceError } from '../errors';
import {
  INSTANCE_DETAIL_CONCURRENCY,
  INSTANCE_IDS_QUERY_CONCURRENCY,
  SCAN_API_MAX_RPS,
  SCAN_RATE_LIMIT_BACKOFF_MS,
  SCAN_RATE_LIMIT_RETRY_COUNT,
} from './types';

export const isRateLimitedError = (error: unknown): boolean =>
  error instanceof DingtalkWorkspaceError && error.code === 'DINGTALK_RATE_LIMITED';

const unrefTimer = (timer: ReturnType<typeof setTimeout>): void => {
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    const unref = Reflect.get(timer, 'unref');
    if (typeof unref === 'function') unref.call(timer);
  }
};

export const sleepUnref = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    unrefTimer(timer);
  });

const minGapMsFor = (maxRps: number): number => {
  if (!Number.isFinite(maxRps) || maxRps <= 0) return 0;
  return Math.ceil(1000 / maxRps);
};

type GateWaiter = { resolve: () => void };

class ApiGate {
  private inFlight = 0;
  private lastStartedAt = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly waiters: GateWaiter[] = [];

  constructor(
    private concurrency: number,
    private minGapMs: number,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push({ resolve });
      this.pump();
    });
  }

  private release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.pump();
  }

  private pump(): void {
    if (this.timer) return;
    while (this.waiters.length > 0 && this.inFlight < this.concurrency) {
      const wait = this.lastStartedAt + this.minGapMs - Date.now();
      if (wait > 0) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          this.pump();
        }, wait);
        unrefTimer(this.timer);
        return;
      }
      const waiter = this.waiters.shift();
      if (!waiter) return;
      this.inFlight += 1;
      this.lastStartedAt = Date.now();
      waiter.resolve();
    }
  }
}

const withRateLimitRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (!isRateLimitedError(error) || attempt >= SCAN_RATE_LIMIT_RETRY_COUNT) throw error;
      await sleepUnref(SCAN_RATE_LIMIT_BACKOFF_MS[attempt] ?? 2000);
      attempt += 1;
    }
  }
};

let instanceIdsGate = new ApiGate(INSTANCE_IDS_QUERY_CONCURRENCY, minGapMsFor(SCAN_API_MAX_RPS));
let instanceDetailGate = new ApiGate(INSTANCE_DETAIL_CONCURRENCY, minGapMsFor(SCAN_API_MAX_RPS));

export const resetApprovalApiPaceForTest = (input?: {
  concurrency?: number;
  maxRps?: number;
}): void => {
  const concurrency = input?.concurrency ?? INSTANCE_IDS_QUERY_CONCURRENCY;
  const gap = minGapMsFor(input?.maxRps ?? SCAN_API_MAX_RPS);
  instanceIdsGate = new ApiGate(concurrency, gap);
  instanceDetailGate = new ApiGate(input?.concurrency ?? INSTANCE_DETAIL_CONCURRENCY, gap);
};

export const paceInstanceIdsQuery = <T>(fn: () => Promise<T>): Promise<T> =>
  withRateLimitRetry(() => instanceIdsGate.run(fn));

export const paceInstanceDetail = <T>(fn: () => Promise<T>): Promise<T> =>
  withRateLimitRetry(() => instanceDetailGate.run(fn));
