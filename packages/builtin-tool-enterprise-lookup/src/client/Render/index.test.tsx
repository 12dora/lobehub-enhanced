/**
 * @vitest-environment happy-dom
 */
import type { BuiltinRenderProps } from '@lobechat/types';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import zhPlugin from '../../../../../locales/zh-CN/plugin.json';
import type {
  CompanyProfileParams,
  ListCapabilitiesParams,
  ListCapabilitiesState,
  QueryEnterpriseParams,
  QueryEnterpriseState,
} from '../../types';
import type { CompanyProfileRenderState } from './CompanyProfile';
import CompanyProfileRender from './CompanyProfile';
import ListCapabilitiesRender from './ListCapabilities';
import { PRESENTER_LONG_VALUE_CHARS } from './presenter';
import QueryEnterpriseRender from './QueryEnterprise';

const dict = zhPlugin as Record<string, string>;

const translate = (key: string, options?: Record<string, unknown>) => {
  const raw = dict[key];
  if (raw === undefined) throw new Error(`missing zh-CN key: ${key}`);
  return raw.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('@lobehub/ui', () => ({
  Block: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Markdown: ({ children }: { children?: ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

afterEach(() => cleanup());

const renderProps = <A, S>(
  args: A,
  pluginState?: S,
  content: unknown = '',
): BuiltinRenderProps<A, S> => ({
  args,
  content,
  messageId: 'msg_1',
  pluginState,
});

/** 企查查 answers with a JSON document inside one MCP text block. */
const QCC_RESULT =
  '{"匹配结果":"多候选","备注":"","企业信息":[' +
  '{"企业名称":"示例科技有限公司","统一社会信用代码":"91110108MA01ABCDEF",' +
  '"法定代表人名称":["张三"],"状态":"存续"}]}';

describe('QueryEnterpriseRender', () => {
  it('shows the 企查查 tag, the capability and the answer as a 项目 / 内容 table', () => {
    const state: QueryEnterpriseState = {
      capability: 'search',
      provider: 'qcc',
      resultText: QCC_RESULT,
      success: true,
      truncated: false,
    };

    render(
      <QueryEnterpriseRender
        {...renderProps<QueryEnterpriseParams, QueryEnterpriseState>(
          { capability: 'search', provider: 'qcc' },
          state,
        )}
      />,
    );

    expect(screen.getByText('企查查')).toBeTruthy();
    expect(screen.getByText('search')).toBeTruthy();
    expect(screen.getByText('项目')).toBeTruthy();
    expect(screen.getByText('内容')).toBeTruthy();
    expect(screen.getByText('匹配结果')).toBeTruthy();
    expect(screen.getByText('多候选')).toBeTruthy();
    // The raw JSON is no longer the card's answer, only its footnote.
    expect(screen.getByText('原始返回').closest('details')).toBeTruthy();
  });

  it('lays a list of records out as a compact table instead of a blob', () => {
    render(
      <QueryEnterpriseRender
        {...renderProps<QueryEnterpriseParams, QueryEnterpriseState>(
          { capability: 'search', provider: 'qcc' },
          { capability: 'search', provider: 'qcc', resultText: QCC_RESULT, success: true },
        )}
      />,
    );

    expect(screen.getByText('企业信息')).toBeTruthy();
    expect(screen.getByText('统一社会信用代码')).toBeTruthy();
    expect(screen.getByText('示例科技有限公司')).toBeTruthy();
    expect(screen.getByText('91110108MA01ABCDEF')).toBeTruthy();
    // A single record needs no 「共 N 条」 footer.
    expect(screen.queryByText('共 1 条')).toBeNull();
  });

  it('renders a 天眼查 markdown answer through the markdown component', () => {
    const markdown = [
      '## 工商信息',
      '',
      '| 项目 | 内容 |',
      '| --- | --- |',
      '| 状态 | 存续 |',
    ].join('\n');

    render(
      <QueryEnterpriseRender
        {...renderProps<QueryEnterpriseParams, QueryEnterpriseState>(
          { capability: 'getDetail', provider: 'tianyancha' },
          {
            capability: 'getDetail',
            provider: 'tianyancha',
            resultText: markdown,
            success: true,
          },
        )}
      />,
    );

    expect(screen.getByText('天眼查')).toBeTruthy();
    expect(screen.getByTestId('markdown').textContent).toContain('| 状态 | 存续 |');
    // Markdown IS the readable answer; offering it a second time as raw text would be noise.
    expect(screen.queryByText('原始返回')).toBeNull();
  });

  it('clamps a long value until the reader asks for it', () => {
    const long = '经营'.repeat(PRESENTER_LONG_VALUE_CHARS);

    render(
      <QueryEnterpriseRender
        {...renderProps<QueryEnterpriseParams, QueryEnterpriseState>(
          { capability: 'getDetail', provider: 'qcc' },
          {
            capability: 'getDetail',
            provider: 'qcc',
            resultText: JSON.stringify({ a: long }),
            success: true,
          },
        )}
      />,
    );

    expect(screen.getByText(long)).toBeTruthy();
    // Only long values get the affordance, and it toggles rather than expanding once.
    fireEvent.click(screen.getByText('展开'));
    expect(screen.getByText('收起')).toBeTruthy();
    fireEvent.click(screen.getByText('收起'));
    expect(screen.getByText('展开')).toBeTruthy();
  });

  it('leaves a short value alone, with nothing to expand', () => {
    render(
      <QueryEnterpriseRender
        {...renderProps<QueryEnterpriseParams, QueryEnterpriseState>(
          { capability: 'getDetail', provider: 'qcc' },
          {
            capability: 'getDetail',
            provider: 'qcc',
            resultText: '{"状态":"存续"}',
            success: true,
          },
        )}
      />,
    );

    expect(screen.getByText('存续')).toBeTruthy();
    expect(screen.queryByText('展开')).toBeNull();
  });

  it('says so plainly when the provider returned nothing to show', () => {
    render(
      <QueryEnterpriseRender
        {...renderProps<QueryEnterpriseParams, QueryEnterpriseState>(
          { capability: 'search', provider: 'qcc' },
          { capability: 'search', provider: 'qcc', resultText: '   ', success: true },
        )}
      />,
    );

    expect(screen.getByText('未返回可展示的内容。')).toBeTruthy();
  });
});

describe('ListCapabilitiesRender', () => {
  it('shows provider tag and capability list label', () => {
    render(
      <ListCapabilitiesRender
        {...renderProps<ListCapabilitiesParams, ListCapabilitiesState>(
          { provider: 'qcc' },
          {
            provider: 'qcc',
            resultText: '{"provider":"qcc"}',
            success: true,
            toolCount: 2,
          },
        )}
      />,
    );

    expect(screen.getByText('企查查')).toBeTruthy();
    expect(screen.getByText('能力列表')).toBeTruthy();
    expect(screen.getByText('provider')).toBeTruthy();
    expect(screen.getByText('qcc')).toBeTruthy();
  });
});

describe('CompanyProfileRender', () => {
  it('names the matched company and presents its profile as a table', () => {
    render(
      <CompanyProfileRender
        {...renderProps<CompanyProfileParams, CompanyProfileRenderState>(
          { name: '示例科技', provider: 'qcc' },
          {
            company: {
              creditCode: '91110108MA01ABCDEF',
              legalPerson: '张三',
              name: '示例科技有限公司',
              status: '存续',
            },
            match: 'unique',
            profile: { content: [{ text: '{"注册资本":"1000万元"}', type: 'text' }] },
            provider: 'qcc',
            success: true,
          },
        )}
      />,
    );

    expect(screen.getByText('企查查')).toBeTruthy();
    expect(screen.getByText('示例科技有限公司')).toBeTruthy();
    expect(screen.getByText('示例科技有限公司 · 91110108MA01ABCDEF · 张三 · 存续')).toBeTruthy();
    expect(screen.getByText('注册资本')).toBeTruthy();
    expect(screen.getByText('1000万元')).toBeTruthy();
  });

  it('lists the candidates when the name matched more than one company', () => {
    render(
      <CompanyProfileRender
        {...renderProps<CompanyProfileParams, CompanyProfileRenderState>(
          { name: '示例科技', provider: 'tianyancha' },
          {
            candidateCount: 2,
            candidates: [
              {
                creditCode: '91110108MA01ABCDEF',
                legalPerson: '张三',
                name: '示例科技有限公司',
                status: '存续',
              },
              { creditCode: '91310115MA01ZYXWVU', name: '示例科技（上海）有限公司' },
            ],
            match: 'ambiguous',
            provider: 'tianyancha',
            success: true,
          },
        )}
      />,
    );

    expect(screen.getByText('候选企业（2）')).toBeTruthy();
    expect(screen.getByText('示例科技有限公司 · 91110108MA01ABCDEF · 张三 · 存续')).toBeTruthy();
    expect(screen.getByText('示例科技（上海）有限公司 · 91310115MA01ZYXWVU')).toBeTruthy();
  });
});
