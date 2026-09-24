import type {
  AitableBasesState,
  AitableField,
  AitableRecordsState,
  AitableSchemaState,
  AitableTablesState,
  DocsState,
  DocState,
  DriveFilesState,
  SheetItem,
  SheetRangeState,
  SheetsState,
  WikiNodesState,
  WikiSpacesState,
} from '@lobechat/builtin-tool-dingtalk-docs';

import { columnName, parseA1 } from './range';

export const DOC_TEXT_LIMIT = 100_000;
export const DOC_PREVIEW_LIMIT = 2_000;
export const RECORDS_CONTENT_LIMIT = 30_000;
export const SHEET_INFO_LIMIT = 10;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** dws sometimes wraps the payload in `data`, sometimes returns it at the top. */
export const unwrapDws = (raw: unknown): Record<string, unknown> => {
  if (!isRecord(raw)) return {};
  if (isRecord(raw.data) && Object.keys(raw.data).length > 0) return raw.data;
  return raw;
};

const rowsOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const httpUrl = (value: unknown): string | undefined => {
  const url = text(value).trim();
  return url.startsWith('https://') || url.startsWith('http://') ? url : undefined;
};

const cursorOf = (data: Record<string, unknown>): string | undefined => {
  const cursor = text(data.nextCursor).trim();
  return cursor || undefined;
};

const hasMoreOf = (raw: unknown, data: Record<string, unknown>): boolean => {
  if (data.hasMore === true) return true;
  if (isRecord(raw) && raw.hasMore === true) return true;
  return Boolean(cursorOf(data) || (isRecord(raw) ? cursorOf(raw) : undefined));
};

export const projectDocs = (raw: unknown): DocsState => {
  const data = unwrapDws(raw);
  const items = rowsOf(data.documents).flatMap((row) => {
    if (!isRecord(row)) return [];
    const nodeId = text(row.nodeId).trim();
    if (!nodeId) return [];
    const modified = row.modifiedTime;
    const modifiedTime =
      typeof modified === 'string' || (typeof modified === 'number' && Number.isFinite(modified))
        ? modified
        : undefined;
    const url = httpUrl(row.url) ?? httpUrl(row.docUrl);
    return [
      {
        docType: text(row.docType),
        name: text(row.name),
        nodeId,
        ...(modifiedTime !== undefined ? { modifiedTime } : {}),
        ...(url ? { url } : {}),
      },
    ];
  });
  return { hasMore: hasMoreOf(raw, data), items, kind: 'docs' };
};

export const projectDoc = (raw: unknown, nodeId: string): { content: string; state: DocState } => {
  const data = unwrapDws(raw);
  const markdown = text(data.markdown);
  const title = text(data.title).trim() || '未命名文档';
  const url = httpUrl(data.url) ?? httpUrl(data.docUrl);
  const clipped = markdown.length > DOC_TEXT_LIMIT;
  const body = clipped ? markdown.slice(0, DOC_TEXT_LIMIT) : markdown;
  let content = markdown ? `文档「${title}」\n${body}` : `文档「${title}」没有正文。`;
  if (clipped) content += '\n（文档内容已截断，仅保留前 100000 字）';
  return {
    content,
    state: {
      kind: 'doc',
      length: markdown.length,
      nodeId,
      preview: markdown.slice(0, DOC_PREVIEW_LIMIT),
      title,
      ...(url ? { url } : {}),
    },
  };
};

export const projectWikiSpaces = (raw: unknown): WikiSpacesState => {
  const data = unwrapDws(raw);
  const spaces = rowsOf(data.spaces).flatMap((row) => {
    if (!isRecord(row)) return [];
    const workspaceId = text(row.workspaceId).trim();
    if (!workspaceId) return [];
    const description = text(row.description);
    const url = httpUrl(row.url);
    return [
      {
        name: text(row.name),
        workspaceId,
        ...(description ? { description } : {}),
        ...(url ? { url } : {}),
      },
    ];
  });
  return { kind: 'wikiSpaces', spaces };
};

export const projectWikiNodes = (raw: unknown, workspaceId: string): WikiNodesState => {
  const data = unwrapDws(raw);
  const nodes = rowsOf(data.nodes).flatMap((row) => {
    if (!isRecord(row)) return [];
    const nodeId = text(row.nodeId).trim();
    if (!nodeId) return [];
    const extension = text(row.extension);
    const url = httpUrl(row.url) ?? httpUrl(row.docUrl);
    return [
      {
        hasChildren: row.hasChildren === true,
        name: text(row.name),
        nodeId,
        type: text(row.type) || text(row.nodeType) || 'file',
        ...(extension ? { extension } : {}),
        ...(url ? { url } : {}),
      },
    ];
  });
  const cursor = cursorOf(data);
  return {
    hasMore: hasMoreOf(raw, data),
    kind: 'wikiNodes',
    nodes,
    workspaceId,
    ...(cursor ? { nextCursor: cursor } : {}),
  };
};

export const projectDriveFiles = (raw: unknown): DriveFilesState => {
  const data = unwrapDws(raw);
  const files = rowsOf(data.files).flatMap((row) => {
    if (!isRecord(row)) return [];
    const nodeId = text(row.nodeId).trim();
    if (!nodeId) return [];
    const fileSize = finite(row.fileSize);
    return [
      {
        name: text(row.name),
        nodeId,
        type: text(row.type),
        ...(fileSize !== undefined && fileSize >= 0 ? { fileSize } : {}),
      },
    ];
  });
  const cursor = cursorOf(data);
  return {
    files,
    hasMore: hasMoreOf(raw, data),
    kind: 'driveFiles',
    ...(cursor ? { nextCursor: cursor } : {}),
  };
};

export const readSheetSummaries = (raw: unknown): { sheetId: string; title: string }[] => {
  const data = unwrapDws(raw);
  return rowsOf(data.sheets).flatMap((row) => {
    if (!isRecord(row)) return [];
    const sheetId = text(row.sheetId).trim() || text(row.id).trim();
    if (!sheetId) return [];
    return [{ sheetId, title: text(row.title).trim() || text(row.name).trim() || sheetId }];
  });
};

export const readUsedRange = (raw: unknown): string | undefined => {
  const data = unwrapDws(raw);
  const nonEmpty = isRecord(data.nonEmptyRange) ? data.nonEmptyRange : undefined;
  const range = text(nonEmpty?.range).trim();
  return range && parseA1(range) ? range : undefined;
};

const readSheetItem = (
  summary: { sheetId: string; title: string },
  info: unknown | undefined,
): SheetItem => {
  if (!isRecord(unwrapDws(info ?? {})) || info === undefined) {
    return { sheetId: summary.sheetId, title: summary.title };
  }
  const data = unwrapDws(info);
  const usedRange = readUsedRange(info);
  const rowCount = finite(data.rowCount);
  const columnCount = finite(data.columnCount);
  const title = text(data.name).trim() || summary.title;
  return {
    sheetId: summary.sheetId,
    title,
    ...(columnCount !== undefined ? { columnCount } : {}),
    ...(rowCount !== undefined ? { rowCount } : {}),
    ...(usedRange ? { usedRange } : {}),
  };
};

export const projectSheets = (
  nodeId: string,
  listed: { sheetId: string; title: string }[],
  infos: ReadonlyMap<string, unknown>,
): SheetsState => ({
  kind: 'sheets',
  nodeId,
  sheets: listed.map((sheet) => readSheetItem(sheet, infos.get(sheet.sheetId))),
});

const cellText = (cell: unknown): string => {
  if (typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean') {
    return String(cell);
  }
  if (!isRecord(cell)) return '';
  if ('value' in cell) return cellText(cell.value);
  if (typeof cell.text === 'string') return cell.text;
  if (typeof cell.name === 'string') return cell.name;
  return '';
};

export const sheetGrid = (raw: unknown): string[][] => {
  const cells = unwrapDws(raw).cells;
  if (!Array.isArray(cells)) return [];
  return cells.map((row) => (Array.isArray(row) ? row.map((cell) => cellText(cell)) : []));
};

/** Drop trailing rows and columns whose cells are empty or whitespace. */
export const trimSheetGrid = (rows: string[][]): string[][] => {
  const grid = rows.map((row) => [...row]);
  while (grid.length > 0 && grid.at(-1)?.every((cell) => cell.trim() === '')) grid.pop();
  let width = grid.reduce((max, row) => Math.max(max, row.length), 0);
  const columnEmpty = (index: number) => grid.every((row) => (row[index] ?? '').trim() === '');
  while (width > 0 && columnEmpty(width - 1)) width -= 1;
  return grid.map((row) => row.slice(0, width));
};

const escapeCell = (value: string): string =>
  value.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ');

export const renderSheetMarkdown = (rows: string[][], range: string): string => {
  if (rows.every((row) => row.length === 0)) return '该区域没有数据。';
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const startCol = parseA1(range)?.startCol ?? 1;
  const headers = Array.from({ length: width }, (_, index) => columnName(startCol + index));
  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, index) => escapeCell(cells[index] ?? '')).join(' | ')} |`;
  return [
    line(headers),
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => line(row)),
  ].join('\n');
};

const sheetTruncated = (raw: unknown): boolean => {
  const data = unwrapDws(raw);
  if (data.complete === false || data.hasMore === true) return true;
  return Array.isArray(data.truncationReasons) && data.truncationReasons.length > 0;
};

export const projectSheetRange = (
  raw: unknown,
  input: { nodeId: string; range: string; sheetId?: string },
): { markdown: string; state: SheetRangeState } => {
  const rows = trimSheetGrid(sheetGrid(raw));
  const state: SheetRangeState = {
    kind: 'sheetRange',
    nodeId: input.nodeId,
    range: input.range,
    rows,
    truncated: sheetTruncated(raw),
    ...(input.sheetId ? { sheetId: input.sheetId } : {}),
  };
  const markdown = renderSheetMarkdown(rows, input.range);
  const note = state.truncated ? '表格结果不完整，请缩小 range 后重试。' : '';
  return { markdown: note ? `${note}\n${markdown}` : markdown, state };
};

export const projectAitableBases = (raw: unknown): AitableBasesState => {
  const data = unwrapDws(raw);
  const bases = rowsOf(data.bases).flatMap((row) => {
    if (!isRecord(row)) return [];
    const baseId = text(row.baseId).trim();
    if (!baseId) return [];
    return [{ baseId, baseName: text(row.baseName) || text(row.name) }];
  });
  return { bases, kind: 'aitableBases' };
};

export const projectAitableTables = (raw: unknown, baseId: string): AitableTablesState => {
  const data = unwrapDws(raw);
  const tables = rowsOf(data.tables).flatMap((row) => {
    if (!isRecord(row)) return [];
    const tableId = text(row.tableId).trim();
    if (!tableId) return [];
    return [{ tableId, tableName: text(row.tableName) || text(row.name) }];
  });
  return { baseId, kind: 'aitableTables', tables };
};

export const projectAitableSchema = (
  raw: unknown,
  input: { baseId: string; tableId: string },
): AitableSchemaState => {
  const data = unwrapDws(raw);
  const tables = rowsOf(data.tables).filter(isRecord);
  const table = tables.find((row) => text(row.tableId).trim() === input.tableId) ?? tables[0] ?? {};
  const fields: AitableField[] = rowsOf(table.fields).flatMap((row) => {
    if (!isRecord(row)) return [];
    const fieldId = text(row.fieldId).trim();
    if (!fieldId) return [];
    return [
      {
        fieldId,
        name: text(row.name).trim() || text(row.fieldName).trim() || fieldId,
        type: text(row.type),
      },
    ];
  });
  return {
    baseId: input.baseId,
    fields,
    kind: 'aitableSchema',
    tableId: input.tableId,
    tableName: text(table.tableName).trim() || text(table.name).trim(),
  };
};

/** Object cells use `name` then `text`. Arrays join with 「、」. Booleans read 是 / 否. */
export const aitableCellText = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) {
    return value
      .map((item) => aitableCellText(item))
      .filter((item) => item !== '')
      .join('、');
  }
  if (!isRecord(value)) return '';
  if (typeof value.name === 'string' && value.name.trim()) return value.name;
  if (typeof value.text === 'string') return value.text;
  return '';
};

export const projectAitableRecords = (
  raw: unknown,
  schema: AitableSchemaState,
): { state: AitableRecordsState; unknownFieldIds: string[] } => {
  const data = unwrapDws(raw);
  const names = new Map(schema.fields.map((field) => [field.fieldId, field.name]));
  const unknown = new Set<string>();
  const records = rowsOf(data.records).flatMap((row) => {
    if (!isRecord(row)) return [];
    const recordId = text(row.recordId).trim();
    if (!recordId) return [];
    const cells: Record<string, string> = {};
    const source = isRecord(row.cells) ? row.cells : {};
    for (const [fieldId, value] of Object.entries(source)) {
      const name = names.get(fieldId);
      if (!name) unknown.add(fieldId);
      cells[name ?? fieldId] = aitableCellText(value);
    }
    return [{ cells, recordId }];
  });
  const cursor = cursorOf(data);
  return {
    state: {
      baseId: schema.baseId,
      fields: schema.fields.map((field) => ({ fieldId: field.fieldId, name: field.name })),
      hasMore: hasMoreOf(raw, data),
      kind: 'aitableRecords',
      records,
      tableId: schema.tableId,
      ...(cursor ? { nextCursor: cursor } : {}),
    },
    unknownFieldIds: [...unknown],
  };
};

export const renderRecordsContent = (
  state: AitableRecordsState,
  unknownFieldIds: string[] = [],
): string => {
  const lines = [
    `共 ${state.records.length} 条记录。单元格已按字段名显示；写入时请使用 getAitableSchema 返回的 fieldId。`,
  ];
  if (state.hasMore) lines.push('还有更多记录，用 nextCursor 继续查询。');
  if (unknownFieldIds.length > 0) {
    lines.push(`有字段未在表结构中，已保留字段 ID：${unknownFieldIds.join('、')}`);
  }
  for (const record of state.records) {
    lines.push(`记录 ${record.recordId}`);
    for (const [name, value] of Object.entries(record.cells)) lines.push(`${name}：${value}`);
  }
  let content = lines.join('\n');
  if (content.length > RECORDS_CONTENT_LIMIT) {
    content = `${content.slice(0, RECORDS_CONTENT_LIMIT)}\n（记录内容已截断）`;
  }
  return content;
};

const ID_RE = /^[\w+/=.:-]{1,256}$/;
const ALIDOCS_NODE_URL = 'https://alidocs.dingtalk.com/i/nodes/';

/** Same check as the sidecar `assertId`: ID_RE, and a raw URL (`://`) is not an id. */
const passesIdCheck = (value: string): boolean => ID_RE.test(value) && !value.includes('://');

/**
 * How many rows `aitable record create` actually inserted.
 * Missing `newRecordIds` means the caller should keep its own count.
 */
export const readCreatedCount = (raw: unknown): number | undefined => {
  const ids = unwrapDws(raw).newRecordIds;
  if (!Array.isArray(ids)) return undefined;
  return ids.filter((id) => typeof id === 'string' && id.trim() !== '').length;
};

/**
 * Link for a write result. Prefers an http(s) URL on the payload, including
 * `data.result.docUrl` from `doc +create`, then `https://alidocs.dingtalk.com/i/nodes/<id>`
 * for a node id or AI-table base id that passes the id check.
 */
export const readResultUrl = (raw: unknown, fallbackId?: string): string | undefined => {
  const data = unwrapDws(raw);
  const nested = isRecord(data.result) ? data.result : undefined;
  const direct =
    httpUrl(data.url) ??
    httpUrl(data.docUrl) ??
    (nested ? (httpUrl(nested.docUrl) ?? httpUrl(nested.url)) : undefined) ??
    (isRecord(raw) ? httpUrl(raw.url) : undefined);
  if (direct) return direct;

  const rawRecord = isRecord(raw) ? raw : undefined;
  const rawNested = rawRecord && isRecord(rawRecord.result) ? rawRecord.result : undefined;
  const candidates = [
    text(data.nodeId),
    text(data.baseId),
    nested ? text(nested.nodeId) : '',
    nested ? text(nested.baseId) : '',
    rawRecord ? text(rawRecord.nodeId) : '',
    rawRecord ? text(rawRecord.baseId) : '',
    rawNested ? text(rawNested.nodeId) : '',
    rawNested ? text(rawNested.baseId) : '',
    fallbackId ?? '',
  ];
  for (const candidate of candidates) {
    const id = candidate.trim();
    if (passesIdCheck(id)) return `${ALIDOCS_NODE_URL}${id}`;
  }
  return undefined;
};

/** Title from `doc.info` or `doc.read`. `doc info` may only carry `name`. */
export const readDocTitle = (raw: unknown): string => {
  const data = unwrapDws(raw);
  return text(data.title).trim() || text(data.name).trim();
};
