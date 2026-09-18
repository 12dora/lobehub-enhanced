import { pinyinFull } from '@/database/utils/pinyin';

export interface NearMatchUser {
  deptPath: string;
  leafDeptName: string;
  name: string;
  staffId: string;
}

export interface NearMatchCandidate extends NearMatchUser {}

export type RecipientNearMatchNarrowReason = 'user_text' | 'co_recipient_dept';

export interface NarrowableNearMatchCandidate {
  leafDeptName: string;
  name: string;
}

const NEAR_MATCH_LIMIT = 5;
const CJK_NEAR_MIN = 2;
const CJK_NEAR_MAX = 4;
/** Same ideograph ranges as `@lobechat/utils` `containsChinese`. */
const CJK_CHAR = /[\u3400-\u4DBF\u4E00-\u9FA5\uF900-\uFAFF]/;

const charsOf = (value: string): string[] => [...value];

const isCjkChar = (value: string | undefined): value is string =>
  Boolean(value && CJK_CHAR.test(value));

const sliceEquals = (haystack: string[], start: number, needle: string[]): boolean => {
  if (start < 0 || start + needle.length > haystack.length) return false;
  return needle.every((ch, index) => haystack[start + index] === ch);
};

const findCharOccurrences = (haystack: string[], needle: string[]): number[] => {
  if (needle.length === 0 || needle.length > haystack.length) return [];
  const positions: number[] = [];
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    if (sliceEquals(haystack, i, needle)) positions.push(i);
  }
  return positions;
};

const isCharPrefix = (shortChars: string[], longChars: string[]): boolean =>
  longChars.length > shortChars.length && shortChars.every((ch, index) => longChars[index] === ch);

const isCharSuffix = (shortChars: string[], longChars: string[]): boolean =>
  longChars.length > shortChars.length &&
  shortChars.every((ch, index) => longChars[longChars.length - shortChars.length + index] === ch);

/**
 * One-CJK-char left/right extensions of `names` in `text` (prev+name, name+next).
 * Used for a bounded directory lookup before user-text narrowing.
 */
export const collectCjkNameExtensions = (text: string, names: Iterable<string>): string[] => {
  const chars = charsOf(text);
  const seen = new Set<string>();
  for (const name of names) {
    const trimmed = name.trim();
    const nameChars = charsOf(trimmed);
    if (nameChars.length === 0) continue;
    for (const pos of findCharOccurrences(chars, nameChars)) {
      const prev = pos > 0 ? chars[pos - 1] : undefined;
      const next =
        pos + nameChars.length < chars.length ? chars[pos + nameChars.length] : undefined;
      if (isCjkChar(prev)) seen.add(`${prev}${trimmed}`);
      if (isCjkChar(next)) seen.add(`${trimmed}${next}`);
    }
  }
  return [...seen];
};

const coveredByLongerCandidate = (
  chars: string[],
  pos: number,
  nameChars: string[],
  longerNames: string[],
): boolean => {
  for (const longer of longerNames) {
    const longerChars = charsOf(longer);
    if (isCharPrefix(nameChars, longerChars) && sliceEquals(chars, pos, longerChars)) {
      return true;
    }
    if (isCharSuffix(nameChars, longerChars)) {
      const start = pos - (longerChars.length - nameChars.length);
      if (sliceEquals(chars, start, longerChars)) return true;
    }
  }
  return false;
};

const overlapsQuery = (
  pos: number,
  nameLen: number,
  queryPositions: number[],
  queryLen: number,
): boolean => {
  if (queryLen === 0) return false;
  const end = pos + nameLen;
  return queryPositions.some((queryPos) => pos < queryPos + queryLen && queryPos < end);
};

const candidateNameOccursInUserText = (
  chars: string[],
  candidateName: string,
  opts: {
    directoryNames: Set<string>;
    longerCandidateNames: string[];
    queryChars: string[];
    queryPositions: number[];
  },
): boolean => {
  const nameChars = charsOf(candidateName);
  if (nameChars.length === 0) return false;

  for (const pos of findCharOccurrences(chars, nameChars)) {
    if (overlapsQuery(pos, nameChars.length, opts.queryPositions, opts.queryChars.length)) {
      continue;
    }

    const prev = pos > 0 ? chars[pos - 1] : undefined;
    const next = pos + nameChars.length < chars.length ? chars[pos + nameChars.length] : undefined;
    if (isCjkChar(prev) && opts.directoryNames.has(`${prev}${candidateName}`)) continue;
    if (isCjkChar(next) && opts.directoryNames.has(`${candidateName}${next}`)) continue;

    if (coveredByLongerCandidate(chars, pos, nameChars, opts.longerCandidateNames)) continue;

    return true;
  }
  return false;
};

export const levenshtein = (a: string, b: string): number => {
  const x = charsOf(a);
  const y = charsOf(b);
  const m = x.length;
  const n = y.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const prev = Array.from({ length: n + 1 }, (_, j) => j);
  const curr = Array.from({ length: n + 1 }, () => 0);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j]!;
  }
  return prev[n]!;
};

const deptQualifierMatches = (user: NearMatchUser, dept: string): boolean => {
  if (user.leafDeptName === dept) return true;
  return user.deptPath
    .split(/\s*\/\s*/)
    .filter(Boolean)
    .includes(dept);
};

const isNearMatch = (queryName: string, candidateName: string): boolean => {
  if (!queryName || !candidateName) return false;
  const qLen = charsOf(queryName).length;
  if (qLen < CJK_NEAR_MIN || qLen > CJK_NEAR_MAX) return false;
  return levenshtein(queryName, candidateName) <= 1;
};

/**
 * Rank near-directory hits for an unknown name query. Levenshtein ≤ 1 is
 * required. Optional 部门 qualifier ranks first when provided; exact pinyin
 * is a tie-break boost.
 */
export const pickRecipientNearMatches = (
  queryName: string,
  users: NearMatchUser[],
  opts?: { dept?: string; limit?: number },
): NearMatchCandidate[] => {
  const trimmed = queryName.trim();
  if (!trimmed) return [];
  const limit = opts?.limit ?? NEAR_MATCH_LIMIT;
  const dept = opts?.dept?.trim();
  const queryPinyin = pinyinFull(trimmed);

  const scored = users
    .filter((user) => user.name && isNearMatch(trimmed, user.name))
    .map((user) => {
      const dist = levenshtein(trimmed, user.name);
      const samePinyin = Boolean(queryPinyin && queryPinyin === pinyinFull(user.name));
      const deptMatch = dept ? deptQualifierMatches(user, dept) : false;
      return { deptMatch, dist, samePinyin, user };
    });

  scored.sort((a, b) => {
    if (dept && a.deptMatch !== b.deptMatch) return a.deptMatch ? -1 : 1;
    if (a.dist !== b.dist) return a.dist - b.dist;
    if (a.samePinyin !== b.samePinyin) return a.samePinyin ? -1 : 1;
    const byName = a.user.name.localeCompare(b.user.name, 'zh');
    if (byName !== 0) return byName;
    return a.user.staffId.localeCompare(b.user.staffId);
  });

  const seen = new Set<string>();
  const picked: NearMatchCandidate[] = [];
  for (const row of scored) {
    if (seen.has(row.user.staffId)) continue;
    seen.add(row.user.staffId);
    picked.push({
      deptPath: row.user.deptPath,
      leafDeptName: row.user.leafDeptName,
      name: row.user.name,
      staffId: row.user.staffId,
    });
    if (picked.length >= limit) break;
  }
  return picked;
};

const SELF_QUERIES = new Set(['我', '自己', 'me', 'myself']);

export const isSelfRecipientQuery = (query: string): boolean =>
  SELF_QUERIES.has(query.trim().toLowerCase());

/**
 * Drop near-match candidates using conversation / co-recipient context so a
 * single survivor can be retried as `staff:`. Never creates the reminder.
 *
 * (a) User-text: exactly one candidate name has a valid occurrence in
 *     `contextText` (not overlapping the unknown query, not a 1-CJK-char
 *     extension of another directory person, not a prefix/suffix of a longer
 *     candidate at the same position).
 * (b) Else co-recipient leaf-dept affinity: exactly one candidate shares a
 *     leaf department with a successfully resolved recipient in the same call.
 * Otherwise keep the full list.
 */
export const narrowRecipientNearMatches = <T extends NarrowableNearMatchCandidate>(
  candidates: T[],
  opts?: {
    contextText?: string;
    coRecipientLeafDepts?: Iterable<string>;
    directoryNames?: Iterable<string>;
    query?: string;
  },
): { candidates: T[]; reason?: RecipientNearMatchNarrowReason } => {
  if (candidates.length <= 1) return { candidates };

  const contextText = opts?.contextText?.trim();
  if (contextText) {
    const chars = charsOf(contextText);
    const queryChars = charsOf(opts?.query?.trim() ?? '');
    const queryPositions = findCharOccurrences(chars, queryChars);
    const directoryNames = new Set<string>();
    for (const name of opts?.directoryNames ?? []) {
      const trimmed = name.trim();
      if (trimmed) directoryNames.add(trimmed);
    }
    for (const candidate of candidates) {
      if (candidate.name) directoryNames.add(candidate.name);
    }

    const hits = candidates.filter((candidate) => {
      if (!candidate.name) return false;
      const longerCandidateNames = candidates
        .map((row) => row.name)
        .filter((name) => name && name !== candidate.name);
      return candidateNameOccursInUserText(chars, candidate.name, {
        directoryNames,
        longerCandidateNames,
        queryChars,
        queryPositions,
      });
    });
    if (hits.length === 1) {
      return { candidates: hits, reason: 'user_text' };
    }
  }

  const leafDepts = new Set<string>();
  for (const dept of opts?.coRecipientLeafDepts ?? []) {
    const trimmed = dept.trim();
    if (trimmed) leafDepts.add(trimmed);
  }
  if (leafDepts.size > 0) {
    const hits = candidates.filter((candidate) => leafDepts.has(candidate.leafDeptName));
    if (hits.length === 1) {
      return { candidates: hits, reason: 'co_recipient_dept' };
    }
  }

  return { candidates };
};
