import { describe, expect, it } from 'vitest';

import {
  pinyinFieldsFromFullName,
  pinyinFull,
  pinyinInitials,
  withUserPinyinFields,
} from './pinyin';

describe('pinyinFull', () => {
  it('converts CJK names to concatenated lowercase pinyin', () => {
    expect(pinyinFull('邵军军')).toBe('shaojunjun');
  });

  it('keeps only lowercase ascii letters for non-CJK names', () => {
    expect(pinyinFull('Alice')).toBe('alice');
    expect(pinyinFull('Alice Smith')).toBe('alicesmith');
    expect(pinyinFull('Break-glass Super Admin')).toBe('breakglasssuperadmin');
  });

  it('returns null for empty or letter-less input', () => {
    expect(pinyinFull(null)).toBeNull();
    expect(pinyinFull(undefined)).toBeNull();
    expect(pinyinFull('')).toBeNull();
    expect(pinyinFull('   ')).toBeNull();
    expect(pinyinFull('123')).toBeNull();
  });
});

describe('pinyinInitials', () => {
  it('returns first-letter initials for CJK names', () => {
    expect(pinyinInitials('邵军军')).toBe('sjj');
  });

  it('returns first letter of each word for non-CJK names', () => {
    expect(pinyinInitials('Alice')).toBe('a');
    expect(pinyinInitials('Alice Smith')).toBe('as');
    expect(pinyinInitials('Break-glass Super Admin')).toBe('bsa');
  });

  it('returns null for empty or letter-less input', () => {
    expect(pinyinInitials(null)).toBeNull();
    expect(pinyinInitials('')).toBeNull();
    expect(pinyinInitials('123')).toBeNull();
  });
});

describe('pinyinFieldsFromFullName / withUserPinyinFields', () => {
  it('pairs full and initials for a CJK name', () => {
    expect(pinyinFieldsFromFullName('邵军军')).toEqual({
      pinyinFull: 'shaojunjun',
      pinyinInitials: 'sjj',
    });
  });

  it('spreads pinyin only when fullName is present on the patch', () => {
    expect(withUserPinyinFields({ avatar: 'x' })).toEqual({ avatar: 'x' });
    expect(withUserPinyinFields({ fullName: '邵军军' })).toEqual({
      fullName: '邵军军',
      pinyinFull: 'shaojunjun',
      pinyinInitials: 'sjj',
    });
    expect(withUserPinyinFields({ fullName: null })).toEqual({
      fullName: null,
      pinyinFull: null,
      pinyinInitials: null,
    });
  });
});
