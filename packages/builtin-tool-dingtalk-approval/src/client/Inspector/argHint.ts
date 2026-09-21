import { maskIdentifiers } from '../components/displayText';

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

/**
 * One short, human-readable hint about the call, or undefined when there is none.
 * A field that only carries an identifier yields no hint at all: 「钉钉审批 ·
 * 删除模板」 on its own is honest, 「… · PROC-8432…」 is noise.
 */
export const argHint = (args?: Record<string, unknown>): string | undefined => {
  if (!args) return undefined;

  for (const field of HINT_FIELDS) {
    // No `person` noun here: 「同事」 as a whole hint tells the reader nothing.
    const value = maskIdentifiers(args[field]);
    if (!value) continue;

    return value.length > MAX_HINT_LENGTH ? `${value.slice(0, MAX_HINT_LENGTH)}…` : value;
  }

  return undefined;
};
