import { CHILD_TIMEOUT_MS, CURSOR_MAX, DAY_MS, DOWNLOAD_TIMEOUT_MS } from './constants.ts';
import { BrokerError, InvalidArgsError } from './errors.ts';

type Dict = Record<string, unknown>;

export type OpFeature = 'todo' | 'chat' | 'report' | null;

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
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new InvalidArgsError(`${label}不合法`);
  return value;
}

function assertText(label: string, value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
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
};

export const OP_NAMES = Object.keys(OPS);

export function opFeature(op: string): OpFeature | undefined {
  return OPS[op]?.feature;
}

export function opWrites(op: string): boolean {
  return OPS[op]?.write === true;
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
