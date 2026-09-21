/**
 * Last line of defence against DingTalk internals reaching the user: the approval
 * toolset shipped 「删除模板「PROC-84322A73-…」」 to production. The server preview
 * resolves the real names now, so this module only has to catch a regression there.
 *
 * It is deliberately NARROW. The cards it feeds are a confirmation UI: a preview
 * line carries the user's own data — a bank account, a 统一社会信用代码, a contract
 * number, a phone list — and hiding a value somebody is about to approve is worse
 * than showing an ugly identifier. So only our own unmistakable formats are
 * matched, never "looks like a long number" or "looks like base64".
 */

export interface MaskIdentifiersOptions {
  /** Localized noun substituted for a `dept:<id>` token, e.g.「部门」. */
  department?: string;
  /** Localized noun substituted for a `staff:<id>` token, e.g.「同事」. */
  person?: string;
}

/** Audience tokens name a real person or team, so they read as a noun, not a gap. */
const STAFF_TOKEN = /staff:[\w-]+/gi;
const DEPT_TOKEN = /dept:[\w-]+/gi;

/**
 * Our own identifier formats, each anchored on a prefix no human copy starts with.
 * Nothing generic belongs in this list: user data legitimately contains long
 * digit runs and hex-looking strings.
 */
const ID_PATTERNS: readonly RegExp[] = [
  // Approval template code: PROC-84322A73-E989-4C4E-B178-C4BA2EE5ECBB. The full
  // 8-4-4-4-12 shape is required, so a human reference like `PROC-2026-001` — a
  // purchase order somebody typed into a form — is left alone.
  /\bPROC-[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}\b/gi,
  // Automation rule id: dar_7f3c19ab.
  /\bdar_[0-9A-Za-z]+/g,
  // DingTalk todo id: `task` followed by a 32-character hex digest.
  /\btask[0-9a-f]{32}\b/gi,
];

/** A link or an address is content: masking half of it hands over a broken link. */
const URL_LIKE = /[A-Za-z][\w+.-]*:\/\/|www\.|\S[^\s@]*@\S+\./;

const EMPTY_WRAPPER = /[「『“"'([【《（]\s*[」』”"')\]】》）]/g;
const EDGE_SEPARATORS = /^[\s·、,，:：;；|/\\–—-]+|[\s·、,，:：;；|/\\–—-]+$/g;
const HAS_MEANING = /[\p{L}\p{N}]/u;

const maskChunk = (chunk: string, options?: MaskIdentifiersOptions): string => {
  if (URL_LIKE.test(chunk)) return chunk;

  let result = chunk
    .replaceAll(STAFF_TOKEN, options?.person ?? '')
    .replaceAll(DEPT_TOKEN, options?.department ?? '');

  for (const pattern of ID_PATTERNS) result = result.replaceAll(pattern, '');

  return result;
};

/** Drops the brackets and separators an excised identifier leaves behind. */
const tidy = (value: string): string => {
  let result = value;

  // Nested wrappers need more than one pass:「删除模板「」」→「删除模板」.
  for (let pass = 0; pass < 3; pass += 1) {
    const next = result.replaceAll(EMPTY_WRAPPER, '');
    if (next === result) break;
    result = next;
  }

  return result
    .replaceAll(/\s{2,}/g, ' ')
    .replaceAll(EDGE_SEPARATORS, '')
    .trim();
};

/**
 * The display form of `value`, or `undefined` when nothing readable is left —
 * callers then show a neutral noun instead. Never returns a truncated identifier:
 * an identifier is removed whole.
 */
export const maskIdentifiers = (
  value: unknown,
  options?: MaskIdentifiersOptions,
): string | undefined => {
  if (typeof value !== 'string') return undefined;

  const source = value.trim();
  if (!source) return undefined;

  const masked = tidy(source.replaceAll(/\S+/g, (chunk) => maskChunk(chunk, options)));

  return masked && HAS_MEANING.test(masked) ? masked : undefined;
};
