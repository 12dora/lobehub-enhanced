// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { encodeSaveTemplateFields } from './formComponents';
import { DingtalkFormInvalidError } from './formError';

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
    try {
      encodeSaveTemplateFields([{ componentType: 'UnknownWidget', label: 'x' }]);
    } catch (error) {
      expect((error as DingtalkFormInvalidError).hint).toBe('UnknownWidget');
      expect((error as DingtalkFormInvalidError).code).toBe('DINGTALK_INVALID');
    }
  });

  it('rejects a select without options', () => {
    try {
      encodeSaveTemplateFields([{ componentType: 'DDSelectField', label: '类型' }]);
      throw new Error('expected throw');
    } catch (error) {
      expect((error as DingtalkFormInvalidError).hint).toBe('DDSelectField.options');
    }
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
    expect(components[2]?.props).toMatchObject({ label: '部门', multiple: false });
  });
});
