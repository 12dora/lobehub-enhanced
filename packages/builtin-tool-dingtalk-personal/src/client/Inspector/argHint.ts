/**
 * Argument fields that are safe and useful as a one-line inspector hint,
 * ordered by how well they describe the call. Ids (taskId, conversationId,
 * resourceId, reportId, staff ids) are deliberately excluded — they mean
 * nothing to the user.
 */
const HINT_FIELDS = ['query', 'title', 'fileName', 'templateName', 'name'] as const;

const MAX_HINT_LENGTH = 40;

/** One short, human-readable hint about the call, or undefined when there is none. */
export const argHint = (args?: Record<string, unknown>): string | undefined => {
  if (!args || typeof args !== 'object') return undefined;

  for (const field of HINT_FIELDS) {
    const raw = args[field];
    if (typeof raw !== 'string') continue;

    const value = raw.trim().replaceAll(/\s+/g, ' ');
    if (!value) continue;

    return value.length > MAX_HINT_LENGTH ? `${value.slice(0, MAX_HINT_LENGTH)}…` : value;
  }

  return undefined;
};
