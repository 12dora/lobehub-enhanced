/**
 * @vitest-environment happy-dom
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import zhPlugin from '../../../../../locales/zh-CN/plugin.json';
import { DingtalkDocsApiName } from '../apiNames';
import { DingtalkDocsInspectors } from './index';
import Summary from './Summary';

const dict = zhPlugin as Record<string, string>;

/** Real zh-CN copy, so a renamed or missing key fails here instead of shipping. */
const translate = (key: string, options?: Record<string, unknown>) => {
  const raw = dict[key];
  if (raw === undefined) throw new Error(`missing zh-CN key: ${key}`);
  return raw.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
};

const zh = (key: string, options?: Record<string, unknown>) =>
  translate(`builtins.lobe-dingtalk-docs.${key}`, options);

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));

vi.mock('@/styles', () => ({
  inspectorTextStyles: { root: 'inspector' },
  shinyTextStyles: { shinyText: 'shiny' },
}));

afterEach(() => cleanup());

const renderText = (
  apiName: string,
  args: Record<string, unknown>,
  extra: { partialArgs?: Record<string, unknown>; pluginState?: unknown } = {},
) =>
  render(
    <Summary
      apiName={apiName}
      args={args}
      identifier={'lobe-dingtalk-docs'}
      isArgumentsStreaming={!!extra.partialArgs}
      partialArgs={extra.partialArgs}
      pluginState={extra.pluginState}
    />,
  ).container.textContent;

describe('DingtalkDocsSummaryInspector', () => {
  it('is registered for every API of the toolset', () => {
    const apiNames = Object.values(DingtalkDocsApiName);

    expect(Object.keys(DingtalkDocsInspectors).sort()).toEqual([...apiNames].sort());
    for (const apiName of apiNames) expect(DingtalkDocsInspectors[apiName]).toBe(Summary);
  });

  it('has a Chinese action name for every API, never the raw apiName', () => {
    for (const apiName of Object.values(DingtalkDocsApiName)) {
      const text = renderText(apiName, {});

      expect(text).toBe(zh(`apiName.${apiName}`));
      expect(text).not.toBe(apiName);
      cleanup();
    }
  });

  it('says what a search looks for', () => {
    expect(renderText('searchDocs', { query: '周报' })).toBe(
      zh('inspector.searchDocs', { query: '周报' }),
    );
  });

  it('fills the sentence in while the arguments stream', () => {
    expect(renderText('readSheet', {}, { partialArgs: { nodeId: 'n1', range: 'A1:F20' } })).toBe(
      zh('inspector.readSheet', { range: 'A1:F20' }),
    );
  });

  it('counts the records of a write', () => {
    const records = [{ cells: { fld1: '样品 A' } }, { cells: { fld1: '样品 B' } }, { cells: {} }];

    expect(renderText('createAitableRecords', { baseId: 'b', records, tableId: 't' })).toBe(
      zh('inspector.createAitableRecords', { count: 3 }),
    );
  });

  it('names the used range once readSheet without a range is back', () => {
    const pluginState = { kind: 'sheetRange', range: 'A1:AO14', rows: [], truncated: false };

    expect(renderText('readSheet', { nodeId: 'n1' }, { pluginState })).toBe(
      zh('inspector.readSheet', { range: 'A1:AO14' }),
    );
  });

  it('marks the next page of a listing', () => {
    expect(renderText('listDrive', { cursor: '1792:00:' })).toBe(
      zh('inspector.nextPage', { action: zh('apiName.listDrive') }),
    );
  });

  it('never shows ids', () => {
    const text = renderText('readDoc', { nodeId: '14lgGw3P8vv9PgIJXYZ90D' });

    expect(text).not.toContain('14lg');
  });

  it('keeps an unknown API as it came', () => {
    expect(renderText('deleteEverything', {})).toBe('deleteEverything');
  });
});
