import { describe, expect, it } from 'vitest';

import { cellText, padRows, resolveNodeKind, toExtensionLabel, toTableRows } from './format';

describe('cellText', () => {
  it('keeps text and reads numbers and booleans', () => {
    expect(cellText('螺丝')).toBe('螺丝');
    expect(cellText(1200)).toBe('1200');
    expect(cellText(false)).toBe('false');
  });

  it('shows anything else as an empty cell', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
    expect(cellText({ name: '张三' })).toBe('');
    expect(cellText(Number.NaN)).toBe('');
  });
});

describe('toTableRows / padRows', () => {
  it('skips rows that are not arrays', () => {
    expect(toTableRows([['a', 1], 'oops', null, [true]])).toEqual([['a', '1'], ['true']]);
    expect(toTableRows('A1:B2')).toEqual([]);
  });

  it('pads short rows to the widest one', () => {
    expect(padRows([['a', 'b', 'c'], ['d']], 3)).toEqual([
      ['a', 'b', 'c'],
      ['d', '', ''],
    ]);
  });
});

describe('resolveNodeKind', () => {
  it('reads folders, online sheets, documents and AI tables', () => {
    expect(resolveNodeKind('folder')).toBe('folder');
    expect(resolveNodeKind('FOLDER')).toBe('folder');
    expect(resolveNodeKind('file', 'axls')).toBe('sheet');
    expect(resolveNodeKind(undefined, 'adoc')).toBe('doc');
    expect(resolveNodeKind('file', 'able')).toBe('aitable');
    expect(resolveNodeKind('ALIDOC')).toBe('online');
  });

  it('leaves plain files to their extension', () => {
    expect(resolveNodeKind('FILE')).toBeUndefined();
    expect(resolveNodeKind(undefined, 'xlsx')).toBeUndefined();
    expect(toExtensionLabel('XLSX')).toBe('xlsx');
    expect(toExtensionLabel('not an extension')).toBeUndefined();
    expect(toExtensionLabel(undefined)).toBeUndefined();
  });
});
