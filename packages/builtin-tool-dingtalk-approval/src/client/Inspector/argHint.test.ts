import { describe, expect, it } from 'vitest';

import { argHint } from './argHint';

describe('argHint', () => {
  it('returns undefined without args', () => {
    expect(argHint()).toBeUndefined();
    expect(argHint({})).toBeUndefined();
  });

  it('prefers the search keyword', () => {
    expect(argHint({ name: '张三', q: '报销' })).toBe('报销');
  });

  it('falls back to the next human field', () => {
    expect(argHint({ processInstanceId: 'abc', remark: '预算不足' })).toBe('预算不足');
  });

  it('skips staff tokens and ids', () => {
    expect(argHint({ name: 'staff:123456', processCode: 'PROC-1' })).toBeUndefined();
  });

  it('truncates long values', () => {
    const hint = argHint({ title: 'a'.repeat(60) });

    expect(hint).toHaveLength(41);
    expect(hint?.endsWith('…')).toBe(true);
  });
});
