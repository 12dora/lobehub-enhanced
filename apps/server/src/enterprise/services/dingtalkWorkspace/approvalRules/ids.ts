export const DINGTALK_STAFF_ID_PREFIX = 'staff:';
export const DINGTALK_DEPT_ID_PREFIX = 'dept:';

const SELF_ORIGINATOR_ALIASES = new Set(['me', '本人', '我']);

/** Strip a leading `staff:` / `dept:` prefix (case-insensitive). */
export const stripDingtalkIdPrefix = (value: string, prefix: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  const needle = prefix.toLowerCase();
  if (lower.startsWith(needle)) return trimmed.slice(prefix.length).trim();
  return trimmed;
};

export const isSelfOriginatorAlias = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed === '我' || trimmed === '本人') return true;
  return SELF_ORIGINATOR_ALIASES.has(trimmed.toLowerCase());
};
