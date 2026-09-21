import { describe, expect, it } from 'vitest';

import {
  formatDateTime,
  pickLabelValuePairs,
  pickRowArray,
  toResultRowList,
  toWriteFacts,
} from './rows';

describe('formatDateTime', () => {
  it('shortens ISO timestamps', () => {
    expect(formatDateTime('2026-09-21T09:30:00+08:00')).toBe('2026-09-21 09:30');
  });

  it('keeps other strings', () => {
    expect(formatDateTime('明天 09:00')).toBe('明天 09:00');
    expect(formatDateTime(undefined)).toBeUndefined();
  });
});

describe('pickRowArray', () => {
  it('reads the first known row key', () => {
    expect(pickRowArray({ items: [{ title: 'a' }] })).toEqual([{ title: 'a' }]);
    expect(pickRowArray({ templates: [{ name: 'b' }] })).toEqual([{ name: 'b' }]);
  });

  it('reads nested directory hits', () => {
    expect(pickRowArray({ hits: { users: [{ name: '张三' }] } })).toEqual([{ name: '张三' }]);
  });

  it('accepts a bare array', () => {
    expect(pickRowArray([{ name: 'a' }, 'skip'])).toEqual([{ name: 'a' }]);
  });

  it('returns nothing for unknown shapes', () => {
    expect(pickRowArray({ foo: 1 })).toEqual([]);
    expect(pickRowArray(undefined)).toEqual([]);
  });
});

describe('toResultRowList', () => {
  it('builds dense rows with title and meta', () => {
    const list = toResultRowList({
      items: [
        {
          createdAt: '2026-09-20T10:00:00+08:00',
          originatorName: '李四',
          processInstanceId: 'inst-1',
          processName: '费用报销',
          title: '差旅报销 1,200 元',
        },
      ],
    });

    expect(list.rows).toEqual([
      {
        key: 'inst-1',
        meta: '费用报销 · 李四 · 2026-09-20 10:00',
        tag: undefined,
        title: '差旅报销 1,200 元',
      },
    ]);
    expect(list.total).toBe(1);
    expect(list.truncated).toBe(false);
  });

  it('never repeats the title inside the meta', () => {
    const [row] = toResultRowList({ items: [{ processName: '费用报销' }] }).rows;

    expect(row.title).toBe('费用报销');
    expect(row.meta).toBeUndefined();
  });

  it('tags enabled / disabled rules', () => {
    const list = toResultRowList({
      rules: [
        { enabled: true, id: 'r1', name: '小额报销自动同意' },
        { enabled: false, id: 'r2', name: '请假自动同意' },
      ],
    });

    expect(list.rows.map((row) => row.tag)).toEqual(['enabled', 'disabled']);
  });

  it('keeps the declared total and truncation flag', () => {
    const list = toResultRowList({ items: [{ name: 'a' }], total: 42, truncated: true });

    expect(list.total).toBe(42);
    expect(list.truncated).toBe(true);
  });

  it('drops rows without a human title', () => {
    expect(toResultRowList({ items: [{ processInstanceId: 'x' }] }).rows).toEqual([]);
  });
});

describe('pickLabelValuePairs', () => {
  it('reads the first non-empty pair list', () => {
    expect(
      pickLabelValuePairs({
        summary: [{ label: '金额', value: '1200' }],
      }),
    ).toEqual([{ label: '金额', value: '1200' }]);
  });

  it('joins array values and drops incomplete pairs', () => {
    expect(
      pickLabelValuePairs({
        lines: [{ label: '抄送', value: ['张三', '李四'] }, { label: '备注' }, { value: '无标签' }],
      }),
    ).toEqual([{ label: '抄送', value: '张三、李四' }]);
  });

  it('returns nothing for unknown shapes', () => {
    expect(pickLabelValuePairs({ fields: [{ componentId: 'x' }] })).toEqual([]);
    expect(pickLabelValuePairs(undefined)).toEqual([]);
  });
});

describe('toWriteFacts', () => {
  it('reads facts from a nested entity', () => {
    expect(toWriteFacts({ instance: { processName: '费用报销', title: '差旅报销' } })).toEqual({
      meta: '费用报销',
      title: '差旅报销',
    });
  });

  it('falls back to the state itself', () => {
    expect(toWriteFacts({ name: '小额报销自动同意' })).toEqual({
      meta: undefined,
      title: '小额报销自动同意',
    });
  });

  it('returns nothing for empty state', () => {
    expect(toWriteFacts(undefined)).toEqual({});
  });
});
