// @vitest-environment node
import type { ApprovalRuleConditions, ApprovalRuleFieldCondition } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  decodeFormValue,
  fieldOpFitsComponentType,
  matchApprovalRule,
  parseDateValue,
  parseNumberValue,
} from './match';

const conditions = (overrides: Partial<ApprovalRuleConditions> = {}): ApprovalRuleConditions => ({
  match: 'all',
  ...overrides,
});

const field = (
  overrides: Partial<ApprovalRuleFieldCondition> & Pick<ApprovalRuleFieldCondition, 'op' | 'value'>,
): ApprovalRuleFieldCondition => ({
  componentId: 'NumberField-1',
  label: '金额',
  ...overrides,
});

const originator = (staffId = 'staff_a', deptIds: string[] = ['dept_leaf', 'dept_parent']) => ({
  deptIds,
  staffId,
});

describe('fieldOpFitsComponentType', () => {
  it('allows eq/ne on every type', () => {
    expect(fieldOpFitsComponentType('eq', 'TextField')).toBe(true);
    expect(fieldOpFitsComponentType('ne', 'DDPhotoField')).toBe(true);
  });

  it('restricts numeric inequalities to number/money/rating/date', () => {
    expect(fieldOpFitsComponentType('gt', 'NumberField')).toBe(true);
    expect(fieldOpFitsComponentType('lt', 'MoneyField')).toBe(true);
    expect(fieldOpFitsComponentType('gte', 'StarRatingField')).toBe(true);
    expect(fieldOpFitsComponentType('lte', 'DDDateField')).toBe(true);
    expect(fieldOpFitsComponentType('gt', 'TextField')).toBe(false);
    expect(fieldOpFitsComponentType('lt', 'DDSelectField')).toBe(false);
  });

  it('allows contains/in on text and select', () => {
    expect(fieldOpFitsComponentType('contains', 'TextField')).toBe(true);
    expect(fieldOpFitsComponentType('in', 'DDMultiSelectField')).toBe(true);
    expect(fieldOpFitsComponentType('contains', 'DDPhotoField')).toBe(false);
  });
});

describe('parseNumberValue / parseDateValue / decodeFormValue', () => {
  it('parses numbers from strings and money prefixes', () => {
    expect(parseNumberValue('100')).toBe(100);
    expect(parseNumberValue(' 100.50 ')).toBe(100.5);
    expect(parseNumberValue('¥200')).toBe(200);
    expect(parseNumberValue('1,000')).toBe(1000);
    expect(parseNumberValue('12px')).toBeNull();
    expect(parseNumberValue('')).toBeNull();
    expect(parseNumberValue('abc')).toBeNull();
  });

  it('parses ISO dates and date-only values', () => {
    expect(parseDateValue('2021-08-17')).toBe(Date.parse('2021-08-17T00:00:00.000Z'));
    expect(parseDateValue('2021-08-17T08:00:00+08:00')).toBe(
      Date.parse('2021-08-17T08:00:00+08:00'),
    );
    expect(parseDateValue('not-a-date')).toBeNull();
    expect(parseDateValue('["2019-02-19","2019-02-25"]')).toBe(
      Date.parse('2019-02-19T00:00:00.000Z'),
    );
  });

  it('decodes JSON arrays and leaves plain strings', () => {
    expect(decodeFormValue('["选项1","选项2"]')).toEqual(['选项1', '选项2']);
    expect(decodeFormValue('选项1')).toBe('选项1');
    expect(decodeFormValue(null)).toBe('');
  });
});

describe('matchApprovalRule originator', () => {
  it('matches everyone when originators is omitted', () => {
    expect(
      matchApprovalRule(conditions(), {
        formValues: [],
        originator: originator('anyone', []),
      }),
    ).toBe(true);
  });

  it('matches by staffId', () => {
    const rule = conditions({ originators: { staffIds: ['staff_a', 'staff_b'] } });
    expect(matchApprovalRule(rule, { formValues: [], originator: originator('staff_a') })).toBe(
      true,
    );
    expect(matchApprovalRule(rule, { formValues: [], originator: originator('staff_z') })).toBe(
      false,
    );
  });

  it('matches by department including ancestors supplied by the caller', () => {
    const rule = conditions({ originators: { deptIds: ['dept_parent'] } });
    expect(
      matchApprovalRule(rule, {
        formValues: [],
        originator: originator('staff_leaf', ['dept_leaf', 'dept_parent']),
      }),
    ).toBe(true);
    expect(
      matchApprovalRule(rule, {
        formValues: [],
        originator: originator('staff_other', ['dept_other']),
      }),
    ).toBe(false);
  });

  it('ORs staffIds and deptIds', () => {
    const rule = conditions({
      originators: { deptIds: ['dept_sales'], staffIds: ['staff_a'] },
    });
    expect(matchApprovalRule(rule, { formValues: [], originator: originator('staff_a', []) })).toBe(
      true,
    );
    expect(
      matchApprovalRule(rule, {
        formValues: [],
        originator: originator('staff_other', ['dept_sales']),
      }),
    ).toBe(true);
    expect(
      matchApprovalRule(rule, {
        formValues: [],
        originator: originator('staff_other', ['dept_other']),
      }),
    ).toBe(false);
  });

  it('rejects a non-all match mode', () => {
    expect(
      matchApprovalRule({ match: 'any' as 'all' }, { formValues: [], originator: originator() }),
    ).toBe(false);
  });
});

describe('matchApprovalRule fields', () => {
  it('compares numbers parsed from strings', () => {
    const rule = conditions({
      fields: [field({ op: 'gte', value: 100 })],
    });
    expect(
      matchApprovalRule(rule, {
        formValues: [{ componentId: 'NumberField-1', label: '金额', value: '150' }],
        originator: originator(),
      }),
    ).toBe(true);
    expect(
      matchApprovalRule(rule, {
        formValues: [{ componentId: 'NumberField-1', label: '金额', value: '80' }],
        originator: originator(),
      }),
    ).toBe(false);
  });

  it('compares money values', () => {
    const rule = conditions({
      fields: [field({ componentId: 'MoneyField-1', op: 'lt', value: 200 })],
    });
    expect(
      matchApprovalRule(rule, {
        formValues: [{ componentId: 'MoneyField-1', value: '¥150.00' }],
        originator: originator(),
      }),
    ).toBe(true);
  });

  it('compares ISO dates', () => {
    const rule = conditions({
      fields: [
        field({
          componentId: 'DDDateField-1',
          label: '日期',
          op: 'gte',
          value: '2026-01-01',
        }),
      ],
    });
    expect(
      matchApprovalRule(rule, {
        formValues: [{ componentId: 'DDDateField-1', value: '2026-03-01' }],
        originator: originator(),
      }),
    ).toBe(true);
    expect(
      matchApprovalRule(rule, {
        formValues: [{ componentId: 'DDDateField-1', value: '2025-12-31' }],
        originator: originator(),
      }),
    ).toBe(false);
  });

  it('uses contains on text and in on multi-select', () => {
    const contains = conditions({
      fields: [
        field({
          componentId: 'TextField-1',
          label: '事由',
          op: 'contains',
          value: '差旅',
        }),
      ],
    });
    expect(
      matchApprovalRule(contains, {
        formValues: [{ componentId: 'TextField-1', value: '上海差旅报销' }],
        originator: originator(),
      }),
    ).toBe(true);

    const included = conditions({
      fields: [
        field({
          componentId: 'DDMultiSelectField-1',
          label: '类型',
          op: 'in',
          value: ['加班', '出差'],
        }),
      ],
    });
    expect(
      matchApprovalRule(included, {
        formValues: [{ componentId: 'DDMultiSelectField-1', value: '["出差","培训"]' }],
        originator: originator(),
      }),
    ).toBe(true);
    expect(
      matchApprovalRule(included, {
        formValues: [{ componentId: 'DDMultiSelectField-1', value: '["培训"]' }],
        originator: originator(),
      }),
    ).toBe(false);
  });

  it('supports eq/ne on select options', () => {
    const rule = conditions({
      fields: [
        field({
          componentId: 'DDSelectField-1',
          label: '紧急程度',
          op: 'eq',
          value: '紧急',
        }),
      ],
    });
    expect(
      matchApprovalRule(rule, {
        formValues: [{ componentId: 'DDSelectField-1', value: '紧急' }],
        originator: originator(),
      }),
    ).toBe(true);
    expect(
      matchApprovalRule(rule, {
        formValues: [{ componentId: 'DDSelectField-1', value: '普通' }],
        originator: originator(),
      }),
    ).toBe(false);
    expect(
      matchApprovalRule(
        conditions({
          fields: [
            field({
              componentId: 'DDSelectField-1',
              label: '紧急程度',
              op: 'ne',
              value: '紧急',
            }),
          ],
        }),
        {
          formValues: [{ componentId: 'DDSelectField-1', value: '普通' }],
          originator: originator(),
        },
      ),
    ).toBe(true);
  });

  it('requires every field when match is all', () => {
    const rule = conditions({
      fields: [
        field({ componentId: 'NumberField-1', op: 'gte', value: 10 }),
        field({
          componentId: 'TextField-1',
          label: '事由',
          op: 'contains',
          value: '报销',
        }),
      ],
    });
    expect(
      matchApprovalRule(rule, {
        formValues: [
          { componentId: 'NumberField-1', value: '20' },
          { componentId: 'TextField-1', value: '差旅报销' },
        ],
        originator: originator(),
      }),
    ).toBe(true);
    expect(
      matchApprovalRule(rule, {
        formValues: [
          { componentId: 'NumberField-1', value: '20' },
          { componentId: 'TextField-1', value: '请假' },
        ],
        originator: originator(),
      }),
    ).toBe(false);
  });

  it('fails closed on unknown or unparseable fields', () => {
    const numeric = conditions({ fields: [field({ op: 'gt', value: 10 })] });
    expect(
      matchApprovalRule(numeric, {
        formValues: [],
        originator: originator(),
      }),
    ).toBe(false);
    expect(
      matchApprovalRule(numeric, {
        formValues: [{ componentId: 'NumberField-1', value: 'not-a-number' }],
        originator: originator(),
      }),
    ).toBe(false);

    const dated = conditions({
      fields: [field({ componentId: 'DDDateField-1', op: 'gt', value: '2026-01-01' })],
    });
    expect(
      matchApprovalRule(dated, {
        formValues: [{ componentId: 'DDDateField-1', value: 'tomorrow' }],
        originator: originator(),
      }),
    ).toBe(false);
  });

  it('resolves form values by label when componentId is absent on the instance', () => {
    const rule = conditions({
      fields: [field({ componentId: 'TextField-missing', label: '事由', op: 'eq', value: 'OK' })],
    });
    expect(
      matchApprovalRule(rule, {
        formValues: [{ label: '事由', value: 'OK' }],
        originator: originator(),
      }),
    ).toBe(true);
  });
});
