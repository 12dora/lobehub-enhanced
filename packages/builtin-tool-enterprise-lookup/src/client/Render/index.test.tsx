/**
 * @vitest-environment happy-dom
 */
import type { BuiltinRenderProps } from '@lobechat/types';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import zhPlugin from '../../../../../locales/zh-CN/plugin.json';
import type {
  ListCapabilitiesParams,
  ListCapabilitiesState,
  QueryEnterpriseParams,
  QueryEnterpriseState,
} from '../../types';
import ListCapabilitiesRender from './ListCapabilities';
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
}));

vi.mock('@lobehub/ui/base-ui', () => ({
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

describe('QueryEnterpriseRender', () => {
  it('shows the 企查查 tag, capability, and a collapsible result', () => {
    const state: QueryEnterpriseState = {
      capability: 'search',
      provider: 'qcc',
      resultText: '{"name":"示例科技"}',
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
    expect(screen.getByText('查询结果')).toBeTruthy();
    expect(screen.getByText('{"name":"示例科技"}')).toBeTruthy();
    expect(screen.getByText('查询结果').closest('details')).toBeTruthy();
  });

  it('shows the 天眼查 tag when the provider is tianyancha', () => {
    render(
      <QueryEnterpriseRender
        {...renderProps<QueryEnterpriseParams, QueryEnterpriseState>(
          { capability: 'getDetail', provider: 'tianyancha' },
          {
            capability: 'getDetail',
            provider: 'tianyancha',
            resultText: 'ok',
            success: true,
          },
        )}
      />,
    );

    expect(screen.getByText('天眼查')).toBeTruthy();
    expect(screen.getByText('getDetail')).toBeTruthy();
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
    expect(screen.getByText('{"provider":"qcc"}')).toBeTruthy();
  });
});
