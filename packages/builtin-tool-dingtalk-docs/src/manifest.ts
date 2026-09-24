import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { DingtalkDocsApiName, DingtalkDocsIdentifier, DingtalkDocsWikiScopes } from './types';

export { DingtalkDocsIdentifier } from './types';

/** Same as sidecar ID_RE. Rejects raw URLs. */
const ID_PATTERN = '^[\\w+/=.:-]{1,256}$';
/** Cursors such as `pos:-1.2713976E7` must pass. */
const CURSOR_PATTERN = '^[A-Za-z0-9_+/=.:-]{1,4096}$';
/** Any A1 cell (1–3 column letters). A span past 200×30 is clipped, not rejected. */
const A1_CELL = '[A-Z]{1,3}[1-9]\\d{0,4}';
const A1_RANGE_PATTERN = `^${A1_CELL}(?::${A1_CELL})?$`;
/** Empty or text that does not start with `=` (no formulas). */
const PLAIN_CELL_PATTERN = '^([^=].{0,499})?$';

const id = (description: string) => ({
  description,
  maxLength: 256,
  minLength: 1,
  pattern: ID_PATTERN,
  type: 'string' as const,
});

const cursor = (description: string) => ({
  description,
  maxLength: 4096,
  minLength: 1,
  pattern: CURSOR_PATTERN,
  type: 'string' as const,
});

const sheetCell = {
  anyOf: [
    {
      description: '文本，最多 500 字，不能以 = 开头。',
      maxLength: 500,
      pattern: PLAIN_CELL_PATTERN,
      type: 'string',
    },
    { description: '有限数字。', type: 'number' },
  ],
};

const aitableCell = {
  anyOf: [
    { description: '文本，最多 2000 字。', maxLength: 2000, type: 'string' },
    { description: '有限数字。', type: 'number' },
    { description: '布尔值。', type: 'boolean' },
  ],
};

const aitableCells = {
  additionalProperties: aitableCell,
  description: '字段值。键必须是 getAitableSchema 返回的 fieldId，不要用中文名。最多 50 个字段。',
  maxProperties: 50,
  minProperties: 1,
  propertyNames: {
    maxLength: 256,
    minLength: 1,
    pattern: ID_PATTERN,
  },
  type: 'object' as const,
};

const params = (properties: Record<string, unknown>, required: string[]) => ({
  additionalProperties: false as const,
  properties,
  required,
  type: 'object' as const,
});

export const DingtalkDocsManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        '按关键词搜索当前用户可见的钉钉文档。命中多条时先问用户是哪一份，不要猜测。query 1 到 200 字，limit 1 到 10，省略则为 5。',
      humanIntervention: 'never',
      name: DingtalkDocsApiName.searchDocs,
      parameters: params(
        {
          limit: {
            description: '返回条数，1 到 10。省略则为 5。',
            maximum: 10,
            minimum: 1,
            type: 'number',
          },
          query: {
            description: '搜索关键词，1 到 200 字。',
            maxLength: 200,
            minLength: 1,
            type: 'string',
          },
        },
        ['query'],
      ),
    },
    {
      description:
        '阅读一篇钉钉文档的正文。nodeId 来自 searchDocs、listWikiNodes 或 searchDrive，不要传 URL。',
      humanIntervention: 'never',
      name: DingtalkDocsApiName.readDoc,
      parameters: params(
        {
          nodeId: id('文档 nodeId，来自搜索或列表。不要传 URL。'),
        },
        ['nodeId'],
      ),
    },
    {
      description: '列出知识库。scope 为 org（组织，默认）或 my（我的）。',
      humanIntervention: 'never',
      name: DingtalkDocsApiName.listWikiSpaces,
      parameters: params(
        {
          scope: {
            description: 'org 组织知识库，my 我的知识库。省略视为 org。',
            enum: [...DingtalkDocsWikiScopes],
            type: 'string',
          },
        },
        [],
      ),
    },
    {
      description:
        '列出知识库下的节点。workspaceId 来自 listWikiSpaces。单页默认 20 条、最多 30 条。翻页传入 nextCursor（形如 pos:-1.2713976E7）。',
      humanIntervention: 'never',
      name: DingtalkDocsApiName.listWikiNodes,
      parameters: params(
        {
          cursor: cursor('上一页的 nextCursor。首页省略。'),
          folderId: id('可选。只列出该文件夹下的节点。'),
          workspaceId: id('知识库 workspaceId，来自 listWikiSpaces。'),
        },
        ['workspaceId'],
      ),
    },
    {
      description:
        '在钉盘中按文件名搜索。只搜文件，不搜知识库空间。query 1 到 200 字，limit 1 到 10，省略则为 5。',
      humanIntervention: 'never',
      name: DingtalkDocsApiName.searchDrive,
      parameters: params(
        {
          limit: {
            description: '返回条数，1 到 10。省略则为 5。',
            maximum: 10,
            minimum: 1,
            type: 'number',
          },
          query: {
            description: '文件名关键词，1 到 200 字。',
            maxLength: 200,
            minLength: 1,
            type: 'string',
          },
        },
        ['query'],
      ),
    },
    {
      description:
        '列出钉盘「我的文件」。可传 folderId 进入文件夹。单页 20 条，翻页用 nextCursor。',
      humanIntervention: 'never',
      name: DingtalkDocsApiName.listDrive,
      parameters: params(
        {
          cursor: cursor('上一页的 nextCursor。首页省略。'),
          folderId: id('可选。文件夹 nodeId。省略则列出「我的文件」根目录。'),
        },
        [],
      ),
    },
    {
      description:
        '下载钉盘里的普通文件再分析。在线表格（axls）和钉钉文档（alidoc）不能下载，请改用 readSheet 或 readDoc。',
      humanIntervention: 'never',
      name: DingtalkDocsApiName.downloadDriveFile,
      parameters: params(
        {
          nodeId: id('文件 nodeId，来自 searchDrive 或 listDrive。不要传 URL。'),
        },
        ['nodeId'],
      ),
    },
    {
      description:
        '列出在线表格（不是 AI 表格）的工作表，并附带每张表的已用区域。最多返回 10 张。nodeId 来自搜索或知识库。',
      humanIntervention: 'never',
      name: DingtalkDocsApiName.listSheets,
      parameters: params(
        {
          nodeId: id('在线表格 nodeId。'),
        },
        ['nodeId'],
      ),
    },
    {
      description:
        '读取在线表格的一个区域，渲染为表格。range 为任意 A1 记法。一次最多读取 200 行 × 30 列的跨度；更大的区域从左上角裁剪，结果会给出下一块的 range。省略 range 时对已用区域同样裁剪。AI 表格不要用本接口。',
      humanIntervention: 'never',
      name: DingtalkDocsApiName.readSheet,
      parameters: params(
        {
          nodeId: id('在线表格 nodeId。'),
          range: {
            description:
              '可选。任意 A1 区域，例如 A1:AO14 或 AE1:AH20。一次跨度最多 200 行 × 30 列，超出从左上角裁剪并告知下一块。省略则读取已用区域并同样裁剪。',
            pattern: A1_RANGE_PATTERN,
            type: 'string',
          },
          sheetId: id('可选。工作表 id，来自 listSheets。省略则用第一张表。'),
        },
        ['nodeId'],
      ),
    },
    {
      description:
        '搜索 AI 表格（多维表）应用。query 为 2 到 100 字；省略则列出最近的应用，最多 10 个。这不是在线表格。',
      humanIntervention: 'never',
      name: DingtalkDocsApiName.searchAitableBases,
      parameters: params(
        {
          query: {
            description: '应用名关键词，2 到 100 字。省略则列出最近的应用。',
            maxLength: 100,
            minLength: 2,
            type: 'string',
          },
        },
        [],
      ),
    },
    {
      description: '列出一个 AI 表格应用里的数据表。baseId 来自 searchAitableBases。',
      humanIntervention: 'never',
      name: DingtalkDocsApiName.listAitableTables,
      parameters: params(
        {
          baseId: id('AI 表格应用 baseId。'),
        },
        ['baseId'],
      ),
    },
    {
      description:
        '读取一张 AI 表格的字段结构。写入前必须先调用本接口，cells 的键用返回的 fieldId，不要用字段名。',
      humanIntervention: 'never',
      name: DingtalkDocsApiName.getAitableSchema,
      parameters: params(
        {
          baseId: id('AI 表格应用 baseId。'),
          tableId: id('数据表 tableId，来自 listAitableTables。一次只能查一张表。'),
        },
        ['baseId', 'tableId'],
      ),
    },
    {
      description:
        '查询 AI 表格记录。limit 1 到 50，省略则为 20。翻页用 nextCursor。记录里的单元格会转成字段名。',
      humanIntervention: 'never',
      name: DingtalkDocsApiName.queryAitableRecords,
      parameters: params(
        {
          baseId: id('AI 表格应用 baseId。'),
          cursor: cursor('上一页的 nextCursor。首页省略。'),
          limit: {
            description: '返回条数，1 到 50。省略则为 20。',
            maximum: 50,
            minimum: 1,
            type: 'number',
          },
          query: {
            description: '可选。全文关键词，1 到 200 字。',
            maxLength: 200,
            minLength: 1,
            type: 'string',
          },
          tableId: id('数据表 tableId。'),
        },
        ['baseId', 'tableId'],
      ),
    },
    {
      description:
        '把 Markdown 追加到已有文档末尾。一次写完本次请求的全部内容。单次 JSON 超过约 50 KB 时再拆成多次，每次不超过约 50 KB。会弹出确认卡片，不要在文字里再问一次。',
      humanIntervention: 'always',
      name: DingtalkDocsApiName.appendDoc,
      parameters: params(
        {
          markdown: {
            description: '要追加的 Markdown，1 到 20000 字。',
            maxLength: 20_000,
            minLength: 1,
            type: 'string',
          },
          nodeId: id('文档 nodeId。'),
        },
        ['nodeId', 'markdown'],
      ),
    },
    {
      description:
        '新建一篇钉钉文档。title 1 到 100 字，正文 Markdown 最多 20000 字。一次写完；单次超过约 50 KB 时再拆成多次，每次不超过约 50 KB。会弹出确认卡片，不要在文字里再问一次。',
      humanIntervention: 'always',
      name: DingtalkDocsApiName.createDoc,
      parameters: params(
        {
          folderId: id('可选。创建到该文件夹。省略则用默认位置。'),
          markdown: {
            description: '正文 Markdown，最多 20000 字，可以为空。',
            maxLength: 20_000,
            type: 'string',
          },
          title: {
            description: '文档标题，1 到 100 字。',
            maxLength: 100,
            minLength: 1,
            type: 'string',
          },
        },
        ['title', 'markdown'],
      ),
    },
    {
      description:
        '向在线表格追加行。一次调用带上全部行（1 到 50 行，每行最多 30 列），不要逐行或并行多次调用。单次 JSON 超过约 50 KB 时再拆成多次，每次不超过约 50 KB。单元格为最多 500 字的文本（不能以 = 开头）或数字。会弹出确认卡片，不要在文字里再问一次。',
      humanIntervention: 'always',
      name: DingtalkDocsApiName.appendSheetRows,
      parameters: params(
        {
          nodeId: id('在线表格 nodeId。'),
          rows: {
            description: '要追加的行。1 到 50 行，每行最多 30 列。',
            items: {
              description: '一行，最多 30 列。',
              items: sheetCell,
              maxItems: 30,
              type: 'array',
            },
            maxItems: 50,
            minItems: 1,
            type: 'array',
          },
          sheetId: id('工作表 id，来自 listSheets。'),
        },
        ['nodeId', 'sheetId', 'rows'],
      ),
    },
    {
      description:
        '向 AI 表格新增记录。一次调用带上全部记录（1 到 20 条），不要拆开。单次 JSON 超过约 50 KB 时再拆成多次，每次不超过约 50 KB。cells 的键必须是 fieldId。本操作不能重试。会弹出确认卡片，不要在文字里再问一次。',
      humanIntervention: 'always',
      name: DingtalkDocsApiName.createAitableRecords,
      parameters: params(
        {
          baseId: id('AI 表格应用 baseId。'),
          records: {
            description: '1 到 20 条新记录。每条只有 cells，不要带 recordId。失败不要原样重试。',
            items: {
              additionalProperties: false,
              properties: { cells: aitableCells },
              required: ['cells'],
              type: 'object',
            },
            maxItems: 20,
            minItems: 1,
            type: 'array',
          },
          tableId: id('数据表 tableId。'),
        },
        ['baseId', 'tableId', 'records'],
      ),
    },
    {
      description:
        '修改 AI 表格里已有的记录。一次调用带上全部记录（1 到 20 条）。单次 JSON 超过约 50 KB 时再拆成多次，每次不超过约 50 KB。每条含 recordId 和要改的 cells（键为 fieldId）。会弹出确认卡片，不要在文字里再问一次。',
      humanIntervention: 'always',
      name: DingtalkDocsApiName.updateAitableRecords,
      parameters: params(
        {
          baseId: id('AI 表格应用 baseId。'),
          records: {
            description: '1 到 20 条。每条必须有 recordId 和 cells。',
            items: {
              additionalProperties: false,
              properties: {
                cells: aitableCells,
                recordId: id('记录 recordId，来自 queryAitableRecords。'),
              },
              required: ['recordId', 'cells'],
              type: 'object',
            },
            maxItems: 20,
            minItems: 1,
            type: 'array',
          },
          tableId: id('数据表 tableId。'),
        },
        ['baseId', 'tableId', 'records'],
      ),
    },
  ],
  identifier: DingtalkDocsIdentifier,
  meta: {
    avatar: '📄',
    description: '搜索、阅读并写入当前用户的钉钉文档、知识库、钉盘、在线表格和 AI 表格',
    title: '钉钉文档与表格',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
