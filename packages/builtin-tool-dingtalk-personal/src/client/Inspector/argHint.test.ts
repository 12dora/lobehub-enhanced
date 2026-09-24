import { describe, expect, it } from 'vitest';

import { argHint } from './argHint';

describe('argHint', () => {
  it('returns undefined without args', () => {
    expect(argHint()).toBeUndefined();
    expect(argHint({})).toBeUndefined();
  });

  it('prefers the search keyword', () => {
    expect(argHint({ query: '每日库存', title: '写周报' })).toBe('每日库存');
  });

  it('reads the todo title, the file name and the template name', () => {
    expect(argHint({ taskId: '57475254077', title: '改成周五交' })).toBe('改成周五交');
    expect(argHint({ fileName: '2026年9月库存日报表.xlsx', resourceId: 'r1' })).toBe(
      '2026年9月库存日报表.xlsx',
    );
    expect(argHint({ contents: [], templateName: '日报', toUserIds: ['1'] })).toBe('日报');
  });

  it('never surfaces ids', () => {
    expect(argHint({ conversationId: 'cidAbc==', taskId: '57475254077' })).toBeUndefined();
  });

  it('truncates long values', () => {
    const hint = argHint({ query: 'a'.repeat(60) });

    expect(hint).toHaveLength(41);
    expect(hint?.endsWith('…')).toBe(true);
  });
});
