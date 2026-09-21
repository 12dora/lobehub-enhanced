import type { ApprovalRuleConditions } from '@lobechat/types';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import enSetting from '../../../locales/en-US/setting.json';
import zhSetting from '../../../locales/zh-CN/setting.json';
import { buildRuleConditionSummary } from './conditionSummary';

/** Real shipped copy so a renamed/missing key fails here instead of shipping. */
const translator = (dict: Record<string, string>) => {
  const translate = (key: string, options?: Record<string, unknown>) => {
    const raw = dict[key];
    if (raw === undefined) throw new Error(`missing setting key: ${key}`);
    return raw.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
  };

  return translate as unknown as TFunction<'setting'>;
};

const zh = translator(zhSetting as Record<string, string>);
const en = translator(enSetting as Record<string, string>);

const conditions = (partial: Partial<ApprovalRuleConditions> = {}): ApprovalRuleConditions => ({
  match: 'all',
  ...partial,
});

describe('buildRuleConditionSummary', () => {
  it('names originators and spells out a numeric field clause', () => {
    const summary = buildRuleConditionSummary(
      conditions({
        fields: [{ componentId: 'DDSelectField_1', label: '请假天数', op: 'lte', value: 1 }],
        originators: { deptIds: ['d1'], staffIds: ['u1'] },
      }),
      zh,
      { d1: '研发部', u1: '张三' },
    );

    expect(summary).toBe('发起人：张三、研发部；请假天数 ≤ 1');
  });

  it('reads naturally in en-US with its own separators', () => {
    const summary = buildRuleConditionSummary(
      conditions({
        fields: [{ componentId: 'f1', label: 'Leave days', op: 'lte', value: 1 }],
        originators: { staffIds: ['u1', 'u2'] },
      }),
      en,
      { u1: 'Zhang San', u2: 'Li Si' },
    );

    expect(summary).toBe('Initiator: Zhang San, Li Si; Leave days ≤ 1');
  });

  it('renders every comparison operator with its symbol', () => {
    const ops = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'] as const;
    const symbols = ops.map((op) =>
      buildRuleConditionSummary(
        conditions({ fields: [{ componentId: 'f', label: '金额', op, value: 100 }] }),
        zh,
      ),
    );

    expect(symbols).toEqual([
      '金额 = 100',
      '金额 ≠ 100',
      '金额 < 100',
      '金额 ≤ 100',
      '金额 > 100',
      '金额 ≥ 100',
    ]);
  });

  it('uses the localized word operators for contains / in and joins list values', () => {
    expect(
      buildRuleConditionSummary(
        conditions({
          fields: [{ componentId: 'f', label: '事由', op: 'contains', value: '出差' }],
        }),
        zh,
      ),
    ).toBe('事由 包含 出差');

    expect(
      buildRuleConditionSummary(
        conditions({
          fields: [{ componentId: 'f', label: '类型', op: 'in', value: ['年假', '调休'] }],
        }),
        zh,
      ),
    ).toBe('类型 属于 年假、调休');
  });

  it('falls back to "selected people" when no originator name was resolved', () => {
    const summary = buildRuleConditionSummary(
      conditions({ originators: { staffIds: ['u1', 'u2'] } }),
      zh,
    );

    // A staff id is not an answer to "who does this rule cover?".
    expect(summary).toBe('发起人：指定人员');
    expect(summary).not.toContain('u1');
  });

  it('keeps the names it could resolve and drops the ones it could not', () => {
    const summary = buildRuleConditionSummary(
      conditions({ originators: { staffIds: ['u1', 'u2'] } }),
      zh,
      { u1: '张三' },
    );

    expect(summary).toBe('发起人：张三');
  });

  it('states that a rule without conditions covers every request', () => {
    expect(buildRuleConditionSummary(conditions(), zh)).toBe('全部审批单');
    expect(buildRuleConditionSummary(null, zh)).toBe('全部审批单');
    expect(buildRuleConditionSummary(undefined, zh)).toBe('全部审批单');
  });

  it('ignores blank originator ids instead of claiming an initiator clause', () => {
    expect(buildRuleConditionSummary(conditions({ originators: { staffIds: [''] } }), zh)).toBe(
      '全部审批单',
    );
  });

  it('falls back to the component id when the field carries no label', () => {
    expect(
      buildRuleConditionSummary(
        conditions({ fields: [{ componentId: 'DDNumberField_1', label: '', op: 'eq', value: 2 }] }),
        zh,
      ),
    ).toBe('DDNumberField_1 = 2');
  });

  it('names an unrenderable clause generically rather than dropping it', () => {
    // Dropping the clause would claim the rule matches every request of the
    // template — a summary that is wrong in the dangerous direction.
    expect(
      buildRuleConditionSummary(
        conditions({ fields: [{ componentId: '', label: '', op: 'eq', value: '' }] }),
        zh,
      ),
    ).toBe('其他条件');

    expect(
      buildRuleConditionSummary(
        conditions({ fields: [{ componentId: 'f', label: '类型', op: 'in', value: [] }] }),
        zh,
      ),
    ).toBe('其他条件');
  });

  it('joins several field clauses in order', () => {
    expect(
      buildRuleConditionSummary(
        conditions({
          fields: [
            { componentId: 'f1', label: '请假天数', op: 'lte', value: 1 },
            { componentId: 'f2', label: '事由', op: 'contains', value: '年假' },
          ],
        }),
        zh,
      ),
    ).toBe('请假天数 ≤ 1；事由 包含 年假');
  });
});
