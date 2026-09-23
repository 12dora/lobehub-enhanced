import { describe, expect, it } from 'vitest';

import { dingtalkErrorGuidance, formatFormProblemLine } from './errors';

describe('formatFormProblemLine', () => {
  it('asks for a column when a detail table is empty', () => {
    const line = formatFormProblemLine({
      componentType: 'TableField',
      index: 0,
      issue: 'children',
      label: '费用明细',
      suggestion: 'provide at least one column',
    });
    expect(line).toBe('[0] 费用明细（TableField）：明细表至少需要一列；为明细表添加至少一个子控件');
    expect(line).not.toContain('不能包含子控件');
  });

  it('keeps nested-table and stray-children guidance consistent', () => {
    expect(
      formatFormProblemLine({
        componentType: 'TableField',
        index: 1,
        issue: 'children',
        label: '费用明细',
        suggestion: 'remove nested TableField',
      }),
    ).toContain('不能包含子控件；明细表不能再嵌套明细表');
    expect(
      formatFormProblemLine({
        componentType: 'TextField',
        index: 2,
        issue: 'children',
        label: '备注',
        suggestion: 'omit children on this type',
      }),
    ).toContain('不能包含子控件；请去掉 children');
  });

  it('translates CalculateField and RelateField suggestions into Chinese', () => {
    const calculate = formatFormProblemLine({
      componentType: 'CalculateField',
      index: 0,
      issue: 'unsupported',
      label: '合计',
      suggestion:
        'formulas are not available via API; use MoneyField or NumberField and set the formula in the DingTalk designer',
    });
    expect(calculate).toContain('不支持该控件');
    expect(calculate).toContain(
      '公式无法通过接口设置，请改用 MoneyField 或 NumberField，并在钉钉设计器中设置公式',
    );
    expect(calculate).not.toContain('formulas are not available');

    const relate = formatFormProblemLine({
      componentType: 'RelateField',
      index: 1,
      issue: 'unsupported',
      label: '关联立项',
      suggestion:
        'not available via API; use a TextField "关联立项单号" and tell the user to switch it to 关联审批单 in the DingTalk designer',
    });
    expect(relate).toContain(
      '关联审批单无法通过接口创建，请改用 TextField「关联立项单号」，并告诉用户在钉钉设计器中切换为关联审批单',
    );
    expect(relate).not.toContain('not available via API');
  });

  it('still translates option problems', () => {
    expect(
      formatFormProblemLine({
        componentType: 'DDSelectField',
        index: 1,
        issue: 'options',
        label: '转租类型',
        suggestion: 'provide at least 2 options',
      }),
    ).toContain('选项无效；请提供至少 2 个选项');
  });

  it('puts the empty-table wording in the model-facing error', () => {
    const content = dingtalkErrorGuidance('DINGTALK_INVALID', undefined, undefined, [
      {
        componentType: 'TableField',
        index: 0,
        issue: 'children',
        label: '费用明细',
        suggestion: 'provide at least one column',
      },
    ]);
    expect(content).toContain('明细表至少需要一列');
    expect(content).toContain('为明细表添加至少一个子控件');
  });
});
