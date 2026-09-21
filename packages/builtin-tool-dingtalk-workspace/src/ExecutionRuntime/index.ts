import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  AmbiguousCandidate,
  CompleteTodoParams,
  CreateEventParams,
  CreateTodoParams,
  DeleteEventParams,
  DeleteTodoParams,
  DirectoryDepartmentHit,
  DirectoryUserHit,
  GetEventParams,
  ListEventsParams,
  ListTodosParams,
  MeetingRoomIssue,
  QueryFreeBusyParams,
  RespondEventParams,
  SearchDirectoryParams,
  SearchDirectoryState,
  UpdateEventParams,
  UpdateTodoParams,
} from '../types';

export interface IDingtalkWorkspaceService {
  completeTodo: (args: CompleteTodoParams) => Promise<unknown>;
  createEvent: (args: CreateEventParams) => Promise<unknown>;
  createTodo: (args: CreateTodoParams) => Promise<unknown>;
  deleteEvent: (args: DeleteEventParams) => Promise<unknown>;
  deleteTodo: (args: DeleteTodoParams) => Promise<unknown>;
  getEvent: (args: GetEventParams) => Promise<unknown>;
  listEvents: (args: ListEventsParams) => Promise<unknown>;
  listMeetingRooms: () => Promise<unknown>;
  listTodos: (args: ListTodosParams) => Promise<unknown>;
  queryFreeBusy: (args: QueryFreeBusyParams) => Promise<unknown>;
  respondEvent: (args: RespondEventParams) => Promise<unknown>;
  searchDirectory: (
    q: string,
    kind?: 'department' | 'user',
  ) => Promise<{
    ambiguous?: boolean;
    departments: DirectoryDepartmentHit[];
    serverNow: string;
    users: DirectoryUserHit[];
  }>;
  updateEvent: (args: UpdateEventParams) => Promise<unknown>;
  updateTodo: (args: UpdateTodoParams) => Promise<unknown>;
}

interface DingtalkToolFailure {
  candidates?: AmbiguousCandidate[];
  code: string;
  message: string;
}

/** LLM-visible copy for unexpected failures. Never include raw error text. */
export const DINGTALK_WORKSPACE_INTERNAL_TOOL_CONTENT =
  '操作失败（内部错误），请稍后重试。不要向用户展示技术细节。';

export const DINGTALK_WORKSPACE_CONTENT_LIMIT = 12_000;
const MAX_PAYLOAD_LIST = 100;

const KNOWN_DINGTALK_ERROR_CODES = new Set([
  'DINGTALK_AMBIGUOUS',
  'DINGTALK_AUTOMATION_OFF',
  'DINGTALK_FEATURE_DISABLED',
  'DINGTALK_FORBIDDEN',
  'DINGTALK_IDENTITY_INACTIVE',
  'DINGTALK_IDENTITY_UNBOUND',
  'DINGTALK_IDENTITY_UNVERIFIED',
  'DINGTALK_INVALID',
  'DINGTALK_NOT_APPROVAL_ADMIN',
  'DINGTALK_NOT_CONFIGURED',
  'DINGTALK_NOT_FOUND',
  'DINGTALK_NOT_ORIGINATOR',
  'DINGTALK_NOT_TASK_OWNER',
  'DINGTALK_PREMIUM_REQUIRED',
  'DINGTALK_RATE_LIMITED',
  'DINGTALK_ROOM_UNAVAILABLE',
  'DINGTALK_RULE_LIMIT',
  'DINGTALK_UNAVAILABLE',
]);

const compactJson = (value: unknown): string => JSON.stringify(value);

/** Asia/Shanghai ISO-like clock. `hourCycle: 'h23'` so midnight is 00, not 24. */
export const formatServerNow = (now: Date = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+08:00`;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  return value as Record<string, unknown>;
};

const nestedErrorRecords = (error: unknown): Record<string, unknown>[] => {
  const seen = new Set<Record<string, unknown>>();
  const out: Record<string, unknown>[] = [];
  const walk = (value: unknown, depth: number) => {
    if (depth > 6) return;
    const record = asRecord(value);
    if (!record || seen.has(record)) return;
    seen.add(record);
    out.push(record);
    walk(record.data, depth + 1);
    walk(record.errorData, depth + 1);
    walk(record.cause, depth + 1);
    walk(record.body, depth + 1);
  };
  walk(error, 0);
  return out;
};

const extractErrorCode = (error: unknown): string | undefined => {
  for (const record of nestedErrorRecords(error)) {
    if (typeof record.code === 'string' && record.code.startsWith('DINGTALK_')) return record.code;
  }
  const record = asRecord(error);
  if (typeof record?.message === 'string') {
    const match = record.message.match(/DINGTALK_[A-Z_]+/);
    if (match) return match[0];
  }
  return undefined;
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  const record = asRecord(error);
  if (typeof record?.message === 'string') return record.message;
  return 'Tool execution failed';
};

const isUnsafeHint = (message: string): boolean =>
  message.length > 300 ||
  /select |insert |update |delete from |password|access_token|stack|at \w+\s+\(/i.test(message);

const safeHint = (message: string): string | undefined => {
  const trimmed = message.trim();
  if (!trimmed || isUnsafeHint(trimmed)) return undefined;
  if (/^DINGTALK_[A-Z_]+$/.test(trimmed)) return undefined;
  return trimmed;
};

const toStaffToken = (staffId: string): string =>
  staffId.startsWith('staff:') ? staffId : `staff:${staffId}`;

const formatCandidate = (candidate: AmbiguousCandidate): string => {
  const token = toStaffToken(candidate.staffId);
  const dept = candidate.leafDeptName || candidate.deptPath;
  return dept ? `${candidate.name} · ${dept}（${token}）` : `${candidate.name}（${token}）`;
};

const extractRoomIssues = (error: unknown): MeetingRoomIssue[] => {
  for (const record of nestedErrorRecords(error)) {
    if (!Array.isArray(record.roomIssues)) continue;
    const issues: MeetingRoomIssue[] = [];
    for (const item of record.roomIssues) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      if (typeof row.roomName !== 'string' || typeof row.reason !== 'string') continue;
      if (isUnsafeHint(row.roomName) || isUnsafeHint(row.reason)) continue;
      issues.push({ reason: row.reason, roomName: row.roomName });
    }
    if (issues.length > 0) return issues;
  }
  return [];
};

const extractTimeApplied = (error: unknown): boolean => {
  for (const record of nestedErrorRecords(error)) {
    if (record.timeApplied === true) return true;
  }
  return false;
};

const extractCandidates = (error: unknown): AmbiguousCandidate[] => {
  for (const record of nestedErrorRecords(error)) {
    if (!Array.isArray(record.candidates)) continue;
    const candidates: AmbiguousCandidate[] = [];
    for (const item of record.candidates) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const staffId =
        typeof row.staffId === 'string'
          ? row.staffId
          : typeof row.staffToken === 'string'
            ? row.staffToken
            : undefined;
      if (typeof row.name !== 'string' || !staffId) continue;
      candidates.push({
        deptPath: typeof row.deptPath === 'string' ? row.deptPath : undefined,
        leafDeptName: typeof row.leafDeptName === 'string' ? row.leafDeptName : undefined,
        name: row.name,
        staffId,
      });
    }
    if (candidates.length > 0) return candidates;
  }
  return [];
};

const hasAmbiguousUsers = (users: DirectoryUserHit[], flagged?: boolean): boolean => {
  if (flagged) return true;
  const counts = new Map<string, number>();
  for (const user of users) {
    const key = user.name.trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count >= 2);
};

const pickServerNow = (data: unknown): string => {
  const record = asRecord(data);
  if (typeof record?.serverNow === 'string' && record.serverNow) return record.serverNow;
  return formatServerNow();
};

const flattenDateTime = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return formatServerNow(new Date(value));
  }
  const record = asRecord(value);
  if (!record) return undefined;
  if (typeof record.dateTime === 'string') return record.dateTime;
  if (typeof record.date === 'string') return record.date;
  return undefined;
};

const flattenAttendee = (value: unknown): Record<string, unknown> | unknown => {
  const record = asRecord(value);
  if (!record) return value;
  const staffToken =
    typeof record.staffToken === 'string'
      ? toStaffToken(record.staffToken)
      : typeof record.id === 'string' && record.id.startsWith('staff:')
        ? record.id
        : undefined;
  return {
    displayName: typeof record.displayName === 'string' ? record.displayName : undefined,
    isOptional: record.isOptional,
    self: record.self,
    ...(staffToken ? { staffToken } : { unresolved: true }),
  };
};

const flattenOrganizer = (value: unknown): Record<string, unknown> | unknown => {
  const record = asRecord(value);
  if (!record) return value;
  const staffToken =
    typeof record.staffToken === 'string'
      ? toStaffToken(record.staffToken)
      : typeof record.id === 'string' && record.id.startsWith('staff:')
        ? record.id
        : undefined;
  return {
    displayName: typeof record.displayName === 'string' ? record.displayName : undefined,
    self: record.self,
    ...(staffToken ? { staffToken } : { unresolved: true }),
  };
};

const flattenEvent = (value: unknown): Record<string, unknown> | unknown => {
  const record = asRecord(value);
  if (!record) return value;
  const location =
    typeof record.location === 'string' ? record.location : asRecord(record.location)?.displayName;
  const attendees = Array.isArray(record.attendees)
    ? record.attendees.map(flattenAttendee)
    : record.attendees;
  return {
    ...record,
    attendees,
    end: flattenDateTime(record.end) ?? record.end,
    eventId: record.eventId ?? record.id,
    location: location ?? record.location,
    organizer: flattenOrganizer(record.organizer),
    start: flattenDateTime(record.start) ?? record.start,
  };
};

const flattenTodo = (value: unknown): Record<string, unknown> | unknown => {
  const record = asRecord(value);
  if (!record) return value;
  const done = record.done === true || record.isDone === true;
  return { ...record, isDone: done };
};

const flattenFreeBusyPerson = (value: unknown): Record<string, unknown> | unknown => {
  const record = asRecord(value);
  if (!record) return value;
  const blocks = Array.isArray(record.blocks)
    ? record.blocks.map((block) => {
        const row = asRecord(block);
        if (!row) return block;
        return {
          end: flattenDateTime(row.end) ?? row.end,
          start: flattenDateTime(row.start) ?? row.start,
          status: row.status,
        };
      })
    : record.blocks;
  const rawError = typeof record.error === 'string' ? record.error : undefined;
  const error = rawError
    ? rawError.startsWith('DINGTALK_')
      ? rawError
      : 'DINGTALK_UNAVAILABLE'
    : undefined;
  const staffToken =
    typeof record.staffToken === 'string' && record.staffToken
      ? toStaffToken(record.staffToken)
      : undefined;
  return {
    blocks,
    error,
    name: typeof record.name === 'string' ? record.name : undefined,
    staffToken,
    ...(typeof record.status === 'string' ? { status: record.status } : {}),
  };
};

const normalizeResult = (data: unknown): unknown => {
  const record = asRecord(data);
  if (!record) return data;
  if (Array.isArray(record.items)) {
    const items = record.items.map((item) => {
      const row = asRecord(item);
      if (!row) return item;
      if ('taskId' in row || 'done' in row || 'isDone' in row) return flattenTodo(row);
      if ('summary' in row || 'eventId' in row || 'id' in row) return flattenEvent(row);
      if ('roomId' in row || 'roomName' in row) return item;
      return item;
    });
    return { ...record, items };
  }
  if (Array.isArray(record.people)) {
    return { ...record, people: record.people.map(flattenFreeBusyPerson) };
  }
  if ('taskId' in record || 'done' in record) return flattenTodo(record);
  if ('summary' in record || 'eventId' in record || 'id' in record) return flattenEvent(record);
  return record;
};

const LIST_KEYS = ['items', 'people', 'users', 'departments', 'attendees'] as const;

const cloneRecord = (payload: Record<string, unknown>): Record<string, unknown> => {
  const next: Record<string, unknown> = { ...payload };
  const nested = asRecord(payload.event);
  if (nested) next.event = { ...nested };
  return next;
};

const eachEventRecord = (
  payload: Record<string, unknown>,
  visit: (record: Record<string, unknown>) => void,
): void => {
  visit(payload);
  const nested = asRecord(payload.event);
  if (nested) visit(nested);
};

const capLists = (payload: Record<string, unknown>): Record<string, unknown> => {
  const next = cloneRecord(payload);
  let truncated = payload.truncated === true;
  eachEventRecord(next, (record) => {
    for (const key of LIST_KEYS) {
      const list = record[key];
      if (!Array.isArray(list) || list.length <= MAX_PAYLOAD_LIST) continue;
      record[key] = list.slice(0, MAX_PAYLOAD_LIST);
      truncated = true;
    }
  });
  if (truncated) next.truncated = true;
  return next;
};

const identityPayload = (
  payload: Record<string, unknown>,
  serverNow: string,
): Record<string, unknown> => {
  const kept: Record<string, unknown> = { serverNow, truncated: true };
  for (const key of ['eventId', 'id', 'summary', 'taskId'] as const) {
    if (typeof payload[key] === 'string' && payload[key]) kept[key] = payload[key];
  }
  const event = asRecord(payload.event);
  if (event) {
    const eventId =
      (typeof event.eventId === 'string' && event.eventId) ||
      (typeof event.id === 'string' && event.id) ||
      undefined;
    const summary = typeof event.summary === 'string' ? event.summary : undefined;
    kept.event = {
      ...(eventId ? { eventId, id: eventId } : {}),
      ...(summary !== undefined ? { summary } : {}),
    };
  }
  return kept;
};

const fitPayload = (payload: Record<string, unknown>): Record<string, unknown> => {
  const serverNow = typeof payload.serverNow === 'string' ? payload.serverNow : formatServerNow();
  const { serverNow: _ignored, ...rest } = capLists(payload);
  const current: Record<string, unknown> = { serverNow, ...rest };
  const nested = asRecord(current.event);
  if (nested) current.event = { ...nested };
  const size = () => compactJson(current).length;
  if (size() <= DINGTALK_WORKSPACE_CONTENT_LIMIT) return current;

  current.truncated = true;
  eachEventRecord(current, (record) => {
    for (const key of LIST_KEYS) {
      if (!Array.isArray(record[key])) continue;
      let list = [...(record[key] as unknown[])];
      while (list.length > 0 && size() > DINGTALK_WORKSPACE_CONTENT_LIMIT) {
        list = list.slice(0, Math.max(0, Math.floor(list.length / 2)));
        record[key] = list;
      }
    }
  });

  eachEventRecord(current, (record) => {
    const description = record.description;
    if (typeof description !== 'string' || description.length === 0) return;
    let text = description;
    while (text.length > 0 && size() > DINGTALK_WORKSPACE_CONTENT_LIMIT) {
      text = text.slice(0, Math.max(0, Math.floor(text.length / 2)));
      record.description = text;
    }
  });

  if (size() > DINGTALK_WORKSPACE_CONTENT_LIMIT) {
    return identityPayload(current, serverNow);
  }
  return current;
};

const payloadOf = (data: unknown, serverNow: string): Record<string, unknown> => {
  const normalized = normalizeResult(data);
  if (Array.isArray(normalized)) return fitPayload({ items: normalized, serverNow });
  const record = asRecord(normalized);
  if (record) {
    const { serverNow: _ignored, ...rest } = record;
    return fitPayload({ serverNow, ...rest });
  }
  return fitPayload({ result: normalized, serverNow });
};

const failResult = (content: string, error?: DingtalkToolFailure): BuiltinServerRuntimeOutput => {
  const payload: Record<string, unknown> = { serverNow: formatServerNow() };
  if (error?.code) payload.code = error.code;
  if (error?.candidates?.length) payload.candidates = error.candidates;
  return {
    content: `${content}\n${compactJson(payload)}`,
    error,
    success: false,
  };
};

const friendlyDingtalkErrorContent = (code: string, error: unknown): string => {
  const hint = safeHint(errorMessage(error));
  switch (code) {
    case 'DINGTALK_NOT_CONFIGURED': {
      return '钉钉服务号未配置（DINGTALK_NOT_CONFIGURED），无法使用待办或日程。请联系管理员在即时通讯连接器中配置钉钉服务号。';
    }
    case 'DINGTALK_FEATURE_DISABLED': {
      return '该能力未开启（DINGTALK_FEATURE_DISABLED）。请联系管理员在钉钉连接器的「工作台能力」中开启待办或日程。';
    }
    case 'DINGTALK_FORBIDDEN': {
      return hint
        ? `没有权限执行该操作（DINGTALK_FORBIDDEN）：${hint}`
        : '没有权限执行该操作（DINGTALK_FORBIDDEN）。请确认您是待办创建者或日程组织者，或联系管理员检查应用权限范围。';
    }
    case 'DINGTALK_PREMIUM_REQUIRED': {
      return '该操作需要钉钉 OA 审批高级版（DINGTALK_PREMIUM_REQUIRED），当前企业未开通。请改用其他操作。';
    }
    case 'DINGTALK_NOT_FOUND': {
      return hint
        ? `未找到该待办或日程（DINGTALK_NOT_FOUND）：${hint}`
        : '未找到该待办或日程（DINGTALK_NOT_FOUND）。请先 listTodos / listEvents 确认 id，且只能操作通过本工具创建的待办。';
    }
    case 'DINGTALK_INVALID': {
      return hint
        ? `参数无效（DINGTALK_INVALID）：${hint}`
        : '参数无效（DINGTALK_INVALID）。请根据说明修正时间、人员或必填字段后重试。';
    }
    case 'DINGTALK_ROOM_UNAVAILABLE': {
      const issues = extractRoomIssues(error);
      const timeApplied = extractTimeApplied(error);
      const details =
        issues.length > 0
          ? issues
              .map((issue) => `会议室「${issue.roomName}」该时段无法预订:${issue.reason}`)
              .join('。')
          : '所选会议室该时段无法预订';
      const partial = timeApplied ? '日程时间已更新，会议室未更换。' : '';
      return `${details}。${partial}请调整时间或更换会议室后重试。（DINGTALK_ROOM_UNAVAILABLE）`;
    }
    case 'DINGTALK_RATE_LIMITED': {
      return '钉钉接口限流（DINGTALK_RATE_LIMITED），请稍后重试，不要并行密集调用。';
    }
    case 'DINGTALK_UNAVAILABLE': {
      return '钉钉服务暂时不可用（DINGTALK_UNAVAILABLE），请稍后重试。';
    }
    case 'DINGTALK_IDENTITY_UNBOUND': {
      return '当前账号未绑定钉钉身份（DINGTALK_IDENTITY_UNBOUND）。请使用钉钉登录或通过钉钉机器人完成绑定；管理员不能代为绑定。';
    }
    case 'DINGTALK_IDENTITY_UNVERIFIED': {
      return '钉钉身份未经验证（DINGTALK_IDENTITY_UNVERIFIED）。请使用钉钉登录或通过钉钉机器人完成绑定；管理员不能代为绑定。';
    }
    case 'DINGTALK_IDENTITY_INACTIVE': {
      return '钉钉账号已停用或已离职（DINGTALK_IDENTITY_INACTIVE），无法操作待办或日程。';
    }
    case 'DINGTALK_NOT_TASK_OWNER': {
      return '您不是该任务的当前处理人（DINGTALK_NOT_TASK_OWNER）。';
    }
    case 'DINGTALK_NOT_ORIGINATOR': {
      return '仅发起人可执行该操作（DINGTALK_NOT_ORIGINATOR）。';
    }
    case 'DINGTALK_NOT_APPROVAL_ADMIN': {
      return '需要钉钉审批管理员权限（DINGTALK_NOT_APPROVAL_ADMIN）。';
    }
    case 'DINGTALK_AUTOMATION_OFF': {
      return '自动审批已关闭（DINGTALK_AUTOMATION_OFF）。';
    }
    case 'DINGTALK_RULE_LIMIT': {
      return '已达到规则数量上限（DINGTALK_RULE_LIMIT）。';
    }
    case 'DINGTALK_AMBIGUOUS': {
      const candidates = extractCandidates(error);
      const base =
        '人员无法唯一确定（DINGTALK_AMBIGUOUS）。请列出候选「姓名 · 部门」请用户选择后再重试，不要自行猜测。';
      if (candidates.length === 0) return base;
      return `${base} 候选：${candidates.map(formatCandidate).join('、')}`;
    }
    default: {
      return DINGTALK_WORKSPACE_INTERNAL_TOOL_CONTENT;
    }
  }
};

/**
 * Every workspace API funnels failures through this sanitizer. Known DINGTALK_*
 * codes keep their friendly Chinese copy; anything else becomes a generic
 * internal error. The raw error object is never attached to the LLM payload.
 */
const sanitizeDingtalkFailure = (
  error: unknown,
): { content: string; error: DingtalkToolFailure } => {
  const code = extractErrorCode(error);

  if (code && KNOWN_DINGTALK_ERROR_CODES.has(code)) {
    const content = friendlyDingtalkErrorContent(code, error);
    const candidates = code === 'DINGTALK_AMBIGUOUS' ? extractCandidates(error) : [];
    return {
      content,
      error: {
        code,
        message: content,
        ...(candidates.length > 0 ? { candidates } : {}),
      },
    };
  }

  console.error('[lobe-dingtalk-workspace] failed', error);
  return {
    content: DINGTALK_WORKSPACE_INTERNAL_TOOL_CONTENT,
    error: { code: 'DINGTALK_INTERNAL', message: DINGTALK_WORKSPACE_INTERNAL_TOOL_CONTENT },
  };
};

const dingtalkFailureResult = (error: unknown): BuiltinServerRuntimeOutput => {
  const sanitized = sanitizeDingtalkFailure(error);
  return failResult(sanitized.content, sanitized.error);
};

const okResult = (
  data: unknown,
  summary?: string,
  state?: Record<string, unknown>,
): BuiltinServerRuntimeOutput => {
  const serverNow = pickServerNow(data);
  const payload = payloadOf(data, serverNow);
  const json = compactJson(payload);
  return {
    content: summary ? `${summary}\n${json}` : json,
    state: { success: true, ...payload, ...state },
    success: true,
  };
};

/**
 * DingTalk todo + calendar execution runtime. Accepts DingtalkTodoService /
 * DingtalkCalendarService (or a test double) via constructor injection —
 * no React, no Zustand, no `@/services` imports.
 */
export class DingtalkWorkspaceExecutionRuntime {
  constructor(private service: IDingtalkWorkspaceService) {}

  async searchDirectory(args: SearchDirectoryParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.searchDirectory(args.q, args.kind);
      const users = result.users ?? [];
      const departments = result.departments ?? [];
      const ambiguous = hasAmbiguousUsers(users, result.ambiguous);
      const serverNow = result.serverNow || formatServerNow();
      const usersPayload = users.map((user) => ({
        active: user.active,
        deptPath: user.deptPath,
        leafDeptName: user.leafDeptName,
        name: user.name,
        staffId: toStaffToken(user.staffId),
      }));
      const payload = fitPayload({
        ambiguous,
        departments: departments.map((dept) => ({
          deptId: dept.deptId,
          memberCount: dept.memberCount,
          name: dept.name,
          pathNames: dept.pathNames,
        })),
        serverNow,
        users: usersPayload,
      });
      const instruction = ambiguous
        ? '存在同名人员，请列出「姓名 · 部门」请用户选择后再调用写入接口，不要猜测。'
        : '请将返回的 staff:<id> token 原样传入待办或日程接口（逐字复制，不要改写汉字）。';
      const state: SearchDirectoryState = {
        ambiguous,
        departmentCount: departments.length,
        hits: { departments, users: usersPayload },
        serverNow,
        userCount: users.length,
      };
      return {
        content: `${instruction}\n${compactJson(payload)}`,
        state,
        success: true,
      };
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async listTodos(args: ListTodosParams = {}): Promise<BuiltinServerRuntimeOutput> {
    try {
      return okResult(await this.service.listTodos(args));
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async createTodo(args: CreateTodoParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      return okResult(await this.service.createTodo(args), '已创建待办');
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async updateTodo(args: UpdateTodoParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      return okResult(await this.service.updateTodo(args), `已更新待办 ${args.taskId}`);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async completeTodo(args: CompleteTodoParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      return okResult(await this.service.completeTodo(args), `已完成待办 ${args.taskId}`);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async deleteTodo(args: DeleteTodoParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      return okResult(await this.service.deleteTodo(args), `已删除待办 ${args.taskId}`);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async listEvents(args: ListEventsParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      return okResult(await this.service.listEvents(args));
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async getEvent(args: GetEventParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const event = flattenEvent(await this.service.getEvent(args));
      return okResult({ event });
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async queryFreeBusy(args: QueryFreeBusyParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      return okResult(
        await this.service.queryFreeBusy(args),
        '仅返回忙闲时段，不含他人日程标题或详情。',
      );
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async listMeetingRooms(): Promise<BuiltinServerRuntimeOutput> {
    try {
      return okResult(await this.service.listMeetingRooms());
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async createEvent(args: CreateEventParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      return okResult(await this.service.createEvent(args), '已创建日程');
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async updateEvent(args: UpdateEventParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      return okResult(await this.service.updateEvent(args), `已更新日程 ${args.eventId}`);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async deleteEvent(args: DeleteEventParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      return okResult(await this.service.deleteEvent(args), `已删除日程 ${args.eventId}`);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async respondEvent(args: RespondEventParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      return okResult(await this.service.respondEvent(args), `已回复日程 ${args.eventId}`);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }
}

export const createDingtalkWorkspaceRuntime = (service: IDingtalkWorkspaceService) =>
  new DingtalkWorkspaceExecutionRuntime(service);
