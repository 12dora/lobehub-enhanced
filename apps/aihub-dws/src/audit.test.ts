import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { profileHash, writeAudit } from './audit.ts';

describe('audit', () => {
  const original = process.stdout.write;
  const lines: string[] = [];

  afterEach(() => {
    process.stdout.write = original;
    lines.length = 0;
  });

  it('writes one json line and hashes the profile', () => {
    process.stdout.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    writeAudit({
      actor: 'user-1',
      durationMs: 12,
      errorCode: '',
      event: 'exec',
      exitCode: 0,
      op: 'todo.list',
      profile: 'dingcorp:0123',
      stdoutBytes: 40,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(parsed.event).toBe('exec');
    expect(parsed.op).toBe('todo.list');
    expect(parsed.profileHash).toBe(
      createHash('sha256').update('dingcorp:0123', 'utf8').digest('hex').slice(0, 12),
    );
    expect(parsed.profileHash).toBe(profileHash('dingcorp:0123'));
    expect(lines[0]).not.toContain('dingcorp:0123');
    expect(parsed).not.toHaveProperty('argv');
  });
});
