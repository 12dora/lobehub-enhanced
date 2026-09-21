import { describe, expect, it } from 'vitest';

import { argHint } from './argHint';

describe('argHint', () => {
  it('returns undefined without args', () => {
    expect(argHint()).toBeUndefined();
    expect(argHint({})).toBeUndefined();
  });

  it('prefers the search keyword', () => {
    expect(argHint({ q: '张三', subject: '写周报' })).toBe('张三');
  });

  it('reads the todo subject and the event summary', () => {
    expect(argHint({ dueTime: '2026-09-21T09:30:00+08:00', subject: '写周报' })).toBe('写周报');
    expect(argHint({ start: '2026-09-21T09:30:00+08:00', summary: '周会' })).toBe('周会');
  });

  it('falls back to the location', () => {
    expect(argHint({ eventId: 'e1', location: '三楼会议室' })).toBe('三楼会议室');
  });

  it('skips staff tokens and ids', () => {
    expect(argHint({ eventId: 'e1', name: 'staff:012345' })).toBeUndefined();
  });

  it('truncates long values', () => {
    const hint = argHint({ summary: 'a'.repeat(60) });

    expect(hint).toHaveLength(41);
    expect(hint?.endsWith('…')).toBe(true);
  });
});
