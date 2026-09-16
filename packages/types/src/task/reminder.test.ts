import { describe, expect, it } from 'vitest';

import {
  buildReminderInstruction,
  formatReminderMentionToken,
  isReminderTaskConfig,
  parseReminderMentions,
  stripReminderMentions,
} from './reminder';

describe('reminder mention helpers', () => {
  it('parses person and department mentions', () => {
    expect(parseReminderMentions('@胡玉琴A·外贸组 @邵军军·业务部 @财务部\n\n开会')).toEqual([
      { dept: '外贸组', name: '胡玉琴A', raw: '@胡玉琴A·外贸组' },
      { dept: '业务部', name: '邵军军', raw: '@邵军军·业务部' },
      { dept: undefined, name: '财务部', raw: '@财务部' },
    ]);
  });

  it('ignores e-mail addresses', () => {
    expect(parseReminderMentions('联系 a@b.com 处理')).toEqual([]);
  });

  it('strips mentions and keeps the content', () => {
    expect(stripReminderMentions('@胡玉琴A·外贸组 @邵军军·业务部\n\n每日例会 9:00')).toBe(
      '每日例会 9:00',
    );
  });

  it('builds the canonical body', () => {
    const body = buildReminderInstruction(
      [
        { deptName: '外贸组', deptPath: '公司/外贸组', displayName: '胡玉琴A', kind: 'user', staffId: '1' },
        { deptId: 'd1', deptName: '', deptPath: '公司/财务部', displayName: '财务部', kind: 'department' },
      ],
      ' 开会 ',
    );
    expect(body).toBe('@胡玉琴A·外贸组 @财务部\n\n开会');
    expect(
      formatReminderMentionToken({ deptName: '', deptPath: '', displayName: '张三', kind: 'user' }),
    ).toBe('@张三');
  });

  it('detects reminder task configs', () => {
    expect(isReminderTaskConfig({ reminder: { kind: 'reminder' } })).toBe(true);
    expect(isReminderTaskConfig({ schedule: {} })).toBe(false);
    expect(isReminderTaskConfig(null)).toBe(false);
  });
});
