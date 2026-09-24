import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { resolveInterventionLabel, useInterventionLabel } from './interventionLabel';

const zhPlugin: Record<string, string> = {
  'builtins.lobe-dingtalk-personal.apiName.completeTodo': '完成待办',
  'builtins.lobe-dingtalk-personal.title': '钉钉个人数据',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { exists: (key: string) => key in zhPlugin },
    t: (key: string) => zhPlugin[key] ?? key,
  }),
}));

const metaById: Record<string, { title?: string }> = {
  'github-mcp': { title: 'GitHub' },
};

vi.mock('@/store/tool', () => ({
  pluginHelpers: { getPluginTitle: (meta?: { title?: string }) => meta?.title },
  useToolStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/tool/selectors', () => ({
  toolSelectors: { getMetaById: (id: string) => () => metaById[id] },
}));

const translateFrom =
  (dict: Record<string, string>) =>
  (key: string): string | undefined =>
    dict[key];

describe('resolveInterventionLabel', () => {
  it('uses the translated API label', () => {
    expect(
      resolveInterventionLabel({
        apiName: 'completeTodo',
        identifier: 'lobe-dingtalk-personal',
        translate: translateFrom(zhPlugin),
      }),
    ).toBe('完成待办');
  });

  it('falls back to the translated tool title plus the API name', () => {
    expect(
      resolveInterventionLabel({
        apiName: 'completeTodos',
        identifier: 'lobe-dingtalk-personal',
        translate: translateFrom(zhPlugin),
      }),
    ).toBe('钉钉个人数据 · completeTodos');
  });

  it('falls back to the manifest meta title plus the API name', () => {
    expect(
      resolveInterventionLabel({
        apiName: 'create_issue',
        identifier: 'github-mcp',
        metaTitle: 'GitHub',
        translate: translateFrom({}),
      }),
    ).toBe('GitHub · create_issue');
  });

  it('falls back to the API name when nothing is known about the tool', () => {
    expect(
      resolveInterventionLabel({
        apiName: 'doThing',
        identifier: 'unknown-tool',
        translate: translateFrom({}),
      }),
    ).toBe('doThing');
  });

  it('ignores blank translations', () => {
    expect(
      resolveInterventionLabel({
        apiName: 'completeTodo',
        identifier: 'lobe-dingtalk-personal',
        translate: translateFrom({
          'builtins.lobe-dingtalk-personal.apiName.completeTodo': '  ',
          'builtins.lobe-dingtalk-personal.title': '钉钉个人数据',
        }),
      }),
    ).toBe('钉钉个人数据 · completeTodo');
  });
});

describe('useInterventionLabel', () => {
  it('returns the Chinese label when the plugin namespace has one', () => {
    const { result } = renderHook(() =>
      useInterventionLabel('lobe-dingtalk-personal', 'completeTodo'),
    );

    expect(result.current).toBe('完成待办');
  });

  it('never returns the raw key for a missing translation', () => {
    const { result } = renderHook(() => useInterventionLabel('github-mcp', 'create_issue'));

    expect(result.current).toBe('GitHub · create_issue');
  });
});
