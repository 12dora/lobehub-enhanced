import { describe, expect, it } from 'vitest';

import { BrokerError } from './errors.ts';
import { OP_NAMES, opFeature, opNonIdempotent, opWrites, prepareExec } from './ops.ts';

const PROFILE = 'dingcorp0123456789:012345678901234567';
const DAY = 24 * 60 * 60 * 1000;

function prep(op: string, args: Record<string, unknown> = {}) {
  return prepareExec(op, PROFILE, args);
}

function argsOf(op: string, args: Record<string, unknown> = {}) {
  const prepared = prep(op, args);
  expect(prepared.argv.slice(0, 1)).toEqual([`--profile=${PROFILE}`]);
  expect(prepared.argv.slice(-2)).toEqual(['--format=json', '--timeout=30']);
  return prepared.argv.slice(1, -2);
}

describe('op allowlist', () => {
  it('covers every contract op and the write set', () => {
    expect([...OP_NAMES].sort()).toEqual(
      [
        'aitable.bases',
        'aitable.records.create',
        'aitable.records.query',
        'aitable.records.update',
        'aitable.schema',
        'aitable.tables',
        'chat.downloadFile',
        'chat.messages',
        'chat.myGroups',
        'chat.searchGroups',
        'chat.searchMessages',
        'contact.self',
        'doc.append',
        'doc.create',
        'doc.info',
        'doc.read',
        'doc.search',
        'drive.download',
        'drive.list',
        'drive.search',
        'report.get',
        'report.inbox',
        'report.outbox',
        'report.submit',
        'report.template',
        'report.templates',
        'sheet.append',
        'sheet.info',
        'sheet.list',
        'sheet.read',
        'todo.complete',
        'todo.get',
        'todo.list',
        'todo.update',
        'wiki.nodes',
        'wiki.spaces',
      ].sort(),
    );
    expect(
      [
        'todo.update',
        'todo.complete',
        'report.submit',
        'doc.append',
        'doc.create',
        'sheet.append',
        'aitable.records.create',
        'aitable.records.update',
      ].every((op) => opWrites(op)),
    ).toBe(true);
    expect(opWrites('todo.list')).toBe(false);
    expect(opWrites('doc.read')).toBe(false);
    expect(opNonIdempotent('aitable.records.create')).toBe(true);
    expect(opNonIdempotent('aitable.records.update')).toBe(false);
    expect(opFeature('doc.search')).toBe('docs');
    expect(opFeature('drive.download')).toBe('docs');
    expect(opFeature('sheet.read')).toBe('sheets');
    expect(opFeature('aitable.bases')).toBe('sheets');
  });

  it('builds todo argv with defaults', () => {
    expect(argsOf('todo.list')).toEqual([
      'todo',
      '+get-my-tasks',
      '--status=false',
      '--role-types=creator,executor,participant',
      '--page=1',
      '--size=20',
    ]);
    expect(argsOf('todo.list', { roleTypes: ['executor'], status: 'done' })).toEqual([
      'todo',
      '+get-my-tasks',
      '--status=true',
      '--role-types=executor',
      '--page=1',
      '--size=20',
    ]);
    expect(argsOf('todo.list', { status: 'all' })).not.toContain('--status=false');
    expect(argsOf('todo.get', { taskId: '57475254077' })).toEqual([
      'todo',
      '+get',
      '--task-id=57475254077',
    ]);
    expect(argsOf('todo.complete', { taskId: '57475254077' })).toEqual([
      'todo',
      '+complete',
      '--task-id=57475254077',
      '--yes',
    ]);
    expect(
      argsOf('todo.update', {
        due: '2026-09-24T00:00:00.000Z',
        priority: 20,
        taskId: '57475254077',
      }),
    ).toEqual([
      'todo',
      '+update',
      '--task-id=57475254077',
      '--due=2026-09-24T00:00:00.000Z',
      '--priority=20',
      '--yes',
    ]);
  });

  it('builds chat and report argv', () => {
    const start = '2026-09-17T00:00:00.000Z';
    const end = new Date(Date.parse(start) + 7 * DAY).toISOString();
    expect(
      argsOf('chat.messages', {
        conversationId: 'cidvO0I6uONXHnc51d6c8tnNA==',
        end,
        maxItems: 500,
        order: 'desc',
        start,
      }),
    ).toEqual([
      'chat',
      '+chat-messages',
      '--open-conversation-id=cidvO0I6uONXHnc51d6c8tnNA==',
      `--start=${start}`,
      `--end=${end}`,
      '--order=desc',
      '--page-all',
      '--page-limit=25',
      '--max-items=500',
    ]);
    const cursor = 'a'.repeat(300);
    expect(argsOf('chat.searchMessages', { cursor, query: '库存' })).toEqual([
      'chat',
      '+search-msg',
      '--query=库存',
      '--limit=20',
      `--cursor=${cursor}`,
    ]);
    expect(
      argsOf('chat.downloadFile', {
        resourceId: 'pGBa2Lm8aGX7ebA1szppBbEKVgN7R35y',
        resourceType: 'fileId',
      }),
    ).toEqual([
      'chat',
      '+messages-resource-download',
      '--type=fileId',
      '--resource-id=pGBa2Lm8aGX7ebA1szppBbEKVgN7R35y',
      '--output=./files/',
    ]);
    expect(
      prep('chat.downloadFile', { resourceId: 'abc', resourceType: 'mediaId' }).timeoutMs,
    ).toBe(100_000);
    const contents = [
      {
        content: '第一行\n第二行',
        contentType: 'markdown',
        key: '今日完成工作',
        sort: '0',
        type: '1',
      },
    ];
    const submitted = prep('report.submit', {
      contents,
      templateId: 'tpl1',
      toChat: true,
      toUserIds: ['0123', '4567'],
    });
    expect(
      argsOf('report.submit', {
        contents,
        templateId: 'tpl1',
        toChat: true,
        toUserIds: ['0123', '4567'],
      }),
    ).toEqual([
      'report',
      'entry',
      'submit',
      '--template-id=tpl1',
      '--contents=-',
      '--to-user-ids=0123,4567',
      '--to-chat',
      '--yes',
    ]);
    expect(submitted.stdin).toBe(JSON.stringify(contents));
    expect(argsOf('report.templates')).toEqual(['report', 'template', 'list']);
    expect(argsOf('report.template', { name: '日报' })).toEqual([
      'report',
      'template',
      'get',
      '--name=日报',
    ]);
    expect(argsOf('contact.self')).toEqual(['contact', 'user', 'get-self']);
  });

  it('rejects invalid args and unknown flags', () => {
    const start = '2026-09-01T00:00:00.000Z';
    const tooWide = new Date(Date.parse(start) + 7 * DAY + 1).toISOString();
    expect(() => prep('chat.messages', { conversationId: 'cid1', end: tooWide, start })).toThrow(
      BrokerError,
    );
    expect(() => prep('todo.get', { taskId: 'has space' })).toThrow(BrokerError);
    expect(() => prep('todo.get', { extra: true, taskId: 'abc' })).toThrow(/未知参数/);
    expect(() => prep('todo.update', { taskId: 'abc' })).toThrow(/至少修改一项/);
    expect(() => prep('chat.searchGroups', { query: 'a\nb' })).toThrow(BrokerError);
    expect(() => prep('chat.searchMessages', { cursor: 'a'.repeat(4097), query: 'x' })).toThrow(
      /游标/,
    );
    expect(() => prep('contact.self', { debug: true })).toThrow(BrokerError);
    expect(() => prepareExec('nope', PROFILE, {})).toThrow(BrokerError);
    expect(() => prepareExec('todo.list', 'not-a-profile', {})).toThrow(BrokerError);
    try {
      prep('todo.get', { taskId: 'x;rm' });
    } catch (error) {
      expect(error).toBeInstanceOf(BrokerError);
      expect((error as BrokerError).code).toBe('INVALID_ARGS');
      expect((error as BrokerError).message).not.toContain('rm');
    }
  });
});

const NODE = 'NkDw8v2oZBY0123456789012345678';
const CURSOR = 'pos:-1.2713976E7';
const CLIENT_TOKEN = '550e8400-e29b-41d4-a716-446655440000';

describe('docs and sheets ops', () => {
  it('builds read argv and keeps forbidden flags off the command', () => {
    expect(argsOf('doc.search', { query: '周报' })).toEqual([
      'doc',
      '+search',
      '--query=周报',
      '--limit=5',
    ]);
    expect(argsOf('doc.search', { limit: 10, query: '周报' })).toContain('--limit=10');
    expect(argsOf('doc.info', { nodeId: NODE })).toEqual(['doc', 'info', `--node=${NODE}`]);
    expect(opWrites('doc.info')).toBe(false);
    expect(() => prep('doc.info', { markdown: 'x', nodeId: NODE })).toThrow(/未知参数/);
    expect(argsOf('doc.read', { nodeId: NODE })).toEqual(['doc', 'read', `--node=${NODE}`]);
    expect(argsOf('wiki.spaces')).toEqual([
      'wiki',
      '+space-list',
      '--type=orgWikiSpace',
      '--limit=20',
    ]);
    expect(argsOf('wiki.spaces', { type: 'myWikiSpace' })).toContain('--type=myWikiSpace');
    expect(
      argsOf('wiki.nodes', { cursor: CURSOR, folderId: 'folder1', limit: 30, workspaceId: 'ws1' }),
    ).toEqual([
      'wiki',
      '+node-list',
      '--workspace=ws1',
      '--limit=30',
      '--folder=folder1',
      `--cursor=${CURSOR}`,
    ]);
    expect(argsOf('drive.search', { query: '库存' })).toEqual([
      'drive',
      '+search',
      '--query=库存',
      '--target=file',
      '--limit=5',
    ]);
    expect(argsOf('drive.list', { cursor: CURSOR, folderId: 'folder1' })).toEqual([
      'drive',
      '+list',
      '--limit=20',
      '--folder=folder1',
      `--cursor=${CURSOR}`,
    ]);
    const downloaded = prep('drive.download', { nodeId: NODE });
    expect(argsOf('drive.download', { nodeId: NODE })).toEqual([
      'drive',
      '+download',
      `--node=${NODE}`,
      '--output=./files/',
    ]);
    expect(downloaded.download).toBe(true);
    expect(downloaded.timeoutMs).toBe(100_000);
    expect(downloaded.write).toBe(false);
    expect(argsOf('sheet.list', { nodeId: NODE })).toEqual([
      'sheet',
      '+list-sheets',
      `--node=${NODE}`,
    ]);
    expect(argsOf('sheet.info', { nodeId: NODE, sheetId: 'st-1' })).toEqual([
      'sheet',
      'info',
      `--node=${NODE}`,
      '--sheet-id=st-1',
    ]);
    expect(argsOf('sheet.read', { nodeId: NODE, range: 'A1:AD200', sheetId: 'st-1' })).toEqual([
      'sheet',
      '+read',
      `--node=${NODE}`,
      '--range=A1:AD200',
      '--sheet-id=st-1',
      '--value-render-option=formatted_value',
    ]);
    expect(argsOf('aitable.bases')).toEqual(['aitable', 'base', 'list', '--limit=10']);
    expect(argsOf('aitable.bases', { query: '表格' })).toEqual([
      'aitable',
      'base',
      'search',
      '--query=表格',
    ]);
    expect(argsOf('aitable.tables', { baseId: NODE })).toEqual([
      'aitable',
      '+list-tables',
      `--base=${NODE}`,
    ]);
    expect(argsOf('aitable.schema', { baseId: NODE, tableId: 'knhttimp' })).toEqual([
      'aitable',
      'table',
      'get',
      `--base-id=${NODE}`,
      '--table-ids=knhttimp',
    ]);
    expect(
      argsOf('aitable.records.query', {
        baseId: NODE,
        cursor: CURSOR,
        query: '库存',
        tableId: 'tbl1',
      }),
    ).toEqual([
      'aitable',
      'record',
      'query',
      `--base-id=${NODE}`,
      '--table-id=tbl1',
      '--limit=20',
      '--query=库存',
      `--cursor=${CURSOR}`,
    ]);
    for (const op of [
      'doc.search',
      'wiki.nodes',
      'drive.list',
      'sheet.read',
      'aitable.records.query',
    ]) {
      const argv =
        op === 'doc.search'
          ? argsOf(op, { query: '周报' })
          : op === 'wiki.nodes'
            ? argsOf(op, { workspaceId: 'ws1' })
            : op === 'drive.list'
              ? argsOf(op)
              : op === 'sheet.read'
                ? argsOf(op, { nodeId: NODE, range: 'A1' })
                : argsOf(op, { baseId: NODE, tableId: 'tbl1' });
      expect(argv.join(' ')).not.toMatch(/--page-all|--all\b|--url-only|--filters|--sort/);
    }
  });

  it('serializes sheet and aitable writes from validated values', () => {
    const values = [
      ['张三', 50000],
      ['', -1.5],
    ];
    expect(argsOf('sheet.append', { nodeId: NODE, sheetId: 'st-1', values })).toEqual([
      'sheet',
      'append',
      `--node=${NODE}`,
      '--sheet-id=st-1',
      `--values=${JSON.stringify(values)}`,
      '--yes',
    ]);
    const records = [{ cells: { BGV86kr: '你好', buxAQKc: 1, flag: true } }];
    expect(
      argsOf('aitable.records.create', {
        baseId: NODE,
        clientToken: CLIENT_TOKEN,
        records,
        tableId: 'tbl1',
      }),
    ).toEqual([
      'aitable',
      'record',
      'create',
      `--base-id=${NODE}`,
      '--table-id=tbl1',
      `--records=${JSON.stringify(records)}`,
      `--client-token=${CLIENT_TOKEN}`,
    ]);
    const updates = [{ recordId: 'rec1', cells: { BGV86kr: '改' } }];
    expect(
      argsOf('aitable.records.update', { baseId: NODE, records: updates, tableId: 'tbl1' }),
    ).toEqual([
      'aitable',
      'record',
      'update',
      `--base-id=${NODE}`,
      '--table-id=tbl1',
      `--records=${JSON.stringify(updates)}`,
    ]);
    expect(prep('sheet.append', { nodeId: NODE, sheetId: 'st-1', values }).write).toBe(true);
    expect(
      prep('aitable.records.create', {
        baseId: NODE,
        clientToken: CLIENT_TOKEN,
        records,
        tableId: 'tbl1',
      }).timeoutMs,
    ).toBe(50_000);
  });

  it('builds doc writes', () => {
    const markdown = '# 标题\n正文';
    expect(argsOf('doc.append', { markdown, nodeId: NODE })).toEqual([
      'doc',
      '+doc-append',
      `--doc=${NODE}`,
      `--content=${markdown}`,
      '--yes',
    ]);
    expect(
      argsOf('doc.create', {
        folderId: 'folder1',
        markdown: '',
        title: '项目周报',
        workspaceId: 'ws1',
      }),
    ).toEqual([
      'doc',
      '+create',
      '--name=项目周报',
      '--content=',
      '--doc-format=markdown',
      '--folder=folder1',
      '--workspace=ws1',
      '--yes',
    ]);
  });

  it('rejects bad docs and sheets args', () => {
    expect(() => prep('doc.search', { query: '' })).toThrow(/搜索词/);
    expect(() => prep('doc.search', { limit: 11, query: '周报' })).toThrow(/条数/);
    expect(() => prep('doc.search', { pageAll: true, query: '周报' })).toThrow(/未知参数/);
    expect(() => prep('doc.read', { nodeId: 'https://alidocs.dingtalk.com/i/nodes/abc' })).toThrow(
      /文档/,
    );
    expect(() => prep('doc.append', { markdown: '', nodeId: NODE })).toThrow(/文档内容/);
    expect(() => prep('doc.append', { markdown: 'a'.repeat(20_001), nodeId: NODE })).toThrow(
      /文档内容/,
    );
    expect(() => prep('doc.append', { markdown: '@secret.md', nodeId: NODE })).toThrow(/文档内容/);
    expect(() => prep('doc.create', { markdown: '-', title: '标题' })).toThrow(/文档内容/);
    expect(() => prep('doc.create', { markdown: '正文', title: '标'.repeat(101) })).toThrow(/标题/);
    expect(() => prep('wiki.spaces', { type: 'personal' })).toThrow(/知识库类型/);
    expect(() => prep('wiki.nodes', { cursor: 'a'.repeat(4097), workspaceId: 'ws1' })).toThrow(
      /游标/,
    );
    expect(() => prep('drive.search', { limit: 0, query: '库存' })).toThrow(/条数/);
    expect(() => prep('drive.list', { spaceId: '1' })).toThrow(/未知参数/);
    expect(() => prep('drive.download', { nodeId: NODE, urlOnly: true })).toThrow(/未知参数/);
    expect(() => prep('sheet.read', { nodeId: NODE })).toThrow(/范围/);
    expect(() => prep('sheet.read', { nodeId: NODE, range: 'a1:b2' })).toThrow(/范围/);
    expect(() => prep('sheet.read', { nodeId: NODE, range: 'A1:AE1' })).toThrow(/范围/);
    expect(() => prep('sheet.read', { nodeId: NODE, range: 'A1:A201' })).toThrow(/范围/);
    expect(() => prep('sheet.read', { nodeId: NODE, range: 'A2:A1' })).toThrow(/范围/);
    expect(argsOf('sheet.read', { nodeId: NODE, range: 'B10:AE209' })).toContain(
      '--range=B10:AE209',
    );
    const wide = Array.from({ length: 31 }, () => 'x');
    expect(() => prep('sheet.append', { nodeId: NODE, sheetId: 'st-1', values: [wide] })).toThrow(
      /表格数据/,
    );
    expect(() =>
      prep('sheet.append', {
        nodeId: NODE,
        sheetId: 'st-1',
        values: Array.from({ length: 51 }, () => ['x']),
      }),
    ).toThrow(/表格数据/);
    expect(() =>
      prep('sheet.append', { nodeId: NODE, sheetId: 'st-1', values: [['=SUM(A1)']] }),
    ).toThrow(/单元格/);
    expect(() =>
      prep('sheet.append', { nodeId: NODE, sheetId: 'st-1', values: [[' =1+1']] }),
    ).toThrow(/单元格/);
    expect(() =>
      prep('sheet.append', { nodeId: NODE, sheetId: 'st-1', values: '[["张三"]]' }),
    ).toThrow(/表格数据/);
    expect(() =>
      prep('sheet.append', { nodeId: NODE, sheetId: 'st-1', values: [[{ text: '张三' }]] }),
    ).toThrow(/单元格/);
    expect(() =>
      prep('sheet.append', { nodeId: NODE, sheetId: 'st-1', values: [['a'.repeat(501)]] }),
    ).toThrow(/单元格/);
    expect(() => prep('aitable.bases', { query: '表' })).toThrow(/搜索词/);
    expect(() => prep('aitable.bases', { query: '表'.repeat(101) })).toThrow(/搜索词/);
    expect(() =>
      prep('aitable.records.query', { baseId: NODE, limit: 51, tableId: 'tbl1' }),
    ).toThrow(/条数/);
    expect(() =>
      prep('aitable.records.create', {
        baseId: NODE,
        records: [{ cells: { BGV86kr: 'x' }, recordId: 'rec1' }],
        tableId: 'tbl1',
      }),
    ).toThrow(/未知参数/);
    expect(() =>
      prep('aitable.records.create', {
        baseId: NODE,
        records: [{ cells: { BGV86kr: { name: '张三' } } }],
        tableId: 'tbl1',
      }),
    ).toThrow(/单元格/);
    expect(() =>
      prep('aitable.records.update', {
        baseId: NODE,
        records: [{ cells: { BGV86kr: 'x' } }],
        tableId: 'tbl1',
      }),
    ).toThrow(/记录/);
    expect(() =>
      prep('aitable.records.create', { baseId: NODE, records: [], tableId: 'tbl1' }),
    ).toThrow(/记录/);
    expect(() =>
      prep('aitable.records.create', {
        baseId: NODE,
        records: Array.from({ length: 21 }, () => ({ cells: { BGV86kr: true } })),
        tableId: 'tbl1',
      }),
    ).toThrow(/记录/);
    const tooManyFields = Object.fromEntries(
      Array.from({ length: 51 }, (_, index) => [`f${index}`, 'x']),
    );
    expect(() =>
      prep('aitable.records.create', {
        baseId: NODE,
        records: [{ cells: tooManyFields }],
        tableId: 'tbl1',
      }),
    ).toThrow(/记录/);
    expect(() =>
      prep('aitable.records.update', {
        baseId: NODE,
        records: [{ cells: { BGV86kr: 'a'.repeat(2001) }, recordId: 'rec1' }],
        tableId: 'tbl1',
      }),
    ).toThrow(/单元格/);
    expect(() =>
      prep('aitable.records.query', { all: true, baseId: NODE, tableId: 'tbl1' }),
    ).toThrow(/未知参数/);
    const one = [{ cells: { BGV86kr: 'x' } }];
    expect(() =>
      prep('aitable.records.create', { baseId: NODE, records: one, tableId: 'tbl1' }),
    ).toThrow(/幂等键/);
    expect(() =>
      prep('aitable.records.create', {
        baseId: NODE,
        clientToken: 'not-a-uuid',
        records: one,
        tableId: 'tbl1',
      }),
    ).toThrow(/幂等键/);
    expect(() =>
      prep('aitable.records.create', {
        baseId: NODE,
        clientToken: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        records: one,
        tableId: 'tbl1',
      }),
    ).toThrow(/幂等键/);
    expect(() =>
      prep('aitable.records.create', {
        baseId: NODE,
        clientToken: '550e8400-e29b-41d4-c716-446655440000',
        records: one,
        tableId: 'tbl1',
      }),
    ).toThrow(/幂等键/);
    expect(() =>
      prep('aitable.records.create', {
        baseId: NODE,
        clientToken: CLIENT_TOKEN.toUpperCase(),
        records: one,
        tableId: 'tbl1',
      }),
    ).not.toThrow();
  });
});
