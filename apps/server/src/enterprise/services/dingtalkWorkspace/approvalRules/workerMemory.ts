import { createHash } from 'node:crypto';

/** In-memory TTL for owner tasks that need no further work this cycle. */
export const APPROVAL_RULE_EVALUATED_TTL_MS = 24 * 60 * 60 * 1000;
/** Safety-net rescan when pending count does not exceed remembered task ids. */
export const APPROVAL_RULE_REVERIFY_MS = 60 * 60 * 1000;

export interface ApprovalRuleFingerprintSource {
  conditions: unknown;
  enabled: boolean;
  id: string;
  updatedAt?: Date | string | null;
}

interface OwnerTaskMemory {
  fingerprint: string;
  lastReverifyAtMs: number;
  tasks: Map<string, number>;
}

const ownerMemory = new Map<string, OwnerTaskMemory>();

const stampUpdatedAt = (value: Date | string | null | undefined): string => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return String(value.getTime());
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return String(parsed);
    return value;
  }
  return '';
};

const stableSerialize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(',')}}`;
};

const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');

export const fingerprintEnabledApprovalRules = (rules: ApprovalRuleFingerprintSource[]): string => {
  const parts = rules
    .filter((rule) => rule.enabled)
    .map((rule) => {
      const conditionsHash = sha256Hex(stableSerialize(rule.conditions));
      return `${rule.id}:${stampUpdatedAt(rule.updatedAt)}:${conditionsHash}`;
    })
    .sort();
  return sha256Hex(parts.join('\n'));
};

export const invalidateApprovalRuleWorkerMemory = (staffId?: string): void => {
  if (staffId) {
    ownerMemory.delete(staffId);
    return;
  }
  ownerMemory.clear();
};

export const resetApprovalRuleWorkerMemoryForTest = (): void => {
  invalidateApprovalRuleWorkerMemory();
};

const pruneTasks = (tasks: Map<string, number>, nowMs: number): void => {
  for (const [taskId, expiresAt] of tasks) {
    if (expiresAt <= nowMs) tasks.delete(taskId);
  }
};

const bucketFor = (staffId: string, fingerprint: string): OwnerTaskMemory => {
  const existing = ownerMemory.get(staffId);
  if (existing && existing.fingerprint === fingerprint) return existing;
  const created: OwnerTaskMemory = {
    fingerprint,
    lastReverifyAtMs: 0,
    tasks: new Map(),
  };
  ownerMemory.set(staffId, created);
  return created;
};

export const syncOwnerTaskMemory = (
  staffId: string,
  fingerprint: string,
  nowMs: number,
): { lastReverifyAtMs: number; rememberedCount: number } => {
  const existing = ownerMemory.get(staffId);
  if (!existing || existing.fingerprint !== fingerprint) {
    ownerMemory.set(staffId, { fingerprint, lastReverifyAtMs: 0, tasks: new Map() });
    return { lastReverifyAtMs: 0, rememberedCount: 0 };
  }
  pruneTasks(existing.tasks, nowMs);
  return { lastReverifyAtMs: existing.lastReverifyAtMs, rememberedCount: existing.tasks.size };
};

export const markOwnerScanStarted = (staffId: string, fingerprint: string, nowMs: number): void => {
  bucketFor(staffId, fingerprint).lastReverifyAtMs = nowMs;
};

export const rememberOwnerTask = (
  staffId: string,
  taskId: string,
  expiresAtMs: number,
  fingerprint: string,
): void => {
  bucketFor(staffId, fingerprint).tasks.set(taskId, expiresAtMs);
};

export const ownerTaskIsRemembered = (
  staffId: string,
  taskId: string,
  nowMs: number,
  fingerprint: string,
): boolean => {
  const bucket = ownerMemory.get(staffId);
  if (!bucket || bucket.fingerprint !== fingerprint) return false;
  pruneTasks(bucket.tasks, nowMs);
  return bucket.tasks.has(taskId);
};
