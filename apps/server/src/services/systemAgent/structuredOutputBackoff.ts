const BACKOFF_MS = 10 * 60 * 1000;

const backedOffUntil = new Map<string, number>();

const taskKey = (provider: string, model: string, task: string) => `${provider}\0${model}\0${task}`;

const readStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { status?: unknown; statusCode?: unknown };
  if (typeof record.status === 'number') return record.status;
  if (typeof record.statusCode === 'number') return record.statusCode;
  return undefined;
};

/** True when the provider rejected the request itself (HTTP 400), not a transport failure. */
export const isUpstreamHttp400 = (error: unknown): boolean => {
  if (readStatus(error) === 400) return true;
  if (!(error instanceof Error)) return false;
  return /^\[[^\]]+\] 400:/.test(error.message) || /^400[\s:]/.test(error.message);
};

export const isStructuredOutputBackedOff = (
  provider: string,
  model: string,
  task: string,
  now = Date.now(),
): boolean => {
  const key = taskKey(provider, model, task);
  const until = backedOffUntil.get(key);
  if (until === undefined) return false;
  if (until <= now) {
    backedOffUntil.delete(key);
    return false;
  }
  return true;
};

/**
 * After a 400, skip this (provider, model, task) for 10 minutes.
 * Returns true when the failure was recorded.
 */
export const noteStructuredOutputHttp400 = (
  provider: string,
  model: string,
  task: string,
  error: unknown,
  now = Date.now(),
): boolean => {
  if (!isUpstreamHttp400(error)) return false;
  backedOffUntil.set(taskKey(provider, model, task), now + BACKOFF_MS);
  return true;
};

export const clearStructuredOutputBackoff = (): void => {
  backedOffUntil.clear();
};
