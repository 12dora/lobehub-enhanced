import { pinyin } from 'pinyin-pro';

const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/;
const ASCII_LETTERS_RE = /[^a-z]/g;

const PINYIN_OPTIONS = {
  nonZh: 'consecutive',
  separator: '',
  surname: 'head',
  toneType: 'none',
  type: 'string',
  v: true,
} as const;

const toAsciiLetters = (value: string): string | null => {
  const letters = value.toLowerCase().replaceAll(ASCII_LETTERS_RE, '');
  return letters.length > 0 ? letters : null;
};

const latinWordInitials = (value: string): string | null => {
  const initials = value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => toAsciiLetters(word)?.at(0) ?? '')
    .join('');
  return initials.length > 0 ? initials : null;
};

/**
 * Lowercase ASCII pinyin of a display name.
 * CJK → full pinyin without tones/separators (`邵军军` → `shaojunjun`).
 * Non-CJK → lowercased ASCII letters only (`Alice Smith` → `alicesmith`).
 * Empty / no letters → `null`.
 */
export const pinyinFull = (name: string | null | undefined): string | null => {
  const trimmed = name?.trim();
  if (!trimmed) return null;

  if (!CJK_RE.test(trimmed)) {
    return toAsciiLetters(trimmed);
  }

  return toAsciiLetters(pinyin(trimmed, PINYIN_OPTIONS));
};

/**
 * Lowercase ASCII pinyin initials of a display name.
 * CJK → first letter of each character (`邵军军` → `sjj`).
 * Non-CJK → first letter of each word (`Alice Smith` → `as`).
 * Empty / no letters → `null`.
 */
export const pinyinInitials = (name: string | null | undefined): string | null => {
  const trimmed = name?.trim();
  if (!trimmed) return null;

  if (!CJK_RE.test(trimmed)) {
    return latinWordInitials(trimmed);
  }

  return toAsciiLetters(
    pinyin(trimmed, {
      ...PINYIN_OPTIONS,
      pattern: 'first',
    }),
  );
};

export interface UserPinyinFields {
  pinyinFull: string | null;
  pinyinInitials: string | null;
}

export const pinyinFieldsFromFullName = (
  fullName: string | null | undefined,
): UserPinyinFields => ({
  pinyinFull: pinyinFull(fullName),
  pinyinInitials: pinyinInitials(fullName),
});

/**
 * Spread onto a user insert/update when `fullName` is part of the write.
 * Leaves pinyin untouched when `fullName` is omitted from the patch.
 */
export const withUserPinyinFields = <T extends object>(value: T): T | (T & UserPinyinFields) => {
  if (!Object.hasOwn(value, 'fullName')) return value;
  return {
    ...value,
    ...pinyinFieldsFromFullName((value as { fullName?: string | null }).fullName),
  };
};
