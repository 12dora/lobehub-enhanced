import { pinyinFull } from '@/database/utils/pinyin';

export interface NearMatchUser {
  deptPath: string;
  leafDeptName: string;
  name: string;
  staffId: string;
}

export interface NearMatchCandidate extends NearMatchUser {}

const NEAR_MATCH_LIMIT = 5;
const CJK_NEAR_MIN = 2;
const CJK_NEAR_MAX = 4;

const charsOf = (value: string): string[] => [...value];

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
