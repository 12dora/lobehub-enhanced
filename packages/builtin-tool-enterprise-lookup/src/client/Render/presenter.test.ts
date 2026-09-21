import { describe, expect, it } from 'vitest';

import {
  extractPayloadText,
  formatCompanySummary,
  formatPresentedValue,
  looksLikeMarkdown,
  parseJsonPayload,
  type PresentedPairs,
  type PresentedTable,
  presentEnterpriseResult,
  PRESENTER_LONG_VALUE_CHARS,
  PRESENTER_MAX_COLUMNS,
  PRESENTER_MAX_ROWS,
} from './presenter';

/** The providers answer with a JSON string, so the fixtures are written as one too. */
const mcpText = (text: string) => ({ content: [{ text, type: 'text' }] });

const pairsOf = (payload: unknown): PresentedPairs =>
  presentEnterpriseResult(payload).sections.find(
    (section): section is PresentedPairs => section.type === 'pairs',
  )!;

const tableOf = (payload: unknown): PresentedTable =>
  presentEnterpriseResult(payload).sections.find(
    (section): section is PresentedTable => section.type === 'table',
  )!;

describe('extractPayloadText', () => {
  it('reads a bare string, a text block and a content envelope alike', () => {
    expect(extractPayloadText('hello')).toBe('hello');
    expect(extractPayloadText({ text: 'hello', type: 'text' })).toBe('hello');
    expect(extractPayloadText(mcpText('hello'))).toBe('hello');
  });

  it('joins several text blocks in order', () => {
    expect(
      extractPayloadText([
        { text: 'one', type: 'text' },
        { text: 'two', type: 'text' },
      ]),
    ).toBe('one\n\ntwo');
  });

  it('says nothing for a payload that is already structured data', () => {
    expect(extractPayloadText(JSON.parse('{"企业名称":"示例科技"}'))).toBeUndefined();
    expect(
      extractPayloadText({ content: [JSON.parse('{"企业名称":"示例科技"}')] }),
    ).toBeUndefined();
  });
});

describe('parseJsonPayload', () => {
  it('parses a JSON document', () => {
    expect(parseJsonPayload(' {"a":1} ')).toEqual({ a: 1 });
  });

  it('leaves prose and malformed JSON alone', () => {
    expect(parseJsonPayload('企业名称：示例科技')).toBeUndefined();
    expect(parseJsonPayload('{"a":')).toBeUndefined();
  });
});

describe('formatPresentedValue', () => {
  it('joins a list of primitives with 、', () => {
    expect(formatPresentedValue(['张三', '李四'])).toBe('张三、李四');
  });

  it('drops empty entries and trims strings', () => {
    expect(formatPresentedValue([' 张三 ', '', null])).toBe('张三');
  });

  it('falls back to compact JSON for anything nested', () => {
    expect(formatPresentedValue({ a: 1 })).toBe('{"a":1}');
    expect(formatPresentedValue({})).toBe('');
  });
});

describe('presentEnterpriseResult — 企查查 JSON', () => {
  const qccPayload = mcpText(
    '{"匹配结果":"多候选","备注":"","企业信息":[' +
      '{"企业名称":"示例科技有限公司","统一社会信用代码":"91110108MA01ABCDEF",' +
      '"法定代表人名称":["张三"],"状态":"存续","注册资本":""},' +
      '{"企业名称":"示例科技（上海）有限公司","统一社会信用代码":"91310115MA01ZYXWVU",' +
      '"法定代表人名称":["李四"],"状态":"注销"}]}',
  );

  it('turns the scalar fields into 项目 / 内容 rows and drops the empty ones', () => {
    expect(pairsOf(qccPayload).rows).toEqual([{ label: '匹配结果', long: false, value: '多候选' }]);
  });

  it('turns a list of records into a compact table with the provider’s own column order', () => {
    const table = tableOf(qccPayload);

    expect(table.title).toBe('企业信息');
    expect(table.columns).toEqual([
      '企业名称',
      '统一社会信用代码',
      '法定代表人名称',
      '状态',
      '注册资本',
    ]);
    expect(table.rows[0]).toEqual(['示例科技有限公司', '91110108MA01ABCDEF', '张三', '存续', '']);
    expect(table.total).toBe(2);
  });

  it('keeps the list where the provider put it, after the line that introduces it', () => {
    expect(presentEnterpriseResult(qccPayload).sections.map((section) => section.type)).toEqual([
      'pairs',
      'table',
    ]);
  });

  it('keeps the raw text so the card can still offer the original answer', () => {
    expect(presentEnterpriseResult(qccPayload).rawText).toContain('"匹配结果"');
  });
});

describe('presentEnterpriseResult — shaping rules', () => {
  it('flattens a nested object one level as 「父 · 子」', () => {
    const pairs = pairsOf(
      mcpText('{"注册资本":"1000万元","联系方式":{"电话":"010-12345678","邮箱":""}}'),
    );

    expect(pairs.rows).toEqual([
      { label: '注册资本', long: false, value: '1000万元' },
      { label: '联系方式 · 电话', long: false, value: '010-12345678' },
    ]);
  });

  it('marks a long value so the view can clamp it', () => {
    const long = '经营'.repeat(PRESENTER_LONG_VALUE_CHARS);
    const rows = pairsOf(mcpText(JSON.stringify({ a: long, b: '存续' }))).rows;

    expect(rows.find((row) => row.label === 'a')!.long).toBe(true);
    expect(rows.find((row) => row.label === 'b')!.long).toBe(false);
  });

  it('puts the long pairs last so the two-per-row grid only ever gaps at the end', () => {
    const long = '经营'.repeat(PRESENTER_LONG_VALUE_CHARS);
    const pairs = pairsOf(
      mcpText(
        JSON.stringify({
          经营范围: long,
          状态: '存续',
          地址: long,
          成立日期: '2015-01-01',
        }),
      ),
    );

    // Short first, long after — and the provider's own order survives inside each group.
    expect(pairs.rows.map((row) => row.label)).toEqual(['状态', '成立日期', '经营范围', '地址']);
  });

  it('keeps the provider order untouched when no value is long', () => {
    const pairs = pairsOf(mcpText('{"状态":"存续","成立日期":"2015-01-01","注册资本":"1000万元"}'));

    expect(pairs.rows.map((row) => row.label)).toEqual(['状态', '成立日期', '注册资本']);
  });

  it('orders each pairs section on its own, leaving the record lists where they are', () => {
    const long = '经营'.repeat(PRESENTER_LONG_VALUE_CHARS);
    const sections = presentEnterpriseResult(
      mcpText(
        JSON.stringify({
          经营范围: long,
          状态: '存续',
          股东: [{ 股东名称: '张三' }],
          注册资本: '1000万元',
        }),
      ),
    ).sections;

    expect(sections.map((section) => section.type)).toEqual(['pairs', 'table', 'pairs']);
    expect((sections[0] as PresentedPairs).rows.map((row) => row.label)).toEqual([
      '状态',
      '经营范围',
    ]);
    expect((sections[2] as PresentedPairs).rows.map((row) => row.label)).toEqual(['注册资本']);
  });

  it('omits empty values whatever shape they arrive in', () => {
    expect(pairsOf(mcpText('{"a":"有效","b":"","c":null,"d":[],"e":{},"f":"   "}')).rows).toEqual([
      { label: 'a', long: false, value: '有效' },
    ]);
  });

  it('caps a record list at 8 rows and 5 columns but still reports the real total', () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      a: `a${index}`,
      b: 'b',
      c: 'c',
      d: 'd',
      e: 'e',
      f: 'f',
      g: 'g',
    }));

    const table = tableOf(mcpText(JSON.stringify({ rows: items })));

    expect(table.columns).toHaveLength(PRESENTER_MAX_COLUMNS);
    expect(table.rows).toHaveLength(PRESENTER_MAX_ROWS);
    expect(table.total).toBe(12);
  });

  it('presents a payload that is itself a list of records as one untitled table', () => {
    const table = tableOf(mcpText('[{"企业名称":"示例科技"},{"企业名称":"示例网络"}]'));

    expect(table.title).toBeUndefined();
    expect(table.total).toBe(2);
  });

  it('accepts a structured object handed over without an MCP envelope', () => {
    expect(pairsOf(JSON.parse('{"企业名称":"示例科技"}')).rows).toEqual([
      { label: '企业名称', long: false, value: '示例科技' },
    ]);
  });
});

describe('presentEnterpriseResult — 天眼查 markdown', () => {
  it('routes a markdown table to the markdown renderer', () => {
    const text = ['## 工商信息', '', '| 项目 | 内容 |', '| --- | --- |', '| 状态 | 存续 |'].join(
      '\n',
    );

    expect(presentEnterpriseResult(mcpText(text)).sections).toEqual([{ text, type: 'markdown' }]);
  });

  it('keeps plain prose verbatim rather than passing it through markdown', () => {
    expect(presentEnterpriseResult('未查询到匹配的企业。').sections).toEqual([
      { text: '未查询到匹配的企业。', type: 'text' },
    ]);
  });

  it('recognises headings, lists, links and fences as markdown', () => {
    expect(looksLikeMarkdown('# 标题')).toBe(true);
    expect(looksLikeMarkdown('- 一项')).toBe(true);
    expect(looksLikeMarkdown('见 [公告](https://example.com)')).toBe(true);
    expect(looksLikeMarkdown('```json\n{}\n```')).toBe(true);
    expect(looksLikeMarkdown('该企业状态为存续。')).toBe(false);
  });

  it('yields nothing for an empty or unreadable payload', () => {
    expect(presentEnterpriseResult(undefined).sections).toEqual([]);
    expect(presentEnterpriseResult('   ').sections).toEqual([]);
    expect(presentEnterpriseResult({ content: [] }).sections).toEqual([]);
  });
});

describe('formatCompanySummary', () => {
  it('joins the four identifying fields with ·', () => {
    expect(
      formatCompanySummary({
        creditCode: '91110108MA01ABCDEF',
        legalPerson: ['张三'],
        name: '示例科技有限公司',
        status: '存续',
      }),
    ).toBe('示例科技有限公司 · 91110108MA01ABCDEF · 张三 · 存续');
  });

  it('drops whatever the provider left out', () => {
    expect(formatCompanySummary({ name: '示例科技有限公司', status: '存续' })).toBe(
      '示例科技有限公司 · 存续',
    );
    expect(formatCompanySummary({})).toBe('');
  });
});
