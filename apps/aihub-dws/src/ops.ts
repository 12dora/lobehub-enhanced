import {
  AITABLE_BASE_LIST_LIMIT,
  AITABLE_BASE_QUERY_MAX,
  AITABLE_BASE_QUERY_MIN,
  AITABLE_CELL_MAX,
  AITABLE_FIELDS_MAX,
  AITABLE_RECORD_QUERY_DEFAULT,
  AITABLE_RECORD_QUERY_MAX,
  AITABLE_RECORD_QUERY_TEXT_MAX,
  AITABLE_RECORDS_MAX,
  CHILD_TIMEOUT_MS,
  CURSOR_MAX,
  DAY_MS,
  DOC_MARKDOWN_MAX,
  DOC_QUERY_MAX,
  DOC_SEARCH_LIMIT_DEFAULT,
  DOC_SEARCH_LIMIT_MAX,
  DOC_TITLE_MAX,
  DOWNLOAD_TIMEOUT_MS,
  DRIVE_LIST_LIMIT,
  DRIVE_SEARCH_LIMIT_DEFAULT,
  DRIVE_SEARCH_LIMIT_MAX,
  SHEET_APPEND_COLS_MAX,
  SHEET_APPEND_ROWS_MAX,
  SHEET_CELL_MAX,
  SHEET_READ_COLS_MAX,
  SHEET_READ_ROWS_MAX,
  WIKI_NODE_LIMIT_DEFAULT,
  WIKI_NODE_LIMIT_MAX,
  WIKI_SPACE_LIMIT,
} from './constants.ts';
import { BrokerError, InvalidArgsError } from './errors.ts';

type Dict = Record<string, unknown>;

export type OpFeature = 'todo' | 'chat' | 'report' | 'docs' | 'sheets' | null;

export interface PreparedExec {
  argv: string[];
  download: boolean;
  op: string;
  stdin?: string;
  timeoutMs: number;
  write: boolean;
}

interface OpDef {
  argv: (args: Dict) => string[];
  download?: boolean;
  feature: OpFeature;
  /** True when a retry could duplicate the write. Callers must not retry. */
  nonIdempotent?: boolean;
  stdin?: (args: Dict) => string;
  timeoutMs: number;
  validate: (args: Dict) => void;
  write: boolean;
}

const ID_RE = /^[\w+/=.:-]{1,256}$/;
const CURSOR_RE = new RegExp(`^[A-Za-z0-9_+/=.:-]{1,${CURSOR_MAX}}$`);
const PROFILE_PART = '[\\w+/=.-]{1,128}';
const PROFILE_RE = new RegExp(`^${PROFILE_PART}:${PROFILE_PART}$`);
// eslint-disable-next-line no-control-regex -- reject/strip control characters in untrusted input
const CONTROL = /[\u0000-\u001F\u007F]/;
// eslint-disable-next-line no-control-regex -- reject/strip control characters in untrusted input
const CONTENT_CONTROL = /[\u0000-\u0008\v\f\u000E-\u001F\u007F]/;

const ROLE_TYPES = ['creator', 'executor', 'participant'] as const;
const WINDOW_7 = 7 * DAY_MS;
const WINDOW_20 = 20 * DAY_MS;
const WINDOW_180 = 180 * DAY_MS;

export function isValidProfile(profile: string): boolean {
  return PROFILE_RE.test(profile);
}

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknown(args: Dict, keys: readonly string[]): void {
  for (const key of Object.keys(args)) {
    if (!keys.includes(key)) throw new InvalidArgsError('包含未知参数');
  }
}

function has(args: Dict, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(args, key) && args[key] !== undefined;
}

function assertId(label: string, value: unknown): string {
  // ID_RE allows "://", so raw http(s) URLs are rejected here as well.
  if (typeof value !== 'string' || !ID_RE.test(value) || value.includes('://')) {
    throw new InvalidArgsError(`${label}不合法`);
  }
  return value;
}

function assertText(label: string, value: unknown, max: number, min = 1): string {
  if (
    typeof value !== 'string' ||
    value.length < min ||
    value.length > max ||
    CONTROL.test(value)
  ) {
    throw new InvalidArgsError(`${label}不合法`);
  }
  return value;
}

/** Report field bodies travel on stdin, so newlines are kept and empty is allowed. */
function assertContent(value: unknown): string {
  if (typeof value !== 'string' || value.length > 5000 || CONTENT_CONTROL.test(value)) {
    throw new InvalidArgsError('日志内容不合法');
  }
  return value;
}

function assertIso(label: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64 || CONTROL.test(value)) {
    throw new InvalidArgsError(`${label}不合法`);
  }
  if (Number.isNaN(Date.parse(value))) throw new InvalidArgsError(`${label}不合法`);
  return value;
}

function assertInt(label: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new InvalidArgsError(`${label}不合法`);
  }
  return value;
}

function optInt(
  args: Dict,
  key: string,
  label: string,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!has(args, key)) return fallback;
  return assertInt(label, args[key], min, max);
}

function assertCursor(value: unknown): string {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  ) {
    return String(value);
  }
  if (typeof value !== 'string' || !CURSOR_RE.test(value)) throw new InvalidArgsError('游标不合法');
  return value;
}

function assertWindow(start: string, end: string, maxMs: number): void {
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (!(e > s) || e - s > maxMs) throw new InvalidArgsError('时间窗口超出限制');
}

function flag(name: string, value: string | number): string {
  return `--${name}=${value}`;
}

interface ContentItem {
  content: string;
  contentType: string;
  key: string;
  sort: string;
  type: string;
}

function parseContents(value: unknown): ContentItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new InvalidArgsError('日志内容不合法');
  }
  return value.map((item) => {
    if (!isDict(item)) throw new InvalidArgsError('日志内容不合法');
    rejectUnknown(item, ['content', 'contentType', 'key', 'sort', 'type']);
    return {
      content: assertContent(item.content),
      contentType: assertText('内容类型', item.contentType, 32),
      key: assertText('字段名', item.key, 200),
      sort: assertText('排序', item.sort, 32),
      type: assertText('字段类型', item.type, 32),
    };
  });
}

function parseUserIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new InvalidArgsError('接收人不合法');
  }
  return value.map((id) => assertId('接收人', id));
}

const WIKI_TYPES = ['orgWikiSpace', 'myWikiSpace'] as const;
const RANGE_RE = /^([A-Z]{1,3})([1-9]\d{0,4})(?::([A-Z]{1,3})([1-9]\d{0,4}))?$/;

type CellValue = string | number | boolean;

function optionalId(args: Dict, key: string, label: string): void {
  if (has(args, key)) assertId(label, args[key]);
}

/** Newlines stay. `@…` and `-` are dws file/stdin forms, not document text. */
function assertMarkdown(value: unknown, min: number): string {
  if (
    typeof value !== 'string' ||
    value.length < min ||
    value.length > DOC_MARKDOWN_MAX ||
    CONTENT_CONTROL.test(value) ||
    value === '-' ||
    value.startsWith('@')
  ) {
    throw new InvalidArgsError('文档内容不合法');
  }
  return value;
}

function colIndex(letters: string): number {
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index;
}

function assertRange(value: unknown): string {
  if (typeof value !== 'string') throw new InvalidArgsError('范围不合法');
  const match = RANGE_RE.exec(value);
  if (!match) throw new InvalidArgsError('范围不合法');
  const startCol = colIndex(match[1]);
  const startRow = Number(match[2]);
  const endCol = match[3] ? colIndex(match[3]) : startCol;
  const endRow = match[4] ? Number(match[4]) : startRow;
  if (endCol < startCol || endRow < startRow) throw new InvalidArgsError('范围不合法');
  if (endRow - startRow + 1 > SHEET_READ_ROWS_MAX || endCol - startCol + 1 > SHEET_READ_COLS_MAX) {
    throw new InvalidArgsError('范围不合法');
  }
  return value;
}

function assertSheetCell(value: unknown): string | number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new InvalidArgsError('单元格不合法');
    return value;
  }
  if (typeof value !== 'string' || value.length > SHEET_CELL_MAX || CONTENT_CONTROL.test(value)) {
    throw new InvalidArgsError('单元格不合法');
  }
  if (value.trimStart().startsWith('=')) throw new InvalidArgsError('单元格不合法');
  return value;
}

function parseSheetValues(value: unknown): Array<Array<string | number>> {
  if (!Array.isArray(value) || value.length < 1 || value.length > SHEET_APPEND_ROWS_MAX) {
    throw new InvalidArgsError('表格数据不合法');
  }
  return value.map((row) => {
    if (!Array.isArray(row) || row.length > SHEET_APPEND_COLS_MAX) {
      throw new InvalidArgsError('表格数据不合法');
    }
    return row.map((cell) => assertSheetCell(cell));
  });
}

function assertAitableCell(value: unknown): CellValue {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new InvalidArgsError('单元格不合法');
    return value;
  }
  if (typeof value !== 'string' || value.length > AITABLE_CELL_MAX || CONTENT_CONTROL.test(value)) {
    throw new InvalidArgsError('单元格不合法');
  }
  return value;
}

function parseCells(value: unknown): Record<string, CellValue> {
  if (!isDict(value)) throw new InvalidArgsError('记录不合法');
  const keys = Object.keys(value);
  if (keys.length < 1 || keys.length > AITABLE_FIELDS_MAX) throw new InvalidArgsError('记录不合法');
  const cells: Record<string, CellValue> = Object.create(null);
  for (const key of keys) {
    assertId('字段', key);
    cells[key] = assertAitableCell(value[key]);
  }
  return cells;
}

function parseCreateRecords(value: unknown): Array<{ cells: Record<string, CellValue> }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > AITABLE_RECORDS_MAX) {
    throw new InvalidArgsError('记录不合法');
  }
  return value.map((item) => {
    if (!isDict(item)) throw new InvalidArgsError('记录不合法');
    rejectUnknown(item, ['cells']);
    return { cells: parseCells(item.cells) };
  });
}

function parseUpdateRecords(
  value: unknown,
): Array<{ cells: Record<string, CellValue>; recordId: string }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > AITABLE_RECORDS_MAX) {
    throw new InvalidArgsError('记录不合法');
  }
  return value.map((item) => {
    if (!isDict(item)) throw new InvalidArgsError('记录不合法');
    rejectUnknown(item, ['cells', 'recordId']);
    return { recordId: assertId('记录', item.recordId), cells: parseCells(item.cells) };
  });
}

const OPS: Record<string, OpDef> = {
  'chat.downloadFile': {
    argv: (args) => {
      const parts = [
        'chat',
        '+messages-resource-download',
        flag('type', args.resourceType as string),
        flag('resource-id', args.resourceId as string),
      ];
      if (has(args, 'messageId')) parts.push(flag('message-id', args.messageId as string));
      if (has(args, 'conversationId'))
        parts.push(flag('open-conversation-id', args.conversationId as string));
      parts.push('--output=./files/');
      return parts;
    },
    download: true,
    feature: 'chat',
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['conversationId', 'messageId', 'resourceId', 'resourceType']);
      assertId('资源', args.resourceId);
      if (args.resourceType !== 'fileId' && args.resourceType !== 'mediaId') {
        throw new InvalidArgsError('资源类型不合法');
      }
      if (has(args, 'messageId')) assertId('消息', args.messageId);
      if (has(args, 'conversationId')) assertId('会话', args.conversationId);
    },
    write: false,
  },
  'chat.messages': {
    argv: (args) => [
      'chat',
      '+chat-messages',
      flag('open-conversation-id', args.conversationId as string),
      flag('start', args.start as string),
      flag('end', args.end as string),
      flag('order', (args.order as string | undefined) ?? 'asc'),
      '--page-all',
      '--page-limit=25',
      flag('max-items', optInt(args, 'maxItems', '条数', 1, 500, 200)),
    ],
    feature: 'chat',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['conversationId', 'end', 'maxItems', 'order', 'start']);
      assertId('会话', args.conversationId);
      const start = assertIso('开始时间', args.start);
      const end = assertIso('结束时间', args.end);
      assertWindow(start, end, WINDOW_7);
      if (has(args, 'maxItems')) assertInt('条数', args.maxItems, 1, 500);
      if (has(args, 'order') && args.order !== 'asc' && args.order !== 'desc') {
        throw new InvalidArgsError('排序不合法');
      }
    },
    write: false,
  },
  'chat.myGroups': {
    argv: (args) => {
      const parts = [
        'chat',
        '+my-groups',
        flag('limit', optInt(args, 'limit', '条数', 1, 200, 100)),
      ];
      if (has(args, 'cursor')) parts.push(flag('cursor', assertCursor(args.cursor)));
      return parts;
    },
    feature: 'chat',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['cursor', 'limit']);
      if (has(args, 'limit')) assertInt('条数', args.limit, 1, 200);
      if (has(args, 'cursor')) assertCursor(args.cursor);
    },
    write: false,
  },
  'chat.searchGroups': {
    argv: (args) => {
      const parts = [
        'chat',
        'search',
        flag('query', args.query as string),
        flag('limit', optInt(args, 'limit', '条数', 1, 50, 20)),
      ];
      if (has(args, 'cursor')) parts.push(flag('cursor', assertCursor(args.cursor)));
      return parts;
    },
    feature: 'chat',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['cursor', 'limit', 'query']);
      assertText('搜索词', args.query, 500);
      if (has(args, 'limit')) assertInt('条数', args.limit, 1, 50);
      if (has(args, 'cursor')) assertCursor(args.cursor);
    },
    write: false,
  },
  'chat.searchMessages': {
    argv: (args) => {
      const parts = ['chat', '+search-msg', flag('query', args.query as string)];
      if (has(args, 'conversationId')) parts.push(flag('groups', args.conversationId as string));
      if (has(args, 'start')) parts.push(flag('start', args.start as string));
      if (has(args, 'end')) parts.push(flag('end', args.end as string));
      parts.push(flag('limit', optInt(args, 'limit', '条数', 1, 50, 20)));
      if (has(args, 'cursor')) parts.push(flag('cursor', assertCursor(args.cursor)));
      return parts;
    },
    feature: 'chat',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['conversationId', 'cursor', 'end', 'limit', 'query', 'start']);
      assertText('搜索词', args.query, 500);
      if (has(args, 'conversationId')) assertId('会话', args.conversationId);
      const start = has(args, 'start') ? assertIso('开始时间', args.start) : undefined;
      const end = has(args, 'end') ? assertIso('结束时间', args.end) : undefined;
      if (start && end) assertWindow(start, end, WINDOW_7);
      if (has(args, 'limit')) assertInt('条数', args.limit, 1, 50);
      if (has(args, 'cursor')) assertCursor(args.cursor);
    },
    write: false,
  },
  'contact.self': {
    argv: () => ['contact', 'user', 'get-self'],
    feature: null,
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, []);
    },
    write: false,
  },
  'report.get': {
    argv: (args) => ['report', 'entry', 'get', flag('report-id', args.reportId as string)],
    feature: 'report',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['reportId']);
      assertId('日志', args.reportId);
    },
    write: false,
  },
  'report.inbox': {
    argv: (args) => [
      'report',
      '+inbox-list',
      flag('start', args.start as string),
      flag('end', args.end as string),
      flag('cursor', optInt(args, 'cursor', '游标', 0, Number.MAX_SAFE_INTEGER, 0)),
      flag('size', optInt(args, 'size', '条数', 1, 20, 20)),
    ],
    feature: 'report',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['cursor', 'end', 'size', 'start']);
      const start = assertIso('开始时间', args.start);
      const end = assertIso('结束时间', args.end);
      assertWindow(start, end, WINDOW_180);
      if (has(args, 'cursor')) assertInt('游标', args.cursor, 0, Number.MAX_SAFE_INTEGER);
      if (has(args, 'size')) assertInt('条数', args.size, 1, 20);
    },
    write: false,
  },
  'report.outbox': {
    argv: (args) => {
      const parts = ['report', '+outbox-list'];
      if (has(args, 'start')) parts.push(flag('start', args.start as string));
      if (has(args, 'end')) parts.push(flag('end', args.end as string));
      parts.push(
        flag('cursor', optInt(args, 'cursor', '游标', 0, Number.MAX_SAFE_INTEGER, 0)),
        flag('size', optInt(args, 'size', '条数', 1, 20, 20)),
      );
      return parts;
    },
    feature: 'report',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['cursor', 'end', 'size', 'start']);
      const start = has(args, 'start') ? assertIso('开始时间', args.start) : undefined;
      const end = has(args, 'end') ? assertIso('结束时间', args.end) : undefined;
      if (start && end) assertWindow(start, end, WINDOW_20);
      if (has(args, 'cursor')) assertInt('游标', args.cursor, 0, Number.MAX_SAFE_INTEGER);
      if (has(args, 'size')) assertInt('条数', args.size, 1, 20);
    },
    write: false,
  },
  'report.submit': {
    argv: (args) => {
      const ids = args.toUserIds as string[];
      const parts = [
        'report',
        'entry',
        'submit',
        flag('template-id', args.templateId as string),
        '--contents=-',
        flag('to-user-ids', ids.join(',')),
      ];
      if (args.toChat === true) parts.push('--to-chat');
      parts.push('--yes');
      return parts;
    },
    feature: 'report',
    stdin: (args) => JSON.stringify(parseContents(args.contents)),
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['contents', 'templateId', 'toChat', 'toUserIds']);
      assertId('模板', args.templateId);
      parseContents(args.contents);
      parseUserIds(args.toUserIds);
      if (has(args, 'toChat') && typeof args.toChat !== 'boolean')
        throw new InvalidArgsError('发送到群不合法');
    },
    write: true,
  },
  'report.template': {
    argv: (args) => ['report', 'template', 'get', flag('name', args.name as string)],
    feature: 'report',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['name']);
      assertText('模板名称', args.name, 500);
    },
    write: false,
  },
  'report.templates': {
    argv: () => ['report', 'template', 'list'],
    feature: 'report',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, []);
    },
    write: false,
  },
  'todo.complete': {
    argv: (args) => ['todo', '+complete', flag('task-id', args.taskId as string), '--yes'],
    feature: 'todo',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['taskId']);
      assertId('待办', args.taskId);
    },
    write: true,
  },
  'todo.get': {
    argv: (args) => ['todo', '+get', flag('task-id', args.taskId as string)],
    feature: 'todo',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['taskId']);
      assertId('待办', args.taskId);
    },
    write: false,
  },
  'todo.list': {
    argv: (args) => {
      const status = (args.status as string | undefined) ?? 'open';
      const roles = (args.roleTypes as string[] | undefined) ?? [...ROLE_TYPES];
      const parts = ['todo', '+get-my-tasks'];
      if (status === 'open') parts.push('--status=false');
      else if (status === 'done') parts.push('--status=true');
      parts.push(
        flag('role-types', roles.join(',')),
        flag('page', optInt(args, 'page', '页码', 1, 40, 1)),
        flag('size', optInt(args, 'size', '条数', 1, 20, 20)),
      );
      return parts;
    },
    feature: 'todo',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['page', 'roleTypes', 'size', 'status']);
      if (
        has(args, 'status') &&
        args.status !== 'open' &&
        args.status !== 'done' &&
        args.status !== 'all'
      ) {
        throw new InvalidArgsError('待办状态不合法');
      }
      if (has(args, 'page')) assertInt('页码', args.page, 1, 40);
      if (has(args, 'size')) assertInt('条数', args.size, 1, 20);
      if (has(args, 'roleTypes')) {
        if (!Array.isArray(args.roleTypes) || args.roleTypes.length === 0) {
          throw new InvalidArgsError('角色不合法');
        }
        const seen = new Set<string>();
        for (const role of args.roleTypes) {
          if (
            typeof role !== 'string' ||
            !ROLE_TYPES.includes(role as (typeof ROLE_TYPES)[number]) ||
            seen.has(role)
          ) {
            throw new InvalidArgsError('角色不合法');
          }
          seen.add(role);
        }
      }
    },
    write: false,
  },
  'todo.update': {
    argv: (args) => {
      const parts = ['todo', '+update', flag('task-id', args.taskId as string)];
      if (has(args, 'title')) parts.push(flag('title', args.title as string));
      if (has(args, 'due')) parts.push(flag('due', args.due as string));
      if (has(args, 'priority')) parts.push(flag('priority', args.priority as number));
      parts.push('--yes');
      return parts;
    },
    feature: 'todo',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['due', 'priority', 'taskId', 'title']);
      assertId('待办', args.taskId);
      const title = has(args, 'title');
      const due = has(args, 'due');
      const priority = has(args, 'priority');
      if (!title && !due && !priority) throw new InvalidArgsError('至少修改一项');
      if (title) assertText('标题', args.title, 500);
      if (due) assertIso('截止时间', args.due);
      if (
        priority &&
        args.priority !== 10 &&
        args.priority !== 20 &&
        args.priority !== 30 &&
        args.priority !== 40
      ) {
        throw new InvalidArgsError('优先级不合法');
      }
    },
    write: true,
  },
  'aitable.bases': {
    argv: (args) => {
      if (has(args, 'query')) {
        return ['aitable', 'base', 'search', flag('query', args.query as string)];
      }
      return ['aitable', 'base', 'list', `--limit=${AITABLE_BASE_LIST_LIMIT}`];
    },
    feature: 'sheets',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['query']);
      if (has(args, 'query')) {
        assertText('搜索词', args.query, AITABLE_BASE_QUERY_MAX, AITABLE_BASE_QUERY_MIN);
      }
    },
    write: false,
  },
  'aitable.records.create': {
    argv: (args) => [
      'aitable',
      '+record-batch-create',
      flag('base-id', args.baseId as string),
      flag('table-id', args.tableId as string),
      flag('records', JSON.stringify(parseCreateRecords(args.records))),
      '--yes',
    ],
    feature: 'sheets',
    nonIdempotent: true,
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['baseId', 'records', 'tableId']);
      assertId('多维表', args.baseId);
      assertId('数据表', args.tableId);
      parseCreateRecords(args.records);
    },
    write: true,
  },
  'aitable.records.query': {
    argv: (args) => {
      const parts = [
        'aitable',
        'record',
        'query',
        flag('base-id', args.baseId as string),
        flag('table-id', args.tableId as string),
        flag(
          'limit',
          optInt(args, 'limit', '条数', 1, AITABLE_RECORD_QUERY_MAX, AITABLE_RECORD_QUERY_DEFAULT),
        ),
      ];
      if (has(args, 'query')) parts.push(flag('query', args.query as string));
      if (has(args, 'cursor')) parts.push(flag('cursor', assertCursor(args.cursor)));
      return parts;
    },
    feature: 'sheets',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['baseId', 'cursor', 'limit', 'query', 'tableId']);
      assertId('多维表', args.baseId);
      assertId('数据表', args.tableId);
      if (has(args, 'limit')) assertInt('条数', args.limit, 1, AITABLE_RECORD_QUERY_MAX);
      if (has(args, 'query')) assertText('搜索词', args.query, AITABLE_RECORD_QUERY_TEXT_MAX);
      if (has(args, 'cursor')) assertCursor(args.cursor);
    },
    write: false,
  },
  'aitable.records.update': {
    argv: (args) => [
      'aitable',
      '+record-update',
      flag('base-id', args.baseId as string),
      flag('table-id', args.tableId as string),
      flag('records', JSON.stringify(parseUpdateRecords(args.records))),
      '--yes',
    ],
    feature: 'sheets',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['baseId', 'records', 'tableId']);
      assertId('多维表', args.baseId);
      assertId('数据表', args.tableId);
      parseUpdateRecords(args.records);
    },
    write: true,
  },
  'aitable.schema': {
    argv: (args) => [
      'aitable',
      'table',
      'get',
      flag('base-id', args.baseId as string),
      flag('table-ids', args.tableId as string),
    ],
    feature: 'sheets',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['baseId', 'tableId']);
      assertId('多维表', args.baseId);
      assertId('数据表', args.tableId);
    },
    write: false,
  },
  'aitable.tables': {
    argv: (args) => ['aitable', '+list-tables', flag('base', args.baseId as string)],
    feature: 'sheets',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['baseId']);
      assertId('多维表', args.baseId);
    },
    write: false,
  },
  'doc.append': {
    argv: (args) => [
      'doc',
      '+doc-append',
      flag('doc', args.nodeId as string),
      flag('content', args.markdown as string),
      '--yes',
    ],
    feature: 'docs',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['markdown', 'nodeId']);
      assertId('文档', args.nodeId);
      assertMarkdown(args.markdown, 1);
    },
    write: true,
  },
  'doc.create': {
    argv: (args) => {
      const parts = [
        'doc',
        '+create',
        flag('name', args.title as string),
        flag('content', args.markdown as string),
        '--doc-format=markdown',
      ];
      if (has(args, 'folderId')) parts.push(flag('folder', args.folderId as string));
      if (has(args, 'workspaceId')) parts.push(flag('workspace', args.workspaceId as string));
      parts.push('--yes');
      return parts;
    },
    feature: 'docs',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['folderId', 'markdown', 'title', 'workspaceId']);
      assertText('标题', args.title, DOC_TITLE_MAX);
      assertMarkdown(args.markdown, 0);
      optionalId(args, 'folderId', '文件夹');
      optionalId(args, 'workspaceId', '知识库');
    },
    write: true,
  },
  'doc.info': {
    argv: (args) => ['doc', 'info', flag('node', args.nodeId as string)],
    feature: 'docs',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['nodeId']);
      assertId('文档', args.nodeId);
    },
    write: false,
  },
  'doc.read': {
    argv: (args) => ['doc', 'read', flag('node', args.nodeId as string)],
    feature: 'docs',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['nodeId']);
      assertId('文档', args.nodeId);
    },
    write: false,
  },
  'doc.search': {
    argv: (args) => [
      'doc',
      '+search',
      flag('query', args.query as string),
      flag(
        'limit',
        optInt(args, 'limit', '条数', 1, DOC_SEARCH_LIMIT_MAX, DOC_SEARCH_LIMIT_DEFAULT),
      ),
    ],
    feature: 'docs',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['limit', 'query']);
      assertText('搜索词', args.query, DOC_QUERY_MAX);
      if (has(args, 'limit')) assertInt('条数', args.limit, 1, DOC_SEARCH_LIMIT_MAX);
    },
    write: false,
  },
  'drive.download': {
    argv: (args) => [
      'drive',
      '+download',
      flag('node', args.nodeId as string),
      '--output=./files/',
    ],
    download: true,
    feature: 'docs',
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['nodeId']);
      assertId('文件', args.nodeId);
    },
    write: false,
  },
  'drive.list': {
    argv: (args) => {
      const parts = ['drive', '+list', `--limit=${DRIVE_LIST_LIMIT}`];
      if (has(args, 'folderId')) parts.push(flag('folder', args.folderId as string));
      if (has(args, 'cursor')) parts.push(flag('cursor', assertCursor(args.cursor)));
      return parts;
    },
    feature: 'docs',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['cursor', 'folderId']);
      optionalId(args, 'folderId', '文件夹');
      if (has(args, 'cursor')) assertCursor(args.cursor);
    },
    write: false,
  },
  'drive.search': {
    argv: (args) => [
      'drive',
      '+search',
      flag('query', args.query as string),
      '--target=file',
      flag(
        'limit',
        optInt(args, 'limit', '条数', 1, DRIVE_SEARCH_LIMIT_MAX, DRIVE_SEARCH_LIMIT_DEFAULT),
      ),
    ],
    feature: 'docs',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['limit', 'query']);
      assertText('搜索词', args.query, DOC_QUERY_MAX);
      if (has(args, 'limit')) assertInt('条数', args.limit, 1, DRIVE_SEARCH_LIMIT_MAX);
    },
    write: false,
  },
  'sheet.append': {
    argv: (args) => [
      'sheet',
      'append',
      flag('node', args.nodeId as string),
      flag('sheet-id', args.sheetId as string),
      flag('values', JSON.stringify(parseSheetValues(args.values))),
      '--yes',
    ],
    feature: 'sheets',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['nodeId', 'sheetId', 'values']);
      assertId('表格', args.nodeId);
      assertId('工作表', args.sheetId);
      parseSheetValues(args.values);
    },
    write: true,
  },
  'sheet.info': {
    argv: (args) => {
      const parts = ['sheet', 'info', flag('node', args.nodeId as string)];
      if (has(args, 'sheetId')) parts.push(flag('sheet-id', args.sheetId as string));
      return parts;
    },
    feature: 'sheets',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['nodeId', 'sheetId']);
      assertId('表格', args.nodeId);
      optionalId(args, 'sheetId', '工作表');
    },
    write: false,
  },
  'sheet.list': {
    argv: (args) => ['sheet', '+list-sheets', flag('node', args.nodeId as string)],
    feature: 'sheets',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['nodeId']);
      assertId('表格', args.nodeId);
    },
    write: false,
  },
  'sheet.read': {
    argv: (args) => {
      const parts = [
        'sheet',
        '+read',
        flag('node', args.nodeId as string),
        flag('range', args.range as string),
      ];
      if (has(args, 'sheetId')) parts.push(flag('sheet-id', args.sheetId as string));
      parts.push('--value-render-option=formatted_value');
      return parts;
    },
    feature: 'sheets',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['nodeId', 'range', 'sheetId']);
      assertId('表格', args.nodeId);
      assertRange(args.range);
      optionalId(args, 'sheetId', '工作表');
    },
    write: false,
  },
  'wiki.nodes': {
    argv: (args) => {
      const parts = [
        'wiki',
        '+node-list',
        flag('workspace', args.workspaceId as string),
        flag(
          'limit',
          optInt(args, 'limit', '条数', 1, WIKI_NODE_LIMIT_MAX, WIKI_NODE_LIMIT_DEFAULT),
        ),
      ];
      if (has(args, 'folderId')) parts.push(flag('folder', args.folderId as string));
      if (has(args, 'cursor')) parts.push(flag('cursor', assertCursor(args.cursor)));
      return parts;
    },
    feature: 'docs',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['cursor', 'folderId', 'limit', 'workspaceId']);
      assertId('知识库', args.workspaceId);
      if (has(args, 'limit')) assertInt('条数', args.limit, 1, WIKI_NODE_LIMIT_MAX);
      optionalId(args, 'folderId', '文件夹');
      if (has(args, 'cursor')) assertCursor(args.cursor);
    },
    write: false,
  },
  'wiki.spaces': {
    argv: (args) => [
      'wiki',
      '+space-list',
      flag('type', (args.type as string | undefined) ?? 'orgWikiSpace'),
      `--limit=${WIKI_SPACE_LIMIT}`,
    ],
    feature: 'docs',
    timeoutMs: CHILD_TIMEOUT_MS,
    validate: (args) => {
      rejectUnknown(args, ['type']);
      if (has(args, 'type') && !WIKI_TYPES.includes(args.type as (typeof WIKI_TYPES)[number])) {
        throw new InvalidArgsError('知识库类型不合法');
      }
    },
    write: false,
  },
};

export const OP_NAMES = Object.keys(OPS);

export function opFeature(op: string): OpFeature | undefined {
  return OPS[op]?.feature;
}

export function opWrites(op: string): boolean {
  return OPS[op]?.write === true;
}

/** `aitable.records.create` is non-idempotent. The sidecar never retries; callers must not either. */
export function opNonIdempotent(op: string): boolean {
  return OPS[op]?.nonIdempotent === true;
}

export function prepareExec(op: unknown, profile: string, args: unknown): PreparedExec {
  if (!isValidProfile(profile)) throw new BrokerError(400, 'INVALID_PROFILE', '身份标识不合法');
  if (typeof op !== 'string') throw new BrokerError(400, 'UNKNOWN_OP', '未知操作');
  const spec = OPS[op];
  if (!spec) throw new BrokerError(400, 'UNKNOWN_OP', '未知操作');
  if (args === undefined) args = {};
  if (!isDict(args)) throw new BrokerError(400, 'INVALID_ARGS', '参数不合法');
  try {
    spec.validate(args);
  } catch (error) {
    if (error instanceof InvalidArgsError)
      throw new BrokerError(400, 'INVALID_ARGS', error.message);
    throw error;
  }
  return {
    argv: [`--profile=${profile}`, ...spec.argv(args), '--format=json', '--timeout=30'],
    download: spec.download === true,
    op,
    stdin: spec.stdin?.(args),
    timeoutMs: spec.timeoutMs,
    write: spec.write,
  };
}
