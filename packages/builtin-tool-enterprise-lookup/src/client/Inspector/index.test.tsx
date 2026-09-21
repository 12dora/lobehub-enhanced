/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import zhPlugin from '../../../../../locales/zh-CN/plugin.json';
import { ListCapabilitiesInspector } from './ListCapabilities';
import { QueryEnterpriseInspector } from './QueryEnterprise';

const dict = zhPlugin as Record<string, string>;

const translate = (key: string, options?: Record<string, unknown>) => {
  const raw = dict[key];
  if (raw === undefined) throw new Error(`missing zh-CN key: ${key}`);
  return raw.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('@/styles', () => ({
  inspectorTextStyles: { root: 'inspector-root' },
  shinyTextStyles: { shinyText: 'shiny' },
}));

afterEach(() => cleanup());

describe('EnterpriseLookup inspectors', () => {
  it('shows 企业查询 · <capability> for queryEnterprise', () => {
    render(
      <QueryEnterpriseInspector
        apiName="queryEnterprise"
        args={{ capability: 'search' }}
        identifier="lobe-enterprise-lookup"
      />,
    );

    expect(screen.getByText('企业查询')).toBeTruthy();
    expect(screen.getByText('· search')).toBeTruthy();
  });

  it('shows 企业查询 · 能力列表 when listing capabilities', () => {
    render(
      <ListCapabilitiesInspector
        apiName="listCapabilities"
        args={{ provider: 'qcc' }}
        identifier="lobe-enterprise-lookup"
      />,
    );

    expect(screen.getByText('企业查询')).toBeTruthy();
    expect(screen.getByText('· 能力列表')).toBeTruthy();
  });
});
