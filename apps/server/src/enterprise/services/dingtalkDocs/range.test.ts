// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  assertSheetRange,
  clipA1Range,
  columnName,
  parseA1,
  sheetClipNote,
  unreadBlocks,
} from './range';

describe('sheet A1 ranges', () => {
  it('clips a used range of 41 columns to 30 and keeps 14 rows', () => {
    const clipped = clipA1Range('A1:AO14');
    expect(clipped).toEqual({ clipped: true, range: 'A1:AD14' });
    expect(columnName(30)).toBe('AD');
    expect(columnName(41)).toBe('AO');
  });

  it('clips rows past 200 and leaves a 200 by 26 range unchanged', () => {
    expect(clipA1Range('A1:A201')).toEqual({ clipped: true, range: 'A1:A200' });
    expect(clipA1Range('A1:Z200')).toEqual({ clipped: false, range: 'A1:Z200' });
  });

  it('clips from the start cell, not from column A, when the range is offset', () => {
    expect(clipA1Range('B5:AO20')).toEqual({ clipped: true, range: 'B5:AE20' });
  });

  it('accepts any A1 span and names the next block after a clip', () => {
    expect(parseA1('B2:A1')).toBeUndefined();
    expect(() => assertSheetRange('B2:A1')).toThrow(/A1/);
    expect(assertSheetRange('a1:b2')).toBe('A1:B2');
    expect(assertSheetRange('A1:AO14')).toBe('A1:AO14');
    expect(assertSheetRange('AE1')).toBe('AE1');
    expect(unreadBlocks('A1:AO14')).toEqual({ ranges: ['AE1:AO14'], rest: 0 });
    expect(
      sheetClipNote({ clipped: true, original: 'A1:AO14', range: 'A1:AD14', source: 'used' }),
    ).toContain('继续读取请用 range=AE1:AO14');
  });

  it('names at most the next three unread blocks', () => {
    expect(unreadBlocks('A1:A401')).toEqual({
      ranges: ['A201:A400', 'A401'],
      rest: 0,
    });
    expect(unreadBlocks('A1:A601')).toEqual({
      ranges: ['A201:A400', 'A401:A600', 'A601'],
      rest: 0,
    });
    expect(unreadBlocks('A1:A801')).toEqual({
      ranges: ['A201:A400', 'A401:A600', 'A601:A800'],
      rest: 1,
    });
    expect(
      sheetClipNote({ clipped: true, original: 'A1:A801', range: 'A1:A200', source: 'given' }),
    ).toBe(
      '指定的 range A1:A801 超出一次最多 200 行 × 30 列，已改为读取 A1:A200。继续读取请用 range=A201:A400，或 range=A401:A600，或 range=A601:A800，等 1 块。\n',
    );
    expect(
      sheetClipNote({ clipped: true, original: 'A1:A601', range: 'A1:A200', source: 'given' }),
    ).not.toContain('等');

    const huge = unreadBlocks('A1:ZZZ99999');
    expect(huge.ranges).toEqual(['AE1:BH200', 'BI1:CL200', 'CM1:DP200']);
    expect(huge.rest).toBe(304_996);
    const note = sheetClipNote({
      clipped: true,
      original: 'A1:ZZZ99999',
      range: 'A1:AD200',
      source: 'used',
    });
    expect(note).toContain('等 304996 块');
    expect(note.split('range=').length - 1).toBe(3);
    expect(note.length).toBeLessThan(400);
  });

  it('accepts a cursor-like id that contains a scientific-notation position', () => {
    expect(/^[\w+/=.:-]{1,256}$/.test('pos:-1.2713976E7')).toBe(true);
  });
});
