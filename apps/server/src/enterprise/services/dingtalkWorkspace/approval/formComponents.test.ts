// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { encodeSaveTemplateFields, MAX_FORM_COMPONENTS } from './formComponents';
import { DingtalkFormInvalidError } from './formError';

const expectProblems = (fields: Parameters<typeof encodeSaveTemplateFields>[0]) => {
  try {
    encodeSaveTemplateFields(fields);
    throw new Error('expected throw');
  } catch (error) {
    expect(error).toBeInstanceOf(DingtalkFormInvalidError);
    return error as DingtalkFormInvalidError;
  }
};

describe('encodeSaveTemplateFields', () => {
  it('fills DDDateField unit and format defaults', () => {
    const { components } = encodeSaveTemplateFields([
      { componentType: 'DDDateField', label: '开始日期', required: true },
    ]);
    expect(components[0]).toMatchObject({
      componentType: 'DDDateField',
      props: {
        componentId: 'DDDateField_1',
        format: 'yyyy-MM-dd',
        label: '开始日期',
        required: true,
        unit: '天',
      },
    });
  });

  it('uses hour format when unit is 小时', () => {
    const { components } = encodeSaveTemplateFields([
      { componentType: 'DDDateField', label: '时间', unit: '小时' },
    ]);
    expect(components[0]?.props).toMatchObject({
      format: 'yyyy-MM-dd HH:mm',
      unit: '小时',
    });
  });

  it('encodes DDDateRangeField labels as a JSON string', () => {
    const { components } = encodeSaveTemplateFields([
      {
        componentType: 'DDDateRangeField',
        label: ['开始时间', '结束时间'],
      },
    ]);
    expect(components[0]?.props.label).toBe('["开始时间","结束时间"]');
    expect(typeof components[0]?.props.label).toBe('string');
  });

  it('converts string select options to {key,value} objects', () => {
    const { components } = encodeSaveTemplateFields([
      { componentType: 'DDSelectField', label: '类型', options: ['A', 'B'] },
    ]);
    expect(components[0]?.props.options).toEqual([
      { key: 'option_0', value: 'A' },
      { key: 'option_1', value: 'B' },
    ]);
  });

  it('rejects unsupported component types before any encoding of siblings is returned', () => {
    expect(() =>
      encodeSaveTemplateFields([
        { componentType: 'TextField', label: '事由' },
        { componentType: 'UnknownWidget', label: 'x' },
      ]),
    ).toThrow(DingtalkFormInvalidError);
    const error = expectProblems([{ componentType: 'UnknownWidget', label: 'x' }]);
    expect(error.hint).toBe('UnknownWidget');
    expect(error.code).toBe('DINGTALK_INVALID');
    expect(error.problems).toEqual([
      expect.objectContaining({
        componentType: 'UnknownWidget',
        index: 0,
        issue: 'unsupported',
        suggestion: 'use TextField',
      }),
    ]);
  });

  it('rejects a select without options', () => {
    const error = expectProblems([{ componentType: 'DDSelectField', label: '类型' }]);
    expect(error.hint).toBe('DDSelectField.options');
    expect(error.problems).toEqual([
      expect.objectContaining({
        componentType: 'DDSelectField',
        index: 0,
        issue: 'options',
        suggestion: 'provide at least 2 options',
      }),
    ]);
  });

  it('rejects a select with fewer than 2 options', () => {
    const error = expectProblems([
      { componentType: 'DDSelectField', label: '类型', options: ['仅一项'] },
    ]);
    expect(error.problems).toEqual([
      expect.objectContaining({ componentType: 'DDSelectField', issue: 'options', index: 0 }),
    ]);
  });

  it('asks for columns when a TableField has no children', () => {
    const error = expectProblems([{ componentType: 'TableField', label: '明细' }]);
    expect(error.problems).toEqual([
      expect.objectContaining({
        componentType: 'TableField',
        issue: 'children',
        suggestion: 'provide at least one column',
      }),
    ]);
  });

  it('encodes TableField children and assigns stable component ids', () => {
    const { components, fields } = encodeSaveTemplateFields([
      {
        children: [
          { componentType: 'TextField', label: '名称' },
          { componentType: 'NumberField', label: '数量', required: true },
        ],
        componentType: 'TableField',
        label: '明细',
      },
    ]);
    expect(components[0]?.props.componentId).toBe('TableField_1');
    expect(components[0]?.children).toEqual([
      expect.objectContaining({
        componentType: 'TextField',
        props: expect.objectContaining({ componentId: 'TextField_1', label: '名称' }),
      }),
      expect.objectContaining({
        componentType: 'NumberField',
        props: expect.objectContaining({ componentId: 'NumberField_1', required: true }),
      }),
    ]);
    expect(fields[0]).toMatchObject({
      componentType: 'TableField',
      label: '明细',
      required: false,
    });
  });

  it('applies MoneyField / contact / department defaults', () => {
    const { components } = encodeSaveTemplateFields([
      { componentType: 'MoneyField', label: '金额' },
      { componentType: 'InnerContactField', label: '联系人' },
      { componentType: 'DepartmentField', label: '部门' },
    ]);
    expect(components[0]?.props).toMatchObject({ label: '金额', upper: '0' });
    expect(components[1]?.props).toMatchObject({ choice: '0', label: '联系人' });
    expect(typeof components[1]?.props.choice).toBe('string');
    expect(components[2]?.props).toMatchObject({ label: '部门', multiple: false });
  });

  it('encodes IdCardField', () => {
    const { components } = encodeSaveTemplateFields([
      { componentType: 'IdCardField', label: '身份证号', required: true },
    ]);
    expect(components[0]).toMatchObject({
      componentType: 'IdCardField',
      props: expect.objectContaining({ label: '身份证号', required: true }),
    });
  });

  it('rejects SeqNumberField with a remove suggestion because DingTalk generates the serial', () => {
    const error = expectProblems([{ componentType: 'SeqNumberField', label: '流水号' }]);
    expect(error.hint).toBe('SeqNumberField');
    expect(error.problems).toEqual([
      expect.objectContaining({
        componentType: 'SeqNumberField',
        index: 0,
        issue: 'unsupported',
        label: '流水号',
        suggestion: 'remove: DingTalk generates it',
      }),
    ]);
  });

  it('rejects a 流水号 TextField the same way', () => {
    const error = expectProblems([{ componentType: 'TextField', label: '流水号' }]);
    expect(error.problems).toEqual([
      expect.objectContaining({
        issue: 'unsupported',
        label: '流水号',
        suggestion: 'remove: DingTalk generates it',
      }),
    ]);
  });

  it('suggests the closest supported type for unmodeled components', () => {
    const error = expectProblems([
      { componentType: 'CalculateField', label: '合计' },
      { componentType: 'RelateField', label: '关联审批' },
      { componentType: 'RecipientAccountField', label: '收款账户' },
    ]);
    expect(error.problems).toEqual([
      expect.objectContaining({
        componentType: 'CalculateField',
        suggestion:
          'formulas are not available via API; use MoneyField or NumberField and set the formula in the DingTalk designer',
      }),
      expect.objectContaining({
        componentType: 'RelateField',
        suggestion:
          'not available via API; use a TextField "关联立项单号" and tell the user to switch it to 关联审批单 in the DingTalk designer',
      }),
      expect.objectContaining({
        componentType: 'RecipientAccountField',
        suggestion: 'use TextField',
      }),
    ]);
  });

  it('returns every problem at once without dropping later fields', () => {
    const longLabel = '超长标签'.repeat(20);
    const error = expectProblems([
      { componentType: 'SeqNumberField', label: '流水号' },
      { componentType: 'DDSelectField', label: '类型' },
      { componentType: 'TextField', label: '事由' },
      { componentType: 'TextField', label: '事由' },
      { componentType: 'TextField', label: longLabel },
    ]);
    expect(error.problems?.map((item) => item.issue)).toEqual([
      'unsupported',
      'options',
      'duplicate',
      'labelLength',
    ]);
    expect(error.problems?.map((item) => item.index)).toEqual([0, 1, 3, 4]);
  });

  it('rejects more than 200 components with a form-level problem plus later field issues', () => {
    const fields = Array.from({ length: MAX_FORM_COMPONENTS + 2 }, (_, index) => ({
      componentType: index === MAX_FORM_COMPONENTS ? 'SeqNumberField' : 'TextField',
      label: `字段${index}`,
    }));
    const error = expectProblems(fields);
    expect(error.problems?.some((item) => item.issue === 'formComponents')).toBe(true);
    expect(
      error.problems?.some(
        (item) => item.componentType === 'SeqNumberField' && item.issue === 'unsupported',
      ),
    ).toBe(true);
  });
});
