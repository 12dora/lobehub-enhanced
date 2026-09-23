import { afterEach, describe, expect, it } from 'vitest';

import {
  markWorkerFailed,
  markWorkerStarted,
  markWorkerTick,
  readWorkerBeats,
  readWorkerHeartbeatMemory,
  resetWorkerHeartbeatForTest,
  setWorkerHeartbeatStoreForTest,
  type WorkerHeartbeatStore,
} from './workerHeartbeat';

class MemoryBeats implements WorkerHeartbeatStore {
  hashes = new Map<string, Record<string, string>>();
  members = new Set<string>();

  async expire(): Promise<void> {
    return undefined;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.hashes.get(key) ?? {};
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    const hash = this.hashes.get(key) ?? {};
    hash[field] = value;
    this.hashes.set(key, hash);
  }

  async sadd(_key: string, member: string): Promise<void> {
    this.members.add(member);
  }

  async smembers(): Promise<string[]> {
    return [...this.members];
  }
}

describe('worker heartbeat', () => {
  afterEach(() => {
    resetWorkerHeartbeatForTest();
  });

  it('tracks start, tick, and failure in memory when Redis is disabled', async () => {
    setWorkerHeartbeatStoreForTest(null);
    markWorkerStarted('reminder', 60_000);
    markWorkerFailed('reminder', new Error('token=secret sweep'));
    expect(readWorkerHeartbeatMemory().get('reminder')).toMatchObject({
      failed: true,
      lastError: 'token=[redacted] sweep',
    });
    markWorkerTick('reminder', 60_000);
    const beat = readWorkerHeartbeatMemory().get('reminder');
    expect(beat?.failed).toBe(false);
    expect(beat?.lastError).toBeUndefined();
    expect(beat?.lastTickAt).toEqual(expect.any(Number));
    await expect(readWorkerBeats()).resolves.toEqual(readWorkerHeartbeatMemory());
  });

  it('prefers a newer Redis tick and never throws when Redis fails', async () => {
    const redis = new MemoryBeats();
    setWorkerHeartbeatStoreForTest(redis);
    markWorkerTick('approval_worker', 180_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(redis.members.has('approval_worker')).toBe(true);

    const broken: WorkerHeartbeatStore = {
      expire: async () => {
        throw new Error('down');
      },
      hgetall: async () => {
        throw new Error('down');
      },
      hset: async () => {
        throw new Error('down');
      },
      sadd: async () => {
        throw new Error('down');
      },
      smembers: async () => {
        throw new Error('down');
      },
    };
    setWorkerHeartbeatStoreForTest(broken);
    expect(() => markWorkerTick('reminder', 60_000)).not.toThrow();
    await expect(readWorkerBeats()).resolves.toBeInstanceOf(Map);
  });
});
