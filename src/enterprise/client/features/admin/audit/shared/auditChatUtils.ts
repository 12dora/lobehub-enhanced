export type AuditChatPlacement = 'left' | 'right' | 'center';

/** user → right bubble, system/tool → centered and subdued, everything else is the assistant side. */
export const auditChatPlacement = (role: string | null | undefined): AuditChatPlacement => {
  const normalized = (role || 'assistant').toLowerCase();
  if (normalized === 'user') return 'right';
  if (normalized === 'system' || normalized === 'tool') return 'center';
  return 'left';
};

/**
 * Best-effort one-line summary of a persisted message error (`{ type, message, body }` in the
 * chat runtime). Unknown shapes return `undefined` so the caller shows only the generic label.
 */
export const describeAuditMessageError = (error: unknown): string | undefined => {
  if (error == null || error === false) return undefined;
  if (typeof error === 'string') return error.trim() || undefined;
  if (typeof error !== 'object') return undefined;
  const record = error as Record<string, unknown>;
  const parts = [record.type, record.message]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .map((part) => part.trim());
  return parts.length ? [...new Set(parts)].join(': ') : undefined;
};

/** Whether the DTO carries an error worth surfacing at all. */
export const hasAuditMessageError = (error: unknown): boolean =>
  error != null && error !== false && !(typeof error === 'string' && error.trim() === '');
