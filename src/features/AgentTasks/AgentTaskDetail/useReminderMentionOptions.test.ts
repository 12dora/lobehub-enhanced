/**
 * @vitest-environment happy-dom
 */
import { parseReminderMentions } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReminderMentionOptions } from './useReminderMentionOptions';

const mocks = vi.hoisted(() => ({
  /** Everything the picker writes into the document, in insertion order. */
  inserted: [] as string[],
  searchDirectory: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      key === 'taskReminder.mention.user' ? `${params?.name} · ${params?.dept}` : key,
  }),
}));

vi.mock('@/services/reminder', () => ({
  reminderService: { searchDirectory: mocks.searchDirectory },
}));

// A minimal Lexical stand-in: `$insertNodes` appends the node's text to the
// document buffer, which is exactly what the real editor serialises to markdown
// for plain text nodes.
vi.mock('lexical', () => ({
  $createTextNode: (text: string) => ({ selectEnd: vi.fn(), text }),
  $insertNodes: (nodes: { text: string }[]) => {
    for (const node of nodes) mocks.inserted.push(node.text);
  },
}));

/** Stands in for `IEditor`; the slash plugin hands `onSelect` this object. */
const editor = {
  getLexicalEditor: () => ({ update: (fn: () => void) => fn() }),
} as never;

const directory = {
  departments: [{ deptId: 'd1', memberCount: 12, name: '安环部', pathNames: '公司/安环部' }],
  users: [
    { deptPath: '公司/外贸组', leafDeptName: '外贸组', name: '胡玉琴A', staffId: 's1' },
    { deptPath: '公司/业务部', leafDeptName: '业务部', name: '邵军军', staffId: 's2' },
  ],
};

const search = (matchingString: string) => ({
  leadOffset: 0,
  matchingString,
  replaceableString: `@${matchingString}`,
});

describe('useReminderMentionOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inserted = [];
    mocks.searchDirectory.mockResolvedValue(directory);
  });

  it('is disabled (no `@` trigger) when the editor is not an editable reminder body', () => {
    const { result } = renderHook(() => useReminderMentionOptions(false));

    expect(result.current).toBeUndefined();
  });

  it('two picked recipients round-trip to two parsed mentions', async () => {
    const { result } = renderHook(() => useReminderMentionOptions(true));

    const items = await result.current!.items(search('胡'));
    // Users first, then departments.
    expect(items.map((item) => item.key)).toEqual(['user:s1', 'user:s2', 'dept:d1']);

    items[0].onSelect?.(editor);
    items[1].onSelect?.(editor);

    const body = mocks.inserted.join('');
    expect(body).toBe('@胡玉琴A·外贸组 @邵军军·业务部 ');
    // No U+FEFF glue: the server-side grammar sees BOTH recipients.
    expect(body).not.toContain('﻿');
    expect(parseReminderMentions(body).map((token) => token.raw)).toEqual([
      '@胡玉琴A·外贸组',
      '@邵军军·业务部',
    ]);
  });

  it('inserts a department as a bare token', async () => {
    const { result } = renderHook(() => useReminderMentionOptions(true));

    const items = await result.current!.items(search('安'));
    items[2].onSelect?.(editor);

    expect(mocks.inserted.join('')).toBe('@安环部 ');
    expect(parseReminderMentions(mocks.inserted.join(''))).toHaveLength(1);
  });

  it('caches one query and skips the empty one', async () => {
    const { result } = renderHook(() => useReminderMentionOptions(true));

    expect(await result.current!.items(search('  '))).toEqual([]);
    await result.current!.items(search('胡'));
    await result.current!.items(search('胡'));

    expect(mocks.searchDirectory).toHaveBeenCalledTimes(1);
    expect(mocks.searchDirectory).toHaveBeenCalledWith({ q: '胡' });
  });

  it('says the lookup failed instead of showing an empty menu', async () => {
    mocks.searchDirectory.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useReminderMentionOptions(true));

    const items = await result.current!.items(search('胡'));

    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('taskReminder.mention.searchFailed');
    expect(items[0].disabled).toBe(true);
    // A failure is not cached: the next keystroke retries.
    await result.current!.items(search('胡'));
    expect(mocks.searchDirectory).toHaveBeenCalledTimes(2);
  });
});
