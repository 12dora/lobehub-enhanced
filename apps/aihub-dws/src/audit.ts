import { createHash } from 'node:crypto';

export type AuditEvent = 'exec' | 'login' | 'logout' | 'status';

export interface AuditInput {
  actor?: string;
  durationMs?: number;
  errorCode?: string;
  event: AuditEvent;
  exitCode?: number | null;
  op?: string;
  profile?: string;
  stdoutBytes?: number;
}

function clean(value: string | undefined): string {
  if (!value) return '';
  // eslint-disable-next-line no-control-regex -- reject/strip control characters in untrusted input
  return value.replaceAll(/[\u0000-\u001F\u007F]/g, '').slice(0, 128);
}

export function profileHash(profile: string): string {
  return createHash('sha256').update(profile, 'utf8').digest('hex').slice(0, 12);
}

/** One JSON line. Callers must not pass argv, message bodies, or login stderr. */
export function writeAudit(input: AuditInput): void {
  const profile = input.profile ?? '';
  const line = {
    actor: clean(input.actor),
    durationMs: Math.max(0, Math.round(input.durationMs ?? 0)),
    errorCode: clean(input.errorCode),
    event: input.event,
    exitCode: input.exitCode ?? null,
    op: clean(input.op),
    profileHash: profile ? profileHash(profile) : '',
    stdoutBytes: Math.max(0, Math.round(input.stdoutBytes ?? 0)),
    ts: new Date().toISOString(),
  };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}
