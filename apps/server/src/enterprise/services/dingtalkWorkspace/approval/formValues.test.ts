// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

class DingtalkWorkspaceError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = 'DingtalkWorkspaceError';
    this.code = code;
  }
}

vi.mock('../errors', () => ({ DingtalkWorkspaceError }));

const { encodeFieldValue, encodeFormValues, formSummary, isSuiteTemplate } =
  await import('./formValues');

const schema = {
  fields: [
    {
      componentId: 'TextField-1',
      componentType: 'TextField',
      label: '事由',
      required: true,
    },
    {
      componentId: 'NumberField-1',
      componentType: 'NumberField',
      label: '金额',
      required: true,
    },
    {
      componentId: 'DDSelectField-1',
      componentType: 'DDSelectField',
      label: '类型',
      options: ['差旅', '招待'],
      required: false,
    },
    {
      componentId: 'DDMultiSelectField-1',
      componentType: 'DDMultiSelectField',
      label: '标签',
      options: ['A', 'B'],
      required: false,
    },
    {
      componentId: 'TextNote-1',
      componentType: 'TextNote',
      label: '说明',
      required: false,
    },
  ],
  name: '报销',
  processCode: 'PROC-1',
};

describe('encodeFormValues', () => {
  it('encodes scalars and JSON array types from the fact sheet', () => {
    const encoded = encodeFormValues(schema, [
      { label: '事由', value: '出差' },
      { componentId: 'NumberField-1', value: 100 },
      { label: '类型', value: '差旅' },
      { label: '标签', value: ['A', 'B'] },
    ]);

    expect(encoded).toEqual([
      { componentType: 'TextField', id: 'TextField-1', name: '事由', value: '出差' },
      { componentType: 'NumberField', id: 'NumberField-1', name: '金额', value: '100' },
      { componentType: 'DDSelectField', id: 'DDSelectField-1', name: '类型', value: '差旅' },
      {
        componentType: 'DDMultiSelectField',
        id: 'DDMultiSelectField-1',
        name: '标签',
        value: '["A","B"]',
      },
    ]);
  });

  it('rejects missing required fields', () => {
    expect(() => encodeFormValues(schema, [{ label: '事由', value: '出差' }])).toThrow(
      DingtalkWorkspaceError,
    );
    try {
      encodeFormValues(schema, [{ label: '事由', value: '出差' }]);
    } catch (error) {
      expect((error as DingtalkWorkspaceError).code).toBe('DINGTALK_INVALID');
    }
  });

  it('rejects select values outside the configured options', () => {
    expect(() =>
      encodeFormValues(schema, [
        { label: '事由', value: '出差' },
        { label: '金额', value: '1' },
        { label: '类型', value: '不存在' },
      ]),
    ).toThrow(DingtalkWorkspaceError);
  });

  it('maps a select option key to the submitted value text', () => {
    const encoded = encodeFieldValue(
      {
        componentId: 'DDSelectField-1',
        componentType: 'DDSelectField',
        label: '公司',
        optionItems: [{ key: 'option_0', value: '浙江捷发科技股份有限公司' }],
        options: ['浙江捷发科技股份有限公司'],
        required: true,
      },
      'option_0',
    );
    expect(encoded.value).toBe('浙江捷发科技股份有限公司');
  });

  it('rejects suite templates', () => {
    expect(
      isSuiteTemplate({
        bizType: 'hrm.leave',
        fields: schema.fields,
        name: '请假',
        processCode: 'PROC-LEAVE',
      }),
    ).toBe(true);
    expect(() =>
      encodeFormValues(
        {
          bizType: 'attendance.leave',
          fields: schema.fields,
          name: '请假',
          processCode: 'PROC-LEAVE',
        },
        [
          { label: '事由', value: 'x' },
          { label: '金额', value: '1' },
        ],
      ),
    ).toThrow(DingtalkWorkspaceError);
  });

  it('encodes date-range name/value as JSON arrays', () => {
    const encoded = encodeFieldValue(
      {
        children: [
          { componentId: 's', componentType: 'DDDateField', label: '开始时间', required: true },
          { componentId: 'e', componentType: 'DDDateField', label: '结束时间', required: true },
        ],
        componentId: 'range',
        componentType: 'DDDateRangeField',
        label: '出差时间',
        required: true,
      },
      ['2019-02-19', '2019-02-25'],
    );
    expect(encoded.name).toBe('["开始时间","结束时间"]');
    expect(encoded.value).toBe('["2019-02-19","2019-02-25"]');
  });
});

describe('formSummary', () => {
  it('keeps the first six named values', () => {
    const rows = Array.from({ length: 8 }, (_, index) => ({
      name: `f${index}`,
      value: `v${index}`,
    }));
    expect(formSummary(rows, 6)).toHaveLength(6);
    expect(formSummary(rows, 6)[0]).toEqual({ label: 'f0', value: 'v0' });
  });
});
