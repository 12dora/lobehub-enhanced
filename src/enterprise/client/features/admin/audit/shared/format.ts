import type { TFunction } from 'i18next';

import { formatAdminDateTime } from '@/enterprise/client/features/admin/users/utils';

import { formatAuditReason } from './auditReasonCodes';

export { formatAdminDateTime };
export { displayUserLabel as displayAuditUserLabel } from '../../primitives/userLabel';

/**
 * Readable fallback for an audit action/target-type token that has no explicit
 * translation yet (new server enum values). Drops the leading scope segment,
 * splits dotted / camelCase / snake_case, and sentence-cases the result.
 * e.g. `admin.aiProviders.publish` → "Ai providers publish".
 */
export const humanizeAuditToken = (value: string): string => {
  const withoutScope = value.replace(/^(admin|platform|managedResource)\./, '');
  const words = withoutScope
    .replaceAll(/[._]+/g, ' ')
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value;
};

/** Localized label for an audit `action` value with a humanized fallback. */
export const auditActionLabel = (t: TFunction<'admin'>, value: string): string =>
  value
    ? t(`audit.logs.action.${value}` as never, { defaultValue: humanizeAuditToken(value) })
    : '—';

/**
 * Localized label for a persisted audit `reason`. Machine reason codes written by confirm-only
 * admin actions become copy; free-form reasons an administrator typed pass through verbatim.
 */
export const auditReasonLabel = (
  t: TFunction<'admin'>,
  value: string | null | undefined,
): string | null =>
  formatAuditReason(value, (key, options) => String(t(key as never, options as never)));

/** Localized label for an audit `targetType` value with a humanized fallback. */
export const auditTargetTypeLabel = (t: TFunction<'admin'>, value: string): string =>
  value
    ? t(`audit.logs.targetType.${value}` as never, { defaultValue: humanizeAuditToken(value) })
    : '—';

/** Target ids that name a singleton scope rather than a row; rendered as localized copy. */
const GLOBAL_TARGET_IDS = new Set(['global', '__global__']);

export interface AuditTargetDisplayInput {
  targetId?: string | null;
  /** Server-resolved human name (topic title, user name, agent title…); null for sentinels. */
  targetLabel?: string | null;
  targetType?: string | null;
}

export interface AuditTargetDisplay {
  /** Resolved name: server label → localized sentinel → raw id. */
  displayName: string | null;
  /** Raw target id, kept for the hover tooltip / copy. */
  rawId: string | null;
  /** One-line cell text: `type · name`. */
  text: string;
  /** Tooltip text: the full one-liner plus the raw id on its own line when it differs. */
  tooltip: string;
  typeLabel: string | null;
}

/**
 * Human-readable target for an audit event: `typeLabel · displayName`, where the name is the
 * server-resolved `targetLabel`, a localized sentinel (`global` → "Global") or the raw id.
 */
export const auditTargetDisplay = (
  t: TFunction<'admin'>,
  row: AuditTargetDisplayInput,
): AuditTargetDisplay => {
  const typeLabel = row.targetType ? auditTargetTypeLabel(t, row.targetType) : null;
  const rawId = row.targetId?.trim() || null;
  const label = row.targetLabel?.trim() || null;
  const sentinel =
    rawId && GLOBAL_TARGET_IDS.has(rawId)
      ? t('audit.logs.targetId.global' as never, { defaultValue: 'Global' })
      : null;
  const displayName = label ?? sentinel ?? rawId;
  const text = [typeLabel, displayName].filter(Boolean).join(' · ') || '—';
  const tooltip = rawId && rawId !== displayName ? `${text}\n${rawId}` : text;
  return { displayName, rawId, text, tooltip, typeLabel };
};

export const truncateText = (value: string | null | undefined, max = 80): string => {
  if (!value) return '—';
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
};

export const hasPermission = (granted: readonly string[], required: string): boolean =>
  granted.includes(required);
