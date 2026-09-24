/**
 * Pure projections from raw dws JSON (stdout, or the inner `data` / `result`)
 * onto the tool state shapes in contract §4. Missing fields become empty
 * values; nothing here throws.
 */

import type {
  GroupItem,
  GroupsState,
  ListMyTodosState,
  MessageFile,
  MessageItem,
  MessagesState,
  ReportDetailState,
  ReportItem,
  ReportsState,
  ReportTemplateField,
  TemplatesState,
  TemplateState,
  TodoDetailState,
  TodoItem,
} from '@lobechat/builtin-tool-dingtalk-personal';

export type {
  AuthRequiredState,
  DingtalkPersonalLoginView,
  DingtalkPersonalToolState,
  FileState,
  GroupItem,
  GroupsState,
  ListMyTodosState,
  MessageFile,
  MessageItem,
  MessagesState,
  ReportDetailState,
  ReportItem,
  ReportsState,
  ReportTemplateField as TemplateField,
  TemplatesState,
  TemplateState,
  TodoDetailState,
  TodoItem,
  WriteState,
} from '@lobechat/builtin-tool-dingtalk-personal';

export interface MessageQuery {
  conversationId?: string;
  endTime?: string;
  startTime?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

const recordsOf = (raw: unknown): Record<string, unknown>[] => {
  const root = asRecord(raw) ?? {};
  const data = asRecord(root.data);
  const result = asRecord(root.result);
  const nested = asRecord(result?.data) ?? asRecord(data?.result);
  const records = [data, result, nested, root].filter(
    (item): item is Record<string, unknown> => !!item,
  );
  return records;
};

const firstArray = (raw: unknown, keys: string[]): unknown[] => {
  for (const record of recordsOf(raw)) {
    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) return value;
    }
  }
  return [];
};

const firstRecord = (raw: unknown, keys: string[]): Record<string, unknown> => {
  for (const record of recordsOf(raw)) {
    if (keys.some((key) => key in record)) return record;
  }
  return asRecord(raw) ?? {};
};

const idString = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const optionalText = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const rawText = (value: unknown): string => (typeof value === 'string' ? value : '');

const finiteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const nullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  return finiteNumber(value) ?? null;
};

const optionalNumber = (value: unknown): number | undefined => {
  const parsed = finiteNumber(value);
  return parsed === undefined ? undefined : parsed;
};

const namesFrom = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const name = item.trim();
      if (name) names.push(name);
      continue;
    }
    const name = optionalText(asRecord(item)?.name);
    if (name) names.push(name);
  }
  return names;
};

const detailUrlOf = (value: unknown): string | undefined => {
  if (typeof value === 'string') return optionalText(value);
  const record = asRecord(value);
  if (!record) return undefined;
  return optionalText(record.pcUrl) ?? optionalText(record.appUrl) ?? optionalText(record.url);
};

const cursorString = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

export const projectTodoList = (
  raw: unknown,
  query: { page: number; status: ListMyTodosState['status'] },
): ListMyTodosState => {
  const payload = firstRecord(raw, ['todos', 'hasMore', 'page']);
  const todos: TodoItem[] = [];
  for (const item of firstArray(raw, ['todos'])) {
    const record = asRecord(item);
    if (!record) continue;
    const taskId = idString(record.taskId ?? record.task_id);
    const subject = optionalText(record.subject ?? record.title) ?? '';
    if (!taskId && !subject) continue;
    const stage = optionalNumber(record.finalStatusStage ?? record.stage);
    const todo: TodoItem = {
      dueTime: nullableNumber(record.dueTime ?? record.due_time),
      priority: nullableNumber(record.priority),
      subject,
      taskId,
    };
    if (stage !== undefined) todo.stage = stage;
    todos.push(todo);
  }
  return {
    hasMore: payload.hasMore === true,
    kind: 'todos',
    page: query.page,
    status: query.status,
    todos,
  };
};

export const projectTodoDetail = (raw: unknown): TodoDetailState => {
  const payload = firstRecord(raw, ['taskId', 'subject', 'isDone', 'executorInfos']);
  const createdTime = optionalNumber(payload.createdTime ?? payload.created_time);
  const creator =
    optionalText(asRecord(payload.creatorInfo)?.name) ??
    optionalText(payload.creatorName) ??
    optionalText(payload.creator_name);
  const detailUrl = detailUrlOf(payload.detailUrl ?? payload.detail_url);
  return {
    kind: 'todo',
    todo: {
      ...(createdTime !== undefined ? { createdTime } : {}),
      ...(creator ? { creatorName: creator } : {}),
      ...(detailUrl ? { detailUrl } : {}),
      dueTime: nullableNumber(payload.dueTime ?? payload.due_time),
      executorNames: namesFrom(payload.executorInfos ?? payload.executors),
      isDone: payload.isDone === true || payload.is_done === true,
      participantNames: namesFrom(payload.participantInfos ?? payload.participants),
      priority: nullableNumber(payload.priority),
      subject: optionalText(payload.subject ?? payload.title) ?? '',
      taskId: idString(payload.taskId ?? payload.task_id),
    },
  };
};

export const projectGroups = (raw: unknown): GroupsState => {
  const payload = firstRecord(raw, ['groups', 'hasMore', 'nextCursor']);
  const groups: GroupItem[] = [];
  for (const item of firstArray(raw, ['groups'])) {
    const record = asRecord(item);
    if (!record) continue;
    const conversationId = idString(
      record.conversationId ?? record.openConversationId ?? record.open_conversation_id,
    );
    const name = optionalText(record.name ?? record.title) ?? '';
    if (!conversationId && !name) continue;
    const memberCount = optionalNumber(record.memberCount ?? record.member_count);
    const type = optionalText(record.type ?? record.groupType ?? record.group_type);
    groups.push({
      conversationId,
      ...(memberCount !== undefined ? { memberCount } : {}),
      name,
      ...(type ? { type } : {}),
    });
  }
  const nextCursor = cursorString(payload.nextCursor ?? payload.next_cursor ?? payload.cursor);
  const hasMore = payload.hasMore === true || (payload.complete === false && !!nextCursor);
  return {
    groups,
    hasMore,
    kind: 'groups',
    ...(nextCursor ? { nextCursor } : {}),
  };
};

const projectFiles = (value: unknown): MessageFile[] => {
  if (!Array.isArray(value)) return [];
  const files: MessageFile[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const resourceId = idString(record.resourceId ?? record.resource_id ?? record['resource-id']);
    if (!resourceId) continue;
    files.push({
      name: optionalText(record.name ?? record.fileName) ?? '',
      resourceId,
      resourceType: optionalText(record.resourceIdType ?? record.resourceType ?? record.type) ?? '',
    });
  }
  return files;
};

export const projectMessages = (raw: unknown, query: MessageQuery = {}): MessagesState => {
  const payload = firstRecord(raw, ['messages', 'hasMore', 'truncated', 'queryRange']);
  const messages: MessageItem[] = [];
  let firstConversationId: string | undefined;
  for (const item of firstArray(raw, ['messages'])) {
    const record = asRecord(item);
    if (!record) continue;
    firstConversationId ??= optionalText(record.conversationId ?? record.conversation_id);
    const messageId = optionalText(record.messageId ?? record.message_id);
    const sender = optionalText(record.sender ?? record.senderName) ?? '';
    const text = rawText(record.text ?? record.content);
    const files = projectFiles(record.resourceRefs ?? record.files ?? record.attachments);
    if (!messageId && !sender && !text && files.length === 0) continue;
    const senderId = optionalText(record.senderId ?? record.sender_id);
    messages.push({
      createTime: optionalText(record.createTime ?? record.create_time ?? record.time) ?? '',
      files,
      ...(messageId ? { messageId } : {}),
      sender,
      ...(senderId ? { senderId } : {}),
      text,
    });
  }
  const range = asRecord(payload.queryRange) ?? asRecord(payload.query_range);
  const conversationId =
    optionalText(query.conversationId) ??
    firstConversationId ??
    optionalText(payload.conversationId);
  const startTime = optionalText(query.startTime) ?? optionalText(range?.startTime);
  const endTime = optionalText(query.endTime) ?? optionalText(range?.endTime);
  const truncated =
    payload.truncated === true ||
    payload.truncatedByPageLimit === true ||
    payload.truncatedByResultLimit === true;
  return {
    ...(conversationId ? { conversationId } : {}),
    count: messages.length,
    ...(endTime ? { endTime } : {}),
    hasMore: payload.hasMore === true,
    kind: 'messages',
    messages,
    ...(startTime ? { startTime } : {}),
    truncated,
  };
};

export const projectReports = (
  raw: unknown,
  box: ReportsState['box'],
  requestedCursor = 0,
): ReportsState => {
  const payload = firstRecord(raw, ['reports', 'complete', 'nextCursor']);
  const reports: ReportItem[] = [];
  for (const item of firstArray(raw, ['reports'])) {
    const record = asRecord(item);
    if (!record) continue;
    const reportId = idString(record.reportId ?? record.report_Id ?? record.report_id);
    if (!reportId) continue;
    const createTime = optionalNumber(record.createTime ?? record.create_time);
    const modifiedTime = optionalNumber(record.modifiedTime ?? record.modified_time);
    const creatorName = optionalText(record.creatorName ?? record.creator_name);
    const creatorUserId = optionalText(
      record.creatorUserId ?? record.creator_user_id ?? record.creatorId,
    );
    const templateName = optionalText(
      record.templateName ?? record.template_name ?? record.report_template_name,
    );
    reports.push({
      ...(createTime !== undefined ? { createTime } : {}),
      ...(creatorName ? { creatorName } : {}),
      ...(creatorUserId ? { creatorUserId } : {}),
      ...(modifiedTime !== undefined ? { modifiedTime } : {}),
      reportId,
      ...(templateName ? { templateName } : {}),
    });
  }
  const complete = payload.complete === true;
  const explicit = optionalNumber(payload.nextCursor ?? payload.next_cursor ?? payload.cursor);
  let nextCursor: number | undefined;
  if (!complete && reports.length > 0) {
    nextCursor =
      explicit !== undefined && explicit > requestedCursor
        ? explicit
        : requestedCursor + reports.length;
  }
  return {
    box,
    complete,
    kind: 'reports',
    ...(nextCursor !== undefined ? { nextCursor } : {}),
    reports,
  };
};

export const projectReportDetail = (raw: unknown): ReportDetailState => {
  const payload = firstRecord(raw, ['report_Id', 'reportId', 'report_content', 'contents']);
  const contents: { key: string; value: string }[] = [];
  const source = Array.isArray(payload.report_content)
    ? payload.report_content
    : Array.isArray(payload.contents)
      ? payload.contents
      : [];
  for (const item of source) {
    const record = asRecord(item);
    if (!record) continue;
    const key = optionalText(record.key ?? record.field_name ?? record.name);
    if (!key) continue;
    const value = record.value ?? record.content ?? '';
    contents.push({
      key,
      value: typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value),
    });
  }
  const createTime = optionalNumber(payload.createTime ?? payload.create_time);
  const creatorName = optionalText(payload.creatorName ?? payload.creator_name);
  const deptName = optionalText(payload.deptName ?? payload.dept_name);
  const name = optionalText(payload.report_name ?? payload.name);
  const templateName = optionalText(payload.report_template_name ?? payload.templateName);
  const url = optionalText(payload.url);
  return {
    kind: 'report',
    report: {
      contents,
      ...(createTime !== undefined ? { createTime } : {}),
      ...(creatorName ? { creatorName } : {}),
      ...(deptName ? { deptName } : {}),
      ...(name ? { name } : {}),
      reportId: idString(payload.report_Id ?? payload.reportId ?? payload.report_id),
      ...(templateName ? { templateName } : {}),
      ...(url ? { url } : {}),
    },
  };
};

export const projectTemplates = (raw: unknown): TemplatesState => {
  const templates: { id: string; name: string }[] = [];
  for (const item of firstArray(raw, ['items', 'templates'])) {
    const record = asRecord(item);
    if (!record) continue;
    const id = idString(record.report_template_id ?? record.templateId ?? record.id);
    const name = optionalText(record.report_template_name ?? record.name) ?? '';
    if (!id && !name) continue;
    templates.push({ id, name });
  }
  return { kind: 'templates', templates };
};

export const projectTemplate = (raw: unknown): TemplateState => {
  const payload = firstRecord(raw, ['report_template_fields', 'fields', 'report_template_id']);
  const source = Array.isArray(payload.report_template_fields)
    ? payload.report_template_fields
    : Array.isArray(payload.fields)
      ? payload.fields
      : [];
  const fields: ReportTemplateField[] = [];
  for (const item of source) {
    const record = asRecord(item);
    if (!record) continue;
    const name = optionalText(record.field_name ?? record.name);
    if (!name) continue;
    fields.push({
      name,
      sort: optionalNumber(record.field_sort ?? record.sort) ?? 0,
      type: optionalNumber(record.field_type ?? record.type) ?? 0,
    });
  }
  return {
    kind: 'template',
    template: {
      fields,
      id: idString(payload.report_template_id ?? payload.templateId ?? payload.id),
      name: optionalText(payload.report_template_name ?? payload.name) ?? '',
    },
  };
};

/** reportId from a submit (or get) payload, if dws echoed one. */
export const projectSubmittedReportId = (raw: unknown): string | undefined => {
  for (const record of recordsOf(raw)) {
    const id = idString(record.reportId ?? record.report_Id ?? record.report_id);
    if (id) return id;
  }
  return undefined;
};

/** Subject echoed by a todo write, when present. Never a message body. */
export const projectWriteSubject = (raw: unknown): string | undefined => {
  for (const record of recordsOf(raw)) {
    const subject = optionalText(record.subject ?? record.title);
    if (subject) return subject;
  }
  return undefined;
};
