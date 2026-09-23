import { describe, expect, it } from 'vitest';

import {
  dingtalkWorkerFlagsFromConfig,
  expectedWorkersFromEnv,
  projectWorkerHealth,
  type WorkerExpectationFlags,
} from './workerHealth';
import type { WorkerBeat } from './workerHeartbeat';

const env = (extra: Partial<NodeJS.ProcessEnv> = {}): Partial<NodeJS.ProcessEnv> => ({
  DATABASE_URL: 'postgres://localhost/aihub',
  NODE_ENV: 'production',
  ...extra,
});

const flags = (patch: Partial<WorkerExpectationFlags> = {}): WorkerExpectationFlags => ({
  directorySync: true,
  documentRender: true,
  dingtalkStream: true,
  ...patch,
});

const configured = {
  chatEnabled: true,
  clientId: 'ding-client',
  clientSecret: 'ding-secret',
  notifyApp: { agentId: '1', appKey: 'key', appSecret: 'secret' },
};

describe('dingtalkWorkerFlagsFromConfig', () => {
  it('expects stream only when chat is enabled and directory sync only with a full notify app', () => {
    expect(dingtalkWorkerFlagsFromConfig(null)).toEqual({
      directorySync: false,
      dingtalkStream: false,
    });
    expect(dingtalkWorkerFlagsFromConfig({ clientId: 'id' })).toEqual({
      directorySync: false,
      dingtalkStream: false,
    });
    expect(
      dingtalkWorkerFlagsFromConfig({ ...configured, chatEnabled: false, notifyApp: null }),
    ).toEqual({ directorySync: false, dingtalkStream: false });
    expect(
      dingtalkWorkerFlagsFromConfig({
        ...configured,
        notifyApp: { agentId: '1', appKey: 'key' },
      }),
    ).toEqual({ directorySync: false, dingtalkStream: true });
    expect(dingtalkWorkerFlagsFromConfig({ ...configured, chatEnabled: false })).toEqual({
      directorySync: true,
      dingtalkStream: false,
    });
    expect(dingtalkWorkerFlagsFromConfig(configured)).toEqual({
      directorySync: true,
      dingtalkStream: true,
    });
  });
});

describe('expectedWorkersFromEnv', () => {
  it('omits workers whose runtime or module is off', () => {
    expect(expectedWorkersFromEnv({}, flags()).map((item) => item.name)).toEqual([]);
    expect(
      expectedWorkersFromEnv(env({ AGENT_RUNTIME_MODE: 'queue', NODE_ENV: 'test' }), flags()).map(
        (item) => item.name,
      ),
    ).toEqual(['reminder', 'approval_worker', 'directory_sync']);
    expect(expectedWorkersFromEnv(env(), flags()).map((item) => item.name)).toEqual([
      'reminder',
      'approval_worker',
      'directory_sync',
      'task_scheduler',
      'task_sweep',
      'task_watchdog',
      'dingtalk_stream',
      'document_render',
    ]);
    expect(
      expectedWorkersFromEnv(
        env({ NODE_ENV: 'development' }),
        flags({ documentRender: false }),
      ).map((item) => item.name),
    ).not.toContain('dingtalk_stream');
    expect(
      expectedWorkersFromEnv(
        env({ NODE_ENV: 'development', ENABLE_BOT_IN_DEV: '1' }),
        flags({ documentRender: false }),
      ).map((item) => item.name),
    ).toContain('dingtalk_stream');
  });

  it('omits DingTalk stream and directory sync when the connector is not configured', () => {
    const names = expectedWorkersFromEnv(
      env(),
      flags({ directorySync: false, dingtalkStream: false }),
    ).map((item) => item.name);
    expect(names).not.toContain('dingtalk_stream');
    expect(names).not.toContain('directory_sync');
    expect(names).toContain('reminder');
    expect(names).toContain('approval_worker');
  });
});

describe('projectWorkerHealth', () => {
  const now = Date.parse('2026-08-01T00:00:00.000Z');
  const expected = [{ intervalMs: 60_000, name: 'reminder' as const }];

  const beat = (patch: Partial<WorkerBeat>): Map<string, WorkerBeat> =>
    new Map([
      ['reminder', { failed: false, intervalMs: 60_000, startedAt: now - 10_000, ...patch }],
    ]);

  it('is unavailable when an expected worker never started or has failed', () => {
    expect(projectWorkerHealth(expected, new Map(), now)[0]).toMatchObject({
      started: false,
      status: 'unavailable',
    });
    expect(
      projectWorkerHealth(
        expected,
        beat({ failed: true, lastError: 'boom', lastTickAt: now }),
        now,
      )[0],
    ).toMatchObject({ started: true, status: 'unavailable', lastError: 'boom' });
  });

  it('is degraded when the last tick is older than two intervals', () => {
    expect(projectWorkerHealth(expected, beat({ lastTickAt: now - 120_001 }), now)[0]?.status).toBe(
      'degraded',
    );
    expect(projectWorkerHealth(expected, beat({ lastTickAt: now - 30_000 }), now)[0]?.status).toBe(
      'healthy',
    );
  });
});
