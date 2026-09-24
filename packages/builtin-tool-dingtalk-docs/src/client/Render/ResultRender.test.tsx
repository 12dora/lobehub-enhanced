/**
 * @vitest-environment happy-dom
 */
import type { BuiltinRenderProps } from '@lobechat/types';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import zhPlugin from '../../../../../locales/zh-CN/plugin.json';
import { DingtalkDocsApiName } from '../apiNames';
import { AITABLE_FIELD_TYPES } from './AitableSchema';
import { TABLE_VISIBLE_ROW_LIMIT } from './DataTable';
import { DingtalkDocsRenders } from './index';
import ResultRender from './ResultRender';

const dict = zhPlugin as Record<string, string>;
const D = 'builtins.lobe-dingtalk-docs';
const PERSONAL = 'builtins.lobe-dingtalk-personal';

/** Real zh-CN copy, so a renamed or missing key fails here instead of shipping. */
const translate = (key: string, options?: Record<string, unknown>) => {
  const raw = dict[key];
  if (raw === undefined) throw new Error(`missing zh-CN key: ${key}`);
  return raw.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
};

const zh = (key: string, options?: Record<string, unknown>) => translate(`${D}.${key}`, options);
const zhPersonal = (key: string, options?: Record<string, unknown>) =>
  translate(`${PERSONAL}.${key}`, options);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh-CN' }, t: translate }),
}));

vi.mock('@/features/DingtalkPersonal/AuthorizeCard', () => ({
  AuthorizeCard: ({ compact }: { compact?: boolean }) => (
    <div data-compact={String(!!compact)} data-testid="authorize-card" />
  ),
}));

// The shared cards come from the personal and workspace client entries; keep their own services
// and the inspector styles out of this test.
vi.mock('@/services/dingtalkPersonal', () => ({ dingtalkPersonalService: {} }));
vi.mock('@/services/dingtalkWorkspace', () => ({ dingtalkWorkspaceService: {} }));
vi.mock('@/styles', () => ({
  inspectorTextStyles: { root: 'inspector' },
  shinyTextStyles: { shinyText: 'shiny' },
}));

vi.mock('@lobehub/ui', () => ({
  Block: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Highlighter: ({ children }: { children?: ReactNode }) => <pre>{children}</pre>,
  Icon: () => <span />,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Alert: ({ description, title }: { description?: ReactNode; title?: ReactNode }) => (
    <div role="alert">
      <span>{title}</span>
      {description}
    </div>
  ),
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Skeleton: () => <span />,
  SkeletonText: () => <span />,
  Tag: ({ children }: { children?: ReactNode }) => <span data-testid="tag">{children}</span>,
  toast: { error: vi.fn() },
}));

afterEach(() => cleanup());

const props = (
  apiName: string,
  pluginState?: unknown,
  pluginError?: unknown,
): BuiltinRenderProps<Record<string, unknown>, any> => ({
  apiName,
  args: {},
  content: '',
  messageId: 'msg_1',
  pluginError,
  pluginState,
});

describe('DingtalkDocsRenders registry', () => {
  it('registers the result view for every API', () => {
    const apiNames = Object.values(DingtalkDocsApiName);

    expect(Object.keys(DingtalkDocsRenders).sort()).toEqual([...apiNames].sort());
    expect(new Set(Object.values(DingtalkDocsRenders))).toEqual(new Set([ResultRender]));
  });
});

describe('ResultRender — shared states', () => {
  it('shows the inline authorize card even though the call failed', () => {
    render(
      <ResultRender
        {...props(
          'searchDocs',
          {
            code: 'DINGTALK_PERSONAL_UNAUTHORIZED',
            kind: 'authorizationRequired',
            settingsPath: '/settings/connector',
          },
          { message: 'DINGTALK_PERSONAL_UNAUTHORIZED' },
        )}
      />,
    );

    expect(screen.getByTestId('authorize-card').dataset.compact).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('maps a failure to its stable short message', () => {
    render(
      <ResultRender
        {...props('readSheet', undefined, { body: { code: 'DINGTALK_PERSONAL_RATE_LIMITED' } })}
      />,
    );

    expect(screen.getByRole('alert').textContent).toBe(
      zhPersonal('render.error.DINGTALK_PERSONAL_RATE_LIMITED'),
    );
  });

  it('sends a switched-off docs or sheets feature to the admin page', () => {
    const view = render(
      <ResultRender
        {...props('queryAitableRecords', undefined, {
          message: 'DINGTALK_PERSONAL_FEATURE_DISABLED',
        })}
      />,
    );

    const disabled = zhPersonal('render.error.DINGTALK_PERSONAL_FEATURE_DISABLED');
    expect(within(view.container).getByText(disabled)).toBeTruthy();
    expect(
      within(view.container)
        .getByRole('link', { name: dict['builtins.dingtalk.action.adminImConnectors'] })
        .getAttribute('href'),
    ).toBe('/admin/system/general?tab=im-connectors');
  });

  it('points the org CLI policy at the DingTalk developer console', () => {
    render(
      <ResultRender
        {...props('searchDrive', undefined, { message: 'DINGTALK_PERSONAL_ORG_POLICY_DENIED' })}
      />,
    );

    const link = screen.getByRole('link', { name: dict['builtins.dingtalk.action.cliSettings'] });
    expect(link.getAttribute('href')).toBe(
      'https://open-dev.dingtalk.com/fe/old#/developerSettings',
    );
  });

  it('renders nothing without a state or for an unknown kind', () => {
    const { container } = render(<ResultRender {...props('searchDocs')} />);
    const unknown = render(<ResultRender {...props('searchDocs', { kind: 'mystery' })} />);

    expect(container.innerHTML).toBe('');
    expect(unknown.container.innerHTML).toBe('');
  });
});

describe('ResultRender — documents, knowledge bases, 钉盘', () => {
  it('lists documents with their kind, last edit and link', () => {
    const { container } = render(
      <ResultRender
        {...props('searchDocs', {
          hasMore: true,
          items: [
            {
              docType: 'axls',
              modifiedTime: 1_790_178_236_600,
              name: '9 月库存日报',
              nodeId: 'vNG4abc',
              url: 'https://alidocs.dingtalk.com/i/nodes/vNG4abc',
            },
            { docType: 'xlsx', modifiedTime: null, name: '', nodeId: 'mweZdef' },
            { docType: 'adoc', name: '坏链接', nodeId: 'x', url: 'javascript:alert(1)' },
          ],
          kind: 'docs',
        })}
      />,
    );

    expect(screen.getByText(zh('apiName.searchDocs'))).toBeTruthy();
    expect(screen.getByText(zhPersonal('render.count', { count: 3 }))).toBeTruthy();
    expect(screen.getByText('9 月库存日报').closest('a')?.getAttribute('href')).toBe(
      'https://alidocs.dingtalk.com/i/nodes/vNG4abc',
    );
    expect(screen.getByText(new RegExp(`^${zh('render.kind.sheet')} · 2026-09-`))).toBeTruthy();
    expect(screen.getByText('xlsx')).toBeTruthy();
    expect(screen.getByText(zh('render.untitled'))).toBeTruthy();
    // A link that is not a web address is dropped, the row stays.
    expect(screen.getByText('坏链接').closest('a')).toBeNull();
    expect(screen.getByText(zhPersonal('render.hasMore'))).toBeTruthy();
    // Ids stay React keys.
    expect(container.textContent).not.toContain('mweZ');
  });

  it('shows the empty search', () => {
    render(<ResultRender {...props('searchDocs', { hasMore: false, items: [], kind: 'docs' })} />);

    expect(screen.getByText(zh('render.docs.empty'))).toBeTruthy();
  });

  it('shows a document with its length, a collapsed preview and the DingTalk link', () => {
    render(
      <ResultRender
        {...props('readDoc', {
          kind: 'doc',
          length: 8310,
          nodeId: '14lg',
          preview: '# 销售周报\n本周完成……',
          title: '销售周报',
          url: 'https://alidocs.dingtalk.com/i/nodes/14lg',
        })}
      />,
    );

    expect(screen.getByText('销售周报')).toBeTruthy();
    expect(screen.getByText(zh('render.doc.length', { count: 8310 }))).toBeTruthy();
    expect(screen.queryByText(/本周完成/)).toBeNull();

    fireEvent.click(screen.getByText(zhPersonal('render.file.showPreview')));
    expect(screen.getByText(/本周完成/)).toBeTruthy();
    // The card keeps only the opening of a long document, and says so.
    expect(
      screen.getByText(zh('render.doc.previewClipped', { count: '# 销售周报\n本周完成……'.length })),
    ).toBeTruthy();
    expect(
      screen.getByText(zhPersonal('render.openInDingtalk')).closest('a')?.getAttribute('href'),
    ).toBe('https://alidocs.dingtalk.com/i/nodes/14lg');
  });

  it('says when a document is empty', () => {
    render(
      <ResultRender
        {...props('readDoc', { kind: 'doc', length: 0, nodeId: 'n', preview: '', title: '' })}
      />,
    );

    expect(screen.getByText(zh('render.untitled'))).toBeTruthy();
    expect(screen.getByText(zh('render.doc.empty'))).toBeTruthy();
    expect(screen.queryByText(zhPersonal('render.openInDingtalk'))).toBeNull();
  });

  it('lists knowledge bases with their description', () => {
    render(
      <ResultRender
        {...props('listWikiSpaces', {
          kind: 'wikiSpaces',
          spaces: [
            {
              description: '制度与流程',
              name: '行政知识库',
              url: 'https://alidocs.dingtalk.com/i/spaces/e3Rm',
              workspaceId: 'e3Rm',
            },
          ],
        })}
      />,
    );

    expect(screen.getByText(zh('apiName.listWikiSpaces'))).toBeTruthy();
    expect(screen.getByText('行政知识库').closest('a')).toBeTruthy();
    expect(screen.getByText('制度与流程')).toBeTruthy();
  });

  it('lists knowledge-base nodes by kind and marks the ones holding more', () => {
    render(
      <ResultRender
        {...props('listWikiNodes', {
          hasMore: true,
          kind: 'wikiNodes',
          nextCursor: 'pos:-1.2713976E7',
          nodes: [
            { extension: 'axls', hasChildren: false, name: '库存表', nodeId: 'n1', type: 'file' },
            { hasChildren: true, name: '制度', nodeId: 'n2', type: 'folder' },
          ],
          workspaceId: 'e3Rm',
        })}
      />,
    );

    expect(screen.getByText(zh('render.kind.sheet'))).toBeTruthy();
    expect(
      screen.getByText(`${zh('render.kind.folder')} · ${zh('render.wikiNodes.hasChildren')}`),
    ).toBeTruthy();
    expect(screen.getByText(zhPersonal('render.hasMore'))).toBeTruthy();
  });

  it('lists 钉盘 files: folders and online documents by kind, plain files by size', () => {
    render(
      <ResultRender
        {...props('searchDrive', {
          files: [
            { name: '合同', nodeId: 'f1', type: 'FOLDER' },
            { fileSize: 177_455, name: '销售周报', nodeId: 'f2', type: 'ALIDOC' },
            { fileSize: 13_218, name: '库存.xlsx', nodeId: 'f3', type: 'FILE' },
          ],
          hasMore: false,
          kind: 'driveFiles',
        })}
      />,
    );

    expect(screen.getByText(zh('render.kind.folder'))).toBeTruthy();
    expect(screen.getByText(zh('render.kind.online'))).toBeTruthy();
    expect(screen.getByText('12.9 KB')).toBeTruthy();
  });

  it('shows a downloaded 钉盘 file with the shared file card', () => {
    render(
      <ResultRender
        {...props('downloadDriveFile', {
          kind: 'file',
          name: '库存.xlsx',
          preview: '<sheet name="9月">| 品名 | 库存 |</sheet>',
          sizeBytes: 13_218,
        })}
      />,
    );

    expect(screen.getByText('库存.xlsx')).toBeTruthy();
    expect(screen.getByText('12.9 KB')).toBeTruthy();
    fireEvent.click(screen.getByText(zhPersonal('render.file.showPreview')));
    expect(screen.getByText(/品名/)).toBeTruthy();
  });
});

describe('ResultRender — 在线表格', () => {
  it('lists the worksheets with the range holding data', () => {
    render(
      <ResultRender
        {...props('listSheets', {
          kind: 'sheets',
          nodeId: 'n1',
          sheets: [
            { columnCount: 41, rowCount: 200, sheetId: 's1', title: '9月', usedRange: 'A1:AO14' },
            { sheetId: 's2', title: '汇总' },
          ],
        })}
      />,
    );

    expect(screen.getByText('9月')).toBeTruthy();
    expect(screen.getByText(zh('render.sheets.usedRange', { range: 'A1:AO14' }))).toBeTruthy();
    expect(screen.getByText('汇总')).toBeTruthy();
  });

  it('shows a range as a table with the first row as header', () => {
    const { container } = render(
      <ResultRender
        {...props('readSheet', {
          kind: 'sheetRange',
          nodeId: 'n1',
          range: 'A1:C3',
          rows: [
            ['品名', '库存', '单位'],
            ['螺丝', '1200', '个'],
            ['垫片', 35],
          ],
          truncated: false,
        })}
      />,
    );

    const headers = [...container.querySelectorAll('th')].map((cell) => cell.textContent);
    expect(headers).toEqual(['品名', '库存', '单位']);
    const rows = [...container.querySelectorAll('tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent),
    );
    // A short row is padded, a number reads as text.
    expect(rows).toEqual([
      ['螺丝', '1200', '个'],
      ['垫片', '35', ''],
    ]);
    expect(screen.getByText(`A1:C3 · ${zh('render.sheetRange.rows', { count: 2 })}`)).toBeTruthy();
    expect(screen.queryByText(zh('render.sheetRange.truncated'))).toBeNull();
  });

  it('opens a long range on demand and says when it was clipped', () => {
    const rows = [['序号'], ...Array.from({ length: 25 }, (_, index) => [`第 ${index + 1} 行`])];
    const state = { kind: 'sheetRange', nodeId: 'n1', range: 'A1:A26', rows, truncated: true };
    const { container } = render(<ResultRender {...props('readSheet', state)} />);

    expect(container.querySelectorAll('tbody tr')).toHaveLength(TABLE_VISIBLE_ROW_LIMIT);
    fireEvent.click(screen.getByText(zh('render.table.showAll', { count: 25 })));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(25);
    expect(screen.getByText(zh('render.sheetRange.truncated'))).toBeTruthy();
  });

  it('says when the range holds nothing', () => {
    const state = { kind: 'sheetRange', nodeId: 'n1', range: 'A1:B2', rows: [], truncated: false };
    render(<ResultRender {...props('readSheet', state)} />);

    expect(screen.getByText(zh('render.sheetRange.empty'))).toBeTruthy();
  });
});

describe('ResultRender — AI 表格', () => {
  it('lists AI tables and their data tables', () => {
    render(
      <ResultRender
        {...props('searchAitableBases', {
          bases: [{ baseId: 'YndM', baseName: '客户管理' }],
          kind: 'aitableBases',
        })}
      />,
    );
    expect(screen.getByText('客户管理')).toBeTruthy();
    cleanup();

    render(
      <ResultRender
        {...props('listAitableTables', {
          baseId: 'YndM',
          kind: 'aitableTables',
          tables: [
            { tableId: 'knht', tableName: '客户表' },
            { tableId: 'dv19', tableName: '跟进记录' },
          ],
        })}
      />,
    );
    expect(screen.getByText('跟进记录')).toBeTruthy();
    expect(screen.getByText(zhPersonal('render.count', { count: 2 }))).toBeTruthy();
  });

  it('shows the empty AI-table states', () => {
    render(<ResultRender {...props('searchAitableBases', { bases: [], kind: 'aitableBases' })} />);
    expect(screen.getByText(zh('render.aitableBases.empty'))).toBeTruthy();
    cleanup();

    render(
      <ResultRender
        {...props('listAitableTables', { baseId: 'b', kind: 'aitableTables', tables: [] })}
      />,
    );
    expect(screen.getByText(zh('render.aitableTables.empty'))).toBeTruthy();
  });

  it('lists the fields of a table with Chinese type names', () => {
    render(
      <ResultRender
        {...props('getAitableSchema', {
          baseId: 'b',
          fields: [
            { fieldId: 'fld1', name: '客户名称', type: 'text' },
            { fieldId: 'fld2', name: '金额', type: 'number' },
            { fieldId: 'fld3', name: '地址', type: 'geolocation' },
          ],
          kind: 'aitableSchema',
          tableId: 't',
          tableName: '客户表',
        })}
      />,
    );

    expect(screen.getByText('客户表')).toBeTruthy();
    expect(screen.getByText(zh('render.aitableSchema.fieldCount', { count: 3 }))).toBeTruthy();
    const tags = screen.getAllByTestId('tag').map((tag) => tag.textContent);
    expect(tags).toEqual([
      zh('render.fieldType.text'),
      zh('render.fieldType.number'),
      'geolocation',
    ]);
  });

  it('has Chinese copy for every named field type', () => {
    for (const type of AITABLE_FIELD_TYPES) expect(zh(`render.fieldType.${type}`)).toBeTruthy();
  });

  it('shows records as a table with one column per field name and 「共 N 条」', () => {
    const { container } = render(
      <ResultRender
        {...props('queryAitableRecords', {
          baseId: 'b',
          fields: [
            { fieldId: 'BGV86kr', name: '负责人' },
            { fieldId: 'buxAQKc', name: '客户名称' },
          ],
          hasMore: true,
          kind: 'aitableRecords',
          nextCursor: '9NCp',
          records: [
            { cells: { 客户名称: '示例公司', 负责人: '张三' }, recordId: '4vNp' },
            { cells: { 客户名称: '样例工厂' }, recordId: '8iZP' },
          ],
          tableId: 't',
        })}
      />,
    );

    const headers = [...container.querySelectorAll('th')].map((cell) => cell.textContent);
    expect(headers).toEqual(['负责人', '客户名称']);
    const rows = [...container.querySelectorAll('tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent),
    );
    expect(rows).toEqual([
      ['张三', '示例公司'],
      ['', '样例工厂'],
    ]);
    expect(screen.getByText(zh('render.aitableRecords.total', { count: 2 }))).toBeTruthy();
    expect(screen.getByText(zh('render.aitableRecords.hasMore'))).toBeTruthy();
    // Record and field ids stay out of the card.
    expect(container.textContent).not.toMatch(/4vNp|BGV86kr/);
  });

  it('builds the columns from the cells when the field list is missing', () => {
    const { container } = render(
      <ResultRender
        {...props('queryAitableRecords', {
          baseId: 'b',
          fields: [],
          hasMore: false,
          kind: 'aitableRecords',
          records: [
            { cells: { 名称: 'A' }, recordId: 'r1' },
            { cells: { 数量: '3', 名称: 'B' }, recordId: 'r2' },
            null,
          ],
          tableId: 't',
        })}
      />,
    );

    const headers = [...container.querySelectorAll('th')].map((cell) => cell.textContent);
    expect(headers).toEqual(['名称', '数量']);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('caps a long record list and opens the rest on demand', () => {
    const records = Array.from({ length: 30 }, (_, index) => ({
      cells: { 名称: `样品 ${index + 1}` },
      recordId: `r${index}`,
    }));
    const { container } = render(
      <ResultRender
        {...props('queryAitableRecords', {
          baseId: 'b',
          fields: [{ fieldId: 'f', name: '名称' }],
          hasMore: false,
          kind: 'aitableRecords',
          records,
          tableId: 't',
        })}
      />,
    );

    expect(container.querySelectorAll('tbody tr')).toHaveLength(TABLE_VISIBLE_ROW_LIMIT);
    expect(screen.getByText(zh('render.aitableRecords.total', { count: 30 }))).toBeTruthy();
    fireEvent.click(screen.getByText(zh('render.table.showAll', { count: 30 })));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(30);
  });

  it('shows the empty query', () => {
    render(
      <ResultRender
        {...props('queryAitableRecords', {
          baseId: 'b',
          fields: [{ fieldId: 'f', name: '名称' }],
          hasMore: false,
          kind: 'aitableRecords',
          records: [],
          tableId: 't',
        })}
      />,
    );

    expect(screen.getByText(zh('render.aitableRecords.empty'))).toBeTruthy();
  });
});

describe('ResultRender — writes', () => {
  it('confirms a finished write with the server summary and the link', () => {
    render(
      <ResultRender
        {...props('appendSheetRows', {
          action: 'appendSheetRows',
          count: 3,
          kind: 'write',
          summary: '已向「9月」追加 3 行',
          url: 'https://alidocs.dingtalk.com/i/nodes/n1',
        })}
      />,
    );

    expect(screen.getByText(zh('render.written.appendSheetRows'))).toBeTruthy();
    expect(screen.getByText('已向「9月」追加 3 行')).toBeTruthy();
    expect(
      screen.getByText(zhPersonal('render.openInDingtalk')).closest('a')?.getAttribute('href'),
    ).toBe('https://alidocs.dingtalk.com/i/nodes/n1');
  });

  it('has a done line for every write API', () => {
    for (const action of [
      'appendDoc',
      'createDoc',
      'appendSheetRows',
      'createAitableRecords',
      'updateAitableRecords',
    ]) {
      render(<ResultRender {...props(action, { action, kind: 'write', summary: '好了' })} />);
      expect(screen.getByText(zh(`render.written.${action}`))).toBeTruthy();
      cleanup();
    }
  });

  it('links the markdown link in a write summary', () => {
    render(
      <ResultRender
        {...props('createDoc', {
          action: 'createDoc',
          kind: 'write',
          summary: '已新建文档，[在钉钉中查看](https://alidocs.dingtalk.com/i/nodes/new1)',
        })}
      />,
    );

    const link = screen.getByText('在钉钉中查看').closest('a');
    expect(link?.getAttribute('href')).toBe('https://alidocs.dingtalk.com/i/nodes/new1');
    expect(link?.getAttribute('target')).toBe('_blank');
  });

  it('renders nothing for a write state without action or summary', () => {
    const state = { action: 'deleteDoc', kind: 'write', summary: ' ' };
    const { container } = render(<ResultRender {...props('createDoc', state)} />);

    expect(container.innerHTML).toBe('');
  });
});
