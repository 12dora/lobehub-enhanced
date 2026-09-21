/**
 * Argument fields that are safe and useful as a one-line inspector hint.
 * Ordered by how well they describe the call. Ids, codes and `staff:<id>`
 * tokens are deliberately excluded — they mean nothing to the user.
 */
const HINT_FIELDS = [
  'q',
  'name',
  'title',
  'subject',
  'summary',
  'processName',
  'text',
  'remark',
] as const;

const MAX_HINT_LENGTH = 40;

/** One short, human-readable hint about the call, or undefined when there is none. */
export const argHint = (args?: Record<string, unknown>): string | undefined => {
  if (!args) return undefined;

  for (const field of HINT_FIELDS) {
    const value = args[field];
    if (typeof value !== 'string') continue;

    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith('staff:')) continue;

    return trimmed.length > MAX_HINT_LENGTH ? `${trimmed.slice(0, MAX_HINT_LENGTH)}…` : trimmed;
  }

  return undefined;
};
