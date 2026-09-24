import { mkdir, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { RETENTION_MAX_AGE_MS } from './constants.ts';
import { startRetention, sweepRetention } from './retention.ts';

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('retention', () => {
  it('deletes files older than 14 days under audit and logs only', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(path.join(os.tmpdir(), 'dws-ret-')),
    );
    roots.push(root);
    const old = new Date(Date.now() - RETENTION_MAX_AGE_MS - 60_000);
    const fresh = new Date();
    await mkdir(path.join(root, 'audit', 'nested'), { recursive: true });
    await mkdir(path.join(root, 'logs'), { recursive: true });
    await mkdir(path.join(root, 'other'), { recursive: true });
    const oldAudit = path.join(root, 'audit', 'audit-old.jsonl');
    const newAudit = path.join(root, 'audit', 'audit-new.jsonl');
    const nested = path.join(root, 'audit', 'nested', 'old.jsonl');
    const oldLog = path.join(root, 'logs', 'dws.log');
    const freshLog = path.join(root, 'logs', 'fresh.log');
    const other = path.join(root, 'other', 'old.txt');
    for (const file of [oldAudit, newAudit, nested, oldLog, freshLog, other])
      await writeFile(file, 'x');
    for (const file of [oldAudit, nested, oldLog, other]) await utimes(file, old, old);
    await utimes(newAudit, fresh, fresh);
    await utimes(freshLog, fresh, fresh);

    const removed = await sweepRetention(root);
    expect(removed).toBe(3);
    await expect(stat(oldAudit)).rejects.toThrow();
    await expect(stat(nested)).rejects.toThrow();
    await expect(stat(oldLog)).rejects.toThrow();
    expect((await stat(newAudit)).isFile()).toBe(true);
    expect((await stat(freshLog)).isFile()).toBe(true);
    expect((await stat(other)).isFile()).toBe(true);
  });

  it('starts and stops the sweeper', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const root = await mkdtemp(path.join(os.tmpdir(), 'dws-ret-'));
    roots.push(root);
    const stop = startRetention(root, 60_000);
    stop();
  });
});
