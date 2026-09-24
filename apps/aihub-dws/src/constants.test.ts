import { describe, expect, it } from 'vitest';

import {
  BROKER_TOKEN_MIN,
  CHILD_TIMEOUT_MS,
  DOWNLOAD_TIMEOUT_MS,
  GLOBAL_CONCURRENCY,
  LOGIN_CANCEL_LIST_MS,
  LOGIN_CANCEL_WAIT_MS,
  LOGIN_CHILD_MS,
  LOGIN_KEEP_MS,
  LOGIN_READY_MS,
  LOGIN_START_DEADLINE_MS,
  LOGOUT_CHILD_MS,
  LOGOUT_TOTAL_MS,
  MAX_BODY_BYTES,
  MAX_FILE_BYTES,
  MAX_PENDING_LOGINS,
  PROFILE_CACHE_MS,
  QUEUE_TIMEOUT_MS,
  RETENTION_INTERVAL_MS,
  RETENTION_MAX_AGE_MS,
  STATUS_CHILD_MS,
  STATUS_QUEUE_MS,
  STDERR_CAP_BYTES,
  STDOUT_CAP_BYTES,
  VERSION_RETRY_MS,
} from './constants.ts';

describe('contract limits', () => {
  it('matches the sidecar limits', () => {
    expect(BROKER_TOKEN_MIN).toBe(32);
    expect(MAX_BODY_BYTES).toBe(64 * 1024);
    expect(STDOUT_CAP_BYTES).toBe(1024 * 1024);
    expect(STDERR_CAP_BYTES).toBe(64 * 1024);
    expect(MAX_FILE_BYTES).toBe(20 * 1024 * 1024);
    expect(GLOBAL_CONCURRENCY).toBe(4);
    expect(QUEUE_TIMEOUT_MS).toBe(10_000);
    expect(CHILD_TIMEOUT_MS).toBe(50_000);
    expect(DOWNLOAD_TIMEOUT_MS).toBe(100_000);
    expect(STATUS_QUEUE_MS).toBe(5_000);
    expect(STATUS_CHILD_MS).toBe(15_000);
    expect(LOGOUT_CHILD_MS).toBe(10_000);
    expect(LOGOUT_TOTAL_MS).toBe(35_000);
    expect(PROFILE_CACHE_MS).toBe(10_000);
    expect(LOGIN_READY_MS).toBe(20_000);
    expect(LOGIN_START_DEADLINE_MS).toBe(25_000);
    expect(LOGIN_CANCEL_WAIT_MS).toBe(5_000);
    expect(LOGIN_CANCEL_LIST_MS).toBe(4_000);
    expect(VERSION_RETRY_MS).toBe(60_000);
    expect(LOGIN_CHILD_MS).toBe(16 * 60 * 1000);
    expect(LOGIN_KEEP_MS).toBe(30 * 60 * 1000);
    expect(MAX_PENDING_LOGINS).toBe(10);
    expect(RETENTION_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
    expect(RETENTION_MAX_AGE_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });
});
