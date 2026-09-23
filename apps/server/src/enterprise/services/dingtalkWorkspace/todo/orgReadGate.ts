import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const log = debug('lobe-server:dingtalk-workspace:todo-gate');

/** Deployment-wide gate. One Redis key, not per user. */
export const ORG_TODO_READ_GATE_REDIS_KEY = 'dingtalk:todo:custom-todo-read';
export const ORG_TODO_READ_GATE_TTL_SECONDS = 24 * 60 * 60;
/**
 * Short claim so only one replica probes `organizations/tasks/query` while the
 * gate is unknown. Losers skip the org call for this request. Not deleted
 * early: the TTL is the single-flight window, and the 24h gate key is what
 * later requests read.
 */
export const ORG_TODO_READ_DISCOVER_CLAIM_KEY = 'dingtalk:todo:custom-todo-read:discover';
export const ORG_TODO_READ_DISCOVER_CLAIM_TTL_SECONDS = 60;
export const CUSTOM_TODO_READ_SCOPE = 'Custom.Todo.Read';

export type OrgTodoReadGate = 'available' | 'unavailable';

type MemoryGate = { expiresAt: number; value: OrgTodoReadGate };

let memoryGate: MemoryGate | undefined;
let discoverInflight: Promise<OrgTodoReadGate | undefined> | null = null;

export const resetOrgTodoReadGateForTest = (): void => {
  memoryGate = undefined;
  discoverInflight = null;
};

const rememberMemory = (value: OrgTodoReadGate): void => {
  memoryGate = {
    expiresAt: Date.now() + ORG_TODO_READ_GATE_TTL_SECONDS * 1000,
    value,
  };
};

const readMemory = (): OrgTodoReadGate | undefined => {
  if (!memoryGate) return undefined;
  if (memoryGate.expiresAt <= Date.now()) {
    memoryGate = undefined;
    return undefined;
  }
  return memoryGate.value;
};

/**
 * Cached gate only. Does not call DingTalk.
 * `undefined` means this deployment has not learned the scope yet.
 */
export const peekOrgTodoReadGate = async (): Promise<OrgTodoReadGate | undefined> => {
  const memory = readMemory();
  if (memory) return memory;
  try {
    const redis = getAgentRuntimeRedisClient();
    if (!redis) return undefined;
    const raw = await redis.get(ORG_TODO_READ_GATE_REDIS_KEY);
    if (raw !== 'available' && raw !== 'unavailable') return undefined;
    rememberMemory(raw);
    return raw;
  } catch (error) {
    log('peek org todo read gate failed: %s', error instanceof Error ? error.name : 'UnknownError');
    return undefined;
  }
};

export const rememberOrgTodoReadGate = async (value: OrgTodoReadGate): Promise<void> => {
  rememberMemory(value);
  log('custom todo read gate %s', value);
  try {
    const redis = getAgentRuntimeRedisClient();
    if (!redis) return;
    await redis.set(ORG_TODO_READ_GATE_REDIS_KEY, value, 'EX', ORG_TODO_READ_GATE_TTL_SECONDS);
  } catch (error) {
    log(
      'remember org todo read gate failed: %s',
      error instanceof Error ? error.name : 'UnknownError',
    );
  }
};

/**
 * SET NX claim for the discovery probe. `true` means this caller may probe.
 * Redis absent: in-process single-flight is the only guard (dev).
 * Redis error or a held claim: do not probe — another replica may be billing
 * the same `organizations/tasks/query`.
 */
const claimOrgTodoDiscovery = async (): Promise<boolean> => {
  try {
    const redis = getAgentRuntimeRedisClient();
    if (!redis) return true;
    const result = await redis.set(
      ORG_TODO_READ_DISCOVER_CLAIM_KEY,
      '1',
      'EX',
      ORG_TODO_READ_DISCOVER_CLAIM_TTL_SECONDS,
      'NX',
    );
    return result === 'OK';
  } catch (error) {
    log(
      'claim org todo discovery failed: %s',
      error instanceof Error ? error.name : 'UnknownError',
    );
    return false;
  }
};

/**
 * At most one discovery per deployment while the gate is unknown.
 * In-process waiters share the winner's result. Another replica that loses
 * the Redis claim gets `gate: undefined` and must not call DingTalk this time
 * — the caller serves the app-todo list only.
 * `undefined` is not remembered (transient failure — a later request may retry
 * after the claim TTL).
 */
export const discoverOrgTodoReadGate = async (
  probe: () => Promise<OrgTodoReadGate | undefined>,
): Promise<{ fromThisProbe: boolean; gate: OrgTodoReadGate | undefined }> => {
  const cached = await peekOrgTodoReadGate();
  if (cached) return { fromThisProbe: false, gate: cached };

  if (discoverInflight) {
    const gate = await discoverInflight;
    return { fromThisProbe: false, gate };
  }

  let fromThisProbe = true;
  const run = (async () => {
    const again = await peekOrgTodoReadGate();
    if (again) {
      fromThisProbe = false;
      return again;
    }
    const claimed = await claimOrgTodoDiscovery();
    if (!claimed) {
      fromThisProbe = false;
      return undefined;
    }
    const value = await probe();
    if (value) await rememberOrgTodoReadGate(value);
    return value;
  })().finally(() => {
    discoverInflight = null;
  });
  discoverInflight = run;

  const gate = await run;
  return { fromThisProbe, gate };
};
