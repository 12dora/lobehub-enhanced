import { describe, expect, it } from 'vitest';

import { convertGfmTablesForDingTalk } from './markdownTables';

describe('convertGfmTablesForDingTalk', () => {
  it('renders a 2-column key/value table as bold lines', () => {
    const input = ['| 项目 | 内容 |', '| --- | --- |', '| 经营范围 | 助剂、化工产品销售 |'].join(
      '\n',
    );

    expect(convertGfmTablesForDingTalk(input)).toBe('**经营范围**：助剂、化工产品销售');
  });

  it('splits the enterprise 项目|内容|项目|内容 layout into one line per pair', () => {
    const input = [
      '当事人',
      '',
      '| 项目 | 内容 | 项目 | 内容 |',
      '| --- | --- | --- | --- |',
      '| 企业名称 | 绍兴市越城区国泰助剂有限公司 | 企业简称 | 国泰助剂 |',
      '| 法定代表人 | 邵国标 | 注册资本 | 500万人民币 |',
      '| 成立日期 | 2016-06-08 |  |  |',
      '',
      '| 项目 | 内容 |',
      '|---|---|',
      '| 经营范围 | 助剂销售 |',
    ].join('\n');

    expect(convertGfmTablesForDingTalk(input)).toBe(
      [
        '当事人',
        '',
        '**企业名称**：绍兴市越城区国泰助剂有限公司',
        '**企业简称**：国泰助剂',
        '**法定代表人**：邵国标',
        '**注册资本**：500万人民币',
        '**成立日期**：2016-06-08',
        '',
        '**经营范围**：助剂销售',
      ].join('\n'),
    );
  });

  it('renders wider rows as first-cell label plus named columns', () => {
    const input = [
      '| 姓名 | 职务 | 持股 |',
      '| :--- | --- | ---: |',
      '| 张三 | 总经理 | 60% |',
      '| 李四 | 监事 |  |',
    ].join('\n');

    expect(convertGfmTablesForDingTalk(input)).toBe(
      ['**张三**：职务 总经理；持股 60%', '**李四**：职务 监事'].join('\n'),
    );
  });

  it('leaves fenced code blocks untouched, including tables inside them', () => {
    const input = [
      '说明',
      '',
      '```md',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '```',
      '',
      '结束',
    ].join('\n');

    expect(convertGfmTablesForDingTalk(input)).toBe(input);
  });

  it('does not treat a pipe in prose as a table', () => {
    const input = '选择 A | B 即可，不要画表。';
    expect(convertGfmTablesForDingTalk(input)).toBe(input);
  });

  it('keeps a pipe inside an inline code span', () => {
    const input = ['| 键 | 值 |', '| --- | --- |', '| 键 | `a|b` |'].join('\n');
    expect(convertGfmTablesForDingTalk(input)).toBe('**键**：`a|b`');
  });

  it('keeps an escaped pipe and a longer code span', () => {
    const input = ['| 键 | 值 |', '| --- | --- |', '| 路径 | a\\|b ``c|d`` |'].join('\n');
    expect(convertGfmTablesForDingTalk(input)).toBe('**路径**：a|b ``c|d``');
  });

  it('strips bold markers inside cells so labels are not doubled', () => {
    const input = ['| 项目 | 内容 |', '| --- | --- |', '| **甲方** | 福瑞思 |'].join('\n');
    expect(convertGfmTablesForDingTalk(input)).toBe('**甲方**：福瑞思');
  });

  it('is idempotent on already-converted text, including values that still contain pipes', () => {
    const input = [
      '当事人',
      '',
      '| 项目 | 内容 | 项目 | 内容 |',
      '| --- | --- | --- | --- |',
      '| 企业名称 | 国泰助剂 | 备注 | A \\| B |',
      '',
      '选择 A | B 即可，不要画表。',
    ].join('\n');

    const once = convertGfmTablesForDingTalk(input);
    expect(once).toContain('|');
    expect(once).not.toContain('| --- |');
    expect(convertGfmTablesForDingTalk(once)).toBe(once);
    expect(convertGfmTablesForDingTalk(convertGfmTablesForDingTalk(once))).toBe(once);
  });
});
