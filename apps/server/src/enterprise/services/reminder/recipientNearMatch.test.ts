// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { pinyinFull } from '@/database/utils/pinyin';

import { isSelfRecipientQuery, levenshtein, pickRecipientNearMatches } from './recipientNearMatch';

const ning = {
  deptPath: '捷发 / 外贸组',
  leafDeptName: '外贸组',
  name: '陈柠',
  staffId: 'staff_173',
};
const wei = {
  deptPath: '捷发 / 业务部',
  leafDeptName: '业务部',
  name: '陈伟',
  staffId: 'staff_wei',
};
const gangJust = {
  deptPath: '捷发 / 安环部',
  leafDeptName: '安环部',
  name: '刘刚',
  staffId: 'staff_041',
};

describe('recipientNearMatch', () => {
  it('treats 陈柑 as one character off 陈柠', () => {
    expect(levenshtein('陈柑', '陈柠')).toBe(1);
  });

  it('ranks a one-character typo first and caps at 5', () => {
    const extras = ['陈甲', '陈乙', '陈丙', '陈丁', '陈戊', '陈己'].map((name, i) => ({
      deptPath: '捷发 / 其他',
      leafDeptName: '其他',
      name,
      staffId: `staff_extra_${i}`,
    }));
    const picked = pickRecipientNearMatches('陈柑', [wei, ning, ...extras], { dept: '外贸组' });
    expect(picked[0]).toMatchObject({ name: '陈柠', staffId: 'staff_173' });
    expect(picked).toHaveLength(5);
  });

  it('ranks the true typo hit first among more than 80 same-surname 2-char names', () => {
    const extras = Array.from({ length: 90 }, (_, i) => ({
      deptPath: '捷发 / 其他',
      leafDeptName: '其他',
      name: `陈${String.fromCodePoint(0x4e00 + i)}`,
      staffId: `staff_extra_${i}`,
    }));
    const picked = pickRecipientNearMatches('陈柑', [...extras, wei, ning], { dept: '外贸组' });
    expect(picked[0]).toMatchObject({ name: '陈柠', staffId: 'staff_173' });
    expect(picked).toHaveLength(5);
  });

  it('does not suggest a same-surname name at distance 2', () => {
    const far = {
      deptPath: '捷发 / 业务部',
      leafDeptName: '业务部',
      name: '陈伟强',
      staffId: 'staff_weiqiang',
    };
    expect(levenshtein('陈柑柠', far.name)).toBe(2);
    expect(pickRecipientNearMatches('陈柑柠', [far])).toEqual([]);
    expect(levenshtein('陈柑', far.name)).toBe(2);
    expect(pickRecipientNearMatches('陈柑', [far])).toEqual([]);
  });

  it('prefers a dept-qualifier match when similarity ties', () => {
    const picked = pickRecipientNearMatches('陈柑', [wei, ning], { dept: '外贸组' });
    expect(picked[0]?.staffId).toBe('staff_173');
  });

  it('includes same-pinyin homophones like 刘钢 / 刘刚', () => {
    expect(pinyinFull('刘钢')).toBe(pinyinFull('刘刚'));
    const picked = pickRecipientNearMatches('刘钢', [gangJust, ning]);
    expect(picked.map((row) => row.staffId)).toEqual(['staff_041']);
  });

  it('recognizes self recipient tokens', () => {
    expect(isSelfRecipientQuery('我')).toBe(true);
    expect(isSelfRecipientQuery('自己')).toBe(true);
    expect(isSelfRecipientQuery('ME')).toBe(true);
    expect(isSelfRecipientQuery('Myself')).toBe(true);
    expect(isSelfRecipientQuery('陈柠')).toBe(false);
  });
});
