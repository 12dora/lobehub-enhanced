import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  AddApproverParams,
  AddApproverState,
  ApprovalDetailLine,
  ApprovalListRow,
  ApprovalRuleListRow,
  ApproveTaskParams,
  ApproveTaskState,
  CommentApprovalParams,
  CommentApprovalState,
  CreateApprovalRuleParams,
  CreateApprovalRuleState,
  DeleteApprovalRuleParams,
  DeleteApprovalRuleState,
  DeleteTemplateParams,
  DeleteTemplateState,
  DirectoryDepartmentHit,
  DirectoryUserHit,
  GetApprovalDetailParams,
  GetApprovalDetailState,
  GetTemplateSchemaParams,
  GetTemplateSchemaState,
  ListApprovalRulesParams,
  ListApprovalRulesState,
  ListMyApplicationsParams,
  ListMyApplicationsState,
  ListPendingApprovalsParams,
  ListPendingApprovalsState,
  ListTemplatesParams,
  ListTemplatesState,
  RefuseTaskParams,
  RefuseTaskState,
  ReturnTaskParams,
  ReturnTaskState,
  SaveTemplateParams,
  SaveTemplateState,
  SearchDirectoryParams,
  SearchDirectoryState,
  SubmitApprovalParams,
  SubmitApprovalState,
  TemplateSchemaFieldRow,
  TransferTaskParams,
  TransferTaskState,
  UpdateApprovalRuleParams,
  UpdateApprovalRuleState,
  WithdrawApplicationParams,
  WithdrawApplicationState,
} from '../types';
import { dingtalkFailureResult, formatCandidateLabel } from './errors';

export {
  DINGTALK_ERROR_CODES,
  DINGTALK_INTERNAL_TOOL_CONTENT,
  dingtalkErrorGuidance,
} from './errors';

export interface CreateApprovalRuleRuntimeInput extends CreateApprovalRuleParams {
  topicId?: string | null;
}

export interface IDingtalkApprovalService {
  addApprover: (params: AddApproverParams) => Promise<unknown>;
  approveTask: (params: ApproveTaskParams) => Promise<unknown>;
  commentApproval: (params: CommentApprovalParams) => Promise<unknown>;
  createApprovalRule: (params: CreateApprovalRuleRuntimeInput) => Promise<unknown>;
  deleteApprovalRule: (params: DeleteApprovalRuleParams) => Promise<unknown>;
  deleteTemplate: (params: DeleteTemplateParams) => Promise<unknown>;
  getApprovalDetail: (params: GetApprovalDetailParams) => Promise<unknown>;
  getTemplateSchema: (params: GetTemplateSchemaParams) => Promise<unknown>;
  listApprovalRules: (params?: ListApprovalRulesParams) => Promise<unknown>;
  listMyApplications: (params?: ListMyApplicationsParams) => Promise<unknown>;
  listPendingApprovals: (params?: ListPendingApprovalsParams) => Promise<unknown>;
  listTemplates: (params?: ListTemplatesParams) => Promise<unknown>;
  refuseTask: (params: RefuseTaskParams) => Promise<unknown>;
  returnTask: (params: ReturnTaskParams) => Promise<unknown>;
  saveTemplate: (params: SaveTemplateParams) => Promise<unknown>;
  searchDirectory: (params: SearchDirectoryParams) => Promise<{
    ambiguous?: boolean;
    departments?: DirectoryDepartmentHit[];
    serverNow?: string;
    users?: DirectoryUserHit[];
  }>;
  submitApproval: (params: SubmitApprovalParams) => Promise<unknown>;
  transferTask: (params: TransferTaskParams) => Promise<unknown>;
  updateApprovalRule: (params: UpdateApprovalRuleParams) => Promise<unknown>;
  withdrawApplication: (params: WithdrawApplicationParams) => Promise<unknown>;
}

export const DINGTALK_APPROVAL_CONTENT_LIMIT = 12_000;
export const DINGTALK_APPROVAL_STATE_ROW_LIMIT = 50;

const compactJson = (value: unknown): string => JSON.stringify(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const asList = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.rows)) return value.rows;
  if (isRecord(value) && Array.isArray(value.items)) return value.items;
  if (isRecord(value) && Array.isArray(value.list)) return value.list;
  return [];
};

const truncatedFlag = (value: unknown): boolean | undefined => {
  if (isRecord(value) && typeof value.truncated === 'boolean') return value.truncated;
  return undefined;
};

const pickString = (value: unknown, keys: string[]): string | undefined => {
  if (!isRecord(value)) return undefined;
  for (const key of keys) {
    const item = value[key];
    if (typeof item === 'string' && item) return item;
  }
  return undefined;
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asIsoString = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return undefined;
};

const toStaffToken = (staffId: string): string =>
  staffId.startsWith('staff:') ? staffId : `staff:${staffId}`;

const LIST_KEYS = [
  'cc',
  'children',
  'departments',
  'fields',
  'formComponentValues',
  'items',
  'lines',
  'operationRecords',
  'options',
  'rows',
  'summary',
  'tasks',
  'users',
] as const;

const isListKey = (key: string): boolean => (LIST_KEYS as readonly string[]).includes(key);

const IDENTITY_KEYS = new Set([
  'componentId',
  'id',
  'processCode',
  'processInstanceId',
  'staffToken',
  'taskId',
]);

const payloadFits = (value: unknown): boolean =>
  compactJson(value).length <= DINGTALK_APPROVAL_CONTENT_LIMIT;

const capNamedLists = (value: unknown, max: number): unknown => {
  if (Array.isArray(value)) return value.slice(0, max).map((item) => capNamedLists(item, max));
  if (!isRecord(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item) && isListKey(key) && item.length > max) {
      next[key] = item.slice(0, max).map((entry) => capNamedLists(entry, max));
    } else {
      next[key] = capNamedLists(item, max);
    }
  }
  return next;
};

const shrinkNamedLists = (value: unknown): { changed: boolean; value: unknown } => {
  let changed = false;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!isRecord(node)) return node;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(node)) {
      if (Array.isArray(item) && isListKey(key) && item.length > 0) {
        const nextLength = item.length === 1 ? 0 : Math.floor(item.length / 2);
        if (nextLength < item.length) changed = true;
        next[key] = item.slice(0, nextLength).map(walk);
      } else {
        next[key] = walk(item);
      }
    }
    return next;
  };
  return { changed, value: walk(value) };
};

const shrinkLongStrings = (value: unknown, maxLen: number): unknown => {
  if (typeof value === 'string') {
    return value.length > maxLen ? value.slice(0, maxLen) : value;
  }
  if (Array.isArray(value)) return value.map((item) => shrinkLongStrings(item, maxLen));
  if (!isRecord(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    next[key] = IDENTITY_KEYS.has(key) ? item : shrinkLongStrings(item, maxLen);
  }
  return next;
};

const lastResortPayload = (payload: Record<string, unknown>): Record<string, unknown> => {
  const processInstanceId = optionalString(payload.processInstanceId);
  const processCode = optionalString(payload.processCode);
  return {
    truncated: true,
    ...(processInstanceId ? { processInstanceId } : {}),
    ...(processCode ? { processCode } : {}),
  };
};

const fitPayload = (payload: Record<string, unknown>): Record<string, unknown> => {
  if (payloadFits(payload)) return payload;

  let current: unknown = capNamedLists(
    { ...payload, truncated: true },
    DINGTALK_APPROVAL_STATE_ROW_LIMIT,
  );
  if (isRecord(current) && payloadFits(current)) return current;

  for (const maxLen of [4000, 1000, 200, 80]) {
    current = shrinkLongStrings(current, maxLen);
    if (isRecord(current)) current = { ...current, truncated: true };
    if (isRecord(current) && payloadFits(current)) return current;
  }

  if (isRecord(current)) {
    for (let step = 0; step < 12; step += 1) {
      const shrunk = shrinkNamedLists(current);
      current = isRecord(shrunk.value) ? { ...shrunk.value, truncated: true } : shrunk.value;
      if (!shrunk.changed) break;
      if (isRecord(current) && payloadFits(current)) return current;
    }
  }

  return lastResortPayload(payload);
};

const fitUnknown = (payload: unknown): unknown => {
  if (Array.isArray(payload)) return fitPayload({ items: payload });
  if (isRecord(payload)) return fitPayload(payload);
  const wrapped = { result: payload };
  return payloadFits(wrapped) ? wrapped : { truncated: true };
};

const presentPerson = (
  id: unknown,
  name: unknown,
): { name?: string; staffToken: string } | undefined => {
  const raw = optionalString(id);
  if (!raw) return undefined;
  const staffToken = toStaffToken(raw);
  const resolved = optionalString(name);
  return resolved ? { name: resolved, staffToken } : { staffToken };
};

const presentPersonRecord = (value: unknown): { name?: string; staffToken: string } | undefined => {
  if (typeof value === 'string') return presentPerson(value, undefined);
  if (!isRecord(value)) return undefined;
  return presentPerson(
    optionalString(value.userId) ??
      optionalString(value.originatorUserId) ??
      optionalString(value.staffId) ??
      optionalString(value.staffToken),
    optionalString(value.userName) ??
      optionalString(value.originatorName) ??
      optionalString(value.name) ??
      optionalString(value.showName),
  );
};

const presentCc = (data: Record<string, unknown>): Array<{ name?: string; staffToken: string }> => {
  const fromObjects = (list: unknown[]) =>
    list
      .map((item) => presentPersonRecord(item))
      .filter((item): item is { name?: string; staffToken: string } => !!item);

  if (Array.isArray(data.cc) && data.cc.length > 0) return fromObjects(data.cc);
  if (Array.isArray(data.ccUsers) && data.ccUsers.length > 0) return fromObjects(data.ccUsers);

  const ids = Array.isArray(data.ccUserIds) ? data.ccUserIds : [];
  const names = Array.isArray(data.ccUserNames)
    ? data.ccUserNames
    : Array.isArray(data.ccNames)
      ? data.ccNames
      : [];
  return ids
    .map((id, index) => presentPerson(id, names[index]))
    .filter((item): item is { name?: string; staffToken: string } => !!item);
};

const TASK_KEYS = [
  'activityId',
  'createTime',
  'finishTime',
  'processInstanceId',
  'result',
  'status',
  'taskId',
] as const;

const presentTask = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined;
  const person = presentPerson(
    optionalString(value.userId) ??
      optionalString(value.staffId) ??
      optionalString(value.staffToken),
    optionalString(value.userName) ?? optionalString(value.name) ?? optionalString(value.showName),
  );
  const next: Record<string, unknown> = {};
  for (const key of TASK_KEYS) {
    if (value[key] !== undefined) next[key] = value[key];
  }
  if (person) {
    next.staffToken = person.staffToken;
    if (person.name) next.name = person.name;
  }
  return next;
};

const OPERATION_KEYS = ['activityId', 'date', 'remark', 'result', 'type'] as const;

const presentOperation = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined;
  const person = presentPerson(
    optionalString(value.userId) ??
      optionalString(value.staffId) ??
      optionalString(value.staffToken),
    optionalString(value.userName) ?? optionalString(value.showName) ?? optionalString(value.name),
  );
  const next: Record<string, unknown> = {};
  for (const key of OPERATION_KEYS) {
    if (value[key] !== undefined) next[key] = value[key];
  }
  if (person) {
    next.staffToken = person.staffToken;
    if (person.name) next.name = person.name;
  }
  const cc = presentCc(value);
  if (cc.length > 0) next.cc = cc;
  return next;
};

const DETAIL_KEEP_KEYS = [
  'businessId',
  'createTime',
  'finishTime',
  'formComponentValues',
  'originatorDeptId',
  'originatorDeptName',
  'processInstanceId',
  'result',
  'status',
  'summary',
  'title',
] as const;

const presentApprovalDetail = (data: unknown): Record<string, unknown> => {
  if (!isRecord(data)) return {};
  const originatorSource = isRecord(data.originator) ? data.originator : undefined;
  const originator = presentPerson(
    data.originatorUserId ??
      originatorSource?.userId ??
      originatorSource?.staffId ??
      originatorSource?.staffToken,
    data.originatorName ?? originatorSource?.name ?? originatorSource?.userName,
  );
  const tasks = Array.isArray(data.tasks)
    ? data.tasks.map(presentTask).filter((item): item is Record<string, unknown> => !!item)
    : [];
  const operationRecords = Array.isArray(data.operationRecords)
    ? data.operationRecords
        .map(presentOperation)
        .filter((item): item is Record<string, unknown> => !!item)
    : [];
  const cc = presentCc(data);
  const next: Record<string, unknown> = {};
  for (const key of DETAIL_KEEP_KEYS) {
    if (data[key] !== undefined) next[key] = data[key];
  }
  if (originator) next.originator = originator;
  if (cc.length > 0) next.cc = cc;
  next.operationRecords = operationRecords;
  next.tasks = tasks;
  return next;
};

const capRows = <T>(rows: T[]): { items: T[]; truncated: boolean } => {
  if (rows.length <= DINGTALK_APPROVAL_STATE_ROW_LIMIT) return { items: rows, truncated: false };
  return { items: rows.slice(0, DINGTALK_APPROVAL_STATE_ROW_LIMIT), truncated: true };
};

const mergeTruncated = (...flags: Array<boolean | undefined>): boolean | undefined => {
  if (flags.includes(true)) return true;
  if (flags.includes(false)) return false;
  return undefined;
};

const RULE_ACTION_LABEL: Record<string, string> = {
  agree: '同意',
  comment: '评论',
  redirect: '转交',
  refuse: '拒绝',
};

const INSTANCE_STATUS_LABEL: Record<string, string> = {
  COMPLETED: '已完成',
  RUNNING: '审批中',
  TERMINATED: '已撤销',
};

const mapApprovalListItem = (value: unknown): ApprovalListRow | undefined => {
  if (!isRecord(value)) return undefined;
  const processInstanceId = optionalString(value.processInstanceId);
  const title =
    optionalString(value.title) ?? optionalString(value.processName) ?? processInstanceId;
  if (!title) return undefined;
  const taskId =
    optionalString(value.taskId) ??
    (typeof value.taskId === 'number' ? String(value.taskId) : undefined);
  return {
    createdAt: asIsoString(value.createdAt),
    originatorName: optionalString(value.originatorName),
    processInstanceId,
    processName: optionalString(value.processName),
    ...(taskId ? { taskId } : {}),
    title,
  };
};

const mapRuleListItem = (value: unknown): ApprovalRuleListRow | undefined => {
  if (!isRecord(value)) return undefined;
  const id = optionalString(value.id);
  const name = optionalString(value.name);
  if (!id && !name) return undefined;
  const action = optionalString(value.action);
  return {
    actionLabel:
      optionalString(value.actionLabel) ??
      (action ? (RULE_ACTION_LABEL[action] ?? action) : undefined),
    enabled: typeof value.enabled === 'boolean' ? value.enabled : undefined,
    expiresAt: asIsoString(value.expiresAt),
    id,
    name,
    processName: optionalString(value.processName),
  };
};

const mapSchemaField = (value: unknown): TemplateSchemaFieldRow | undefined => {
  if (!isRecord(value)) return undefined;
  const label = optionalString(value.label);
  if (!label) return undefined;
  const props = isRecord(value.props) ? value.props : undefined;
  const children = Array.isArray(value.children)
    ? value.children.map(mapSchemaField).filter((item): item is TemplateSchemaFieldRow => !!item)
    : undefined;
  const rawOptions = Array.isArray(value.options)
    ? value.options
    : Array.isArray(props?.options)
      ? props.options
      : undefined;
  const options = rawOptions
    ?.map((item) => {
      if (typeof item === 'string' && item) return item;
      if (!isRecord(item)) return undefined;
      return optionalString(item.value) ?? optionalString(item.label);
    })
    .filter((item): item is string => !!item);
  return {
    bizAlias: optionalString(value.bizAlias) ?? optionalString(props?.bizAlias),
    ...(children && children.length > 0 ? { children } : {}),
    componentId:
      optionalString(value.componentId) ??
      optionalString(props?.componentId) ??
      optionalString(props?.id),
    componentType: optionalString(value.componentType),
    format: optionalString(value.format) ?? optionalString(props?.format),
    label,
    ...(options && options.length > 0 ? { options } : {}),
    required: value.required === true || props?.required === true,
    unit: optionalString(value.unit) ?? optionalString(props?.unit),
  };
};

const lineValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(lineValue).filter((item): item is string => !!item);
    return parts.length > 0 ? parts.join('、') : undefined;
  }
  return undefined;
};

const pushLine = (lines: ApprovalDetailLine[], label: string, value: unknown): void => {
  const text = lineValue(value);
  if (!text) return;
  lines.push({ label, value: text });
};

const buildDetailLines = (data: unknown): { lines: ApprovalDetailLine[]; title?: string } => {
  if (!isRecord(data)) return { lines: [] };
  const lines: ApprovalDetailLine[] = [];
  const status = optionalString(data.status);
  const result = optionalString(data.result);
  const statusText = status ? (INSTANCE_STATUS_LABEL[status] ?? status) : undefined;
  if (statusText && result && result !== status) {
    pushLine(lines, '状态', `${statusText} · ${result}`);
  } else {
    pushLine(lines, '状态', statusText ?? result);
  }

  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const handlers = tasks
    .filter(isRecord)
    .filter((task) => optionalString(task.status) === 'RUNNING')
    .map(
      (task) =>
        optionalString(task.name) ??
        optionalString(task.showName) ??
        optionalString(task.userName) ??
        optionalString(task.staffToken),
    )
    .filter((item): item is string => !!item);
  if (handlers.length > 0) {
    pushLine(lines, '当前处理人', [...new Set(handlers)].join('、'));
  }

  const formPairs =
    Array.isArray(data.summary) && data.summary.length > 0
      ? data.summary
      : Array.isArray(data.formComponentValues)
        ? data.formComponentValues
        : [];
  for (const item of formPairs) {
    if (!isRecord(item)) continue;
    const label = optionalString(item.label) ?? optionalString(item.name);
    if (!label) continue;
    pushLine(lines, label, item.value);
  }

  return { lines, title: optionalString(data.title) };
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

const ok = (content: string, state: unknown): BuiltinServerRuntimeOutput => ({
  content,
  state,
  success: true,
});

const RAW_USER_KEYS = new Set(['ccUserIds', 'ccUsers', 'originatorUserId', 'userId']);

const stripRawUserIds = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripRawUserIds);
  if (!isRecord(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (RAW_USER_KEYS.has(key)) continue;
    next[key] = stripRawUserIds(item);
  }
  return next;
};

const readOk = (payload: unknown, state: object, prefix = ''): BuiltinServerRuntimeOutput => {
  const fitted = fitUnknown(stripRawUserIds(payload));
  const truncated = isRecord(fitted) && fitted.truncated === true;
  return {
    content: `${prefix}${compactJson(fitted)}`,
    state: truncated ? { ...state, truncated: true } : state,
    success: true,
  };
};

/**
 * DingTalk approval execution runtime. Accepts IDingtalkApprovalService
 * (or a test double) via constructor injection — no React, no Zustand,
 * no `@/services` imports.
 */
export class DingtalkApprovalExecutionRuntime {
  constructor(private service: IDingtalkApprovalService) {}

  async listTemplates(args: ListTemplatesParams = {}): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.service.listTemplates(args);
      const mapped = asList(data);
      const capped = capRows(mapped);
      const truncated = mergeTruncated(capped.truncated || undefined);
      const state: ListTemplatesState = {
        count: mapped.length,
        items: capped.items,
        success: true,
        truncated,
      };
      return readOk({ count: mapped.length, items: capped.items, truncated }, state);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async getTemplateSchema(args: GetTemplateSchemaParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.service.getTemplateSchema(args);
      const source = isRecord(data) && Array.isArray(data.fields) ? data.fields : [];
      const mapped = source
        .map(mapSchemaField)
        .filter((item): item is TemplateSchemaFieldRow => !!item);
      const capped = capRows(mapped);
      const processCode = pickString(data, ['processCode']) ?? args.processCode;
      const state: GetTemplateSchemaState = {
        fields: capped.items,
        processCode,
        success: true,
        truncated: mergeTruncated(capped.truncated || undefined),
      };
      return readOk(
        {
          fields: mapped,
          name: pickString(data, ['name']),
          processCode,
        },
        state,
      );
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async listPendingApprovals(
    args: ListPendingApprovalsParams = {},
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.service.listPendingApprovals(args);
      const mapped = asList(data)
        .map(mapApprovalListItem)
        .filter((item): item is ApprovalListRow => !!item);
      const capped = capRows(mapped);
      const serviceTruncated = truncatedFlag(data);
      const truncated = mergeTruncated(serviceTruncated, capped.truncated || undefined);
      const state: ListPendingApprovalsState = {
        count: mapped.length,
        items: capped.items,
        success: true,
        truncated,
      };
      const note =
        serviceTruncated === true
          ? '列表可能不完整（truncated=true）。标准版无待办列表接口，结果来自有界扫描。\n'
          : '';
      return readOk({ count: mapped.length, items: capped.items, truncated }, state, note);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async listMyApplications(
    args: ListMyApplicationsParams = {},
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.service.listMyApplications(args);
      const mapped = asList(data)
        .map(mapApprovalListItem)
        .filter((item): item is ApprovalListRow => !!item);
      const capped = capRows(mapped);
      const truncated = mergeTruncated(truncatedFlag(data), capped.truncated || undefined);
      const state: ListMyApplicationsState = {
        count: mapped.length,
        items: capped.items,
        success: true,
        truncated,
      };
      return readOk({ count: mapped.length, items: capped.items, truncated }, state);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async getApprovalDetail(args: GetApprovalDetailParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.service.getApprovalDetail(args);
      const presented = presentApprovalDetail(data);
      const { lines, title } = buildDetailLines(presented);
      const capped = capRows(lines);
      const processInstanceId =
        pickString(presented, ['processInstanceId']) ??
        pickString(data, ['processInstanceId']) ??
        args.processInstanceId;
      const state: GetApprovalDetailState = {
        lines: capped.items,
        processInstanceId,
        success: true,
        title,
        truncated: mergeTruncated(capped.truncated || undefined),
      };
      return readOk({ ...presented, processInstanceId }, state);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async searchDirectory(args: SearchDirectoryParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.searchDirectory(args);
      const allUsers = result.users ?? [];
      const allDepartments = result.departments ?? [];
      const users = capRows(allUsers).items;
      const departments = capRows(allDepartments).items;
      const userCapped = allUsers.length > DINGTALK_APPROVAL_STATE_ROW_LIMIT;
      const deptCapped = allDepartments.length > DINGTALK_APPROVAL_STATE_ROW_LIMIT;
      const ambiguous = hasAmbiguousUsers(allUsers, result.ambiguous);
      const payload = {
        ambiguous,
        departments: departments.map((dept) => ({
          deptId: dept.deptId,
          memberCount: dept.memberCount,
          name: dept.name,
          pathNames: dept.pathNames,
        })),
        users: users.map((user) => ({
          active: user.active,
          deptPath: user.deptPath,
          leafDeptName: user.leafDeptName,
          name: user.name,
          staffToken: toStaffToken(user.staffId),
        })),
      };
      const listed = users.map((user) =>
        formatCandidateLabel({
          deptPath: user.deptPath,
          leafDeptName: user.leafDeptName,
          name: user.name,
          staffId: user.staffId,
        }),
      );
      const instruction = ambiguous
        ? `存在同名人员，请列出「姓名 · 部门」请用户选择后再写入参数，不要猜测。候选：${listed.join('、')}。`
        : '请将返回的 staff:<id> token 原样传入写接口（逐字复制，不要改写汉字）。';
      const state: SearchDirectoryState = {
        ambiguous,
        departmentCount: allDepartments.length,
        hits: { departments, users },
        success: true,
        truncated: mergeTruncated(userCapped || undefined, deptCapped || undefined),
        userCount: allUsers.length,
      };
      return readOk(payload, state, `${instruction}\n`);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async listApprovalRules(args: ListApprovalRulesParams = {}): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.service.listApprovalRules(args);
      const mapped = asList(data)
        .map(mapRuleListItem)
        .filter((item): item is ApprovalRuleListRow => !!item);
      const capped = capRows(mapped);
      const truncated = mergeTruncated(capped.truncated || undefined);
      const state: ListApprovalRulesState = {
        count: mapped.length,
        items: capped.items,
        success: true,
        truncated,
      };
      return readOk({ count: mapped.length, items: capped.items, truncated }, state);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async submitApproval(args: SubmitApprovalParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.service.submitApproval(args);
      const processInstanceId = pickString(data, ['processInstanceId', 'instanceId']) ?? undefined;
      const state: SubmitApprovalState = { processInstanceId, success: true };
      return ok(`已提交审批\n${compactJson({ processInstanceId, result: data })}`, state);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async approveTask(args: ApproveTaskParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.service.approveTask(args);
      const state: ApproveTaskState = { success: true, taskId: args.taskId };
      return ok(`已同意该审批任务\n${compactJson({ result: data, taskId: args.taskId })}`, state);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async refuseTask(args: RefuseTaskParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.service.refuseTask(args);
      const state: RefuseTaskState = { success: true, taskId: args.taskId };
      return ok(`已拒绝该审批任务\n${compactJson({ result: data, taskId: args.taskId })}`, state);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async transferTask(args: TransferTaskParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.service.transferTask(args);
      const state: TransferTaskState = { success: true, taskId: args.taskId };
      return ok(`已转交该审批任务\n${compactJson({ result: data, taskId: args.taskId })}`, state);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async commentApproval(args: CommentApprovalParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.service.commentApproval(args);
      const state: CommentApprovalState = {
        processInstanceId: args.processInstanceId,
        success: true,
      };
      return ok(
        `已添加评论\n${compactJson({ processInstanceId: args.processInstanceId, result: data })}`,
        state,
      );
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async withdrawApplication(args: WithdrawApplicationParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.service.withdrawApplication(args);
      const state: WithdrawApplicationState = {
        processInstanceId: args.processInstanceId,
        success: true,
      };
      return ok(
        `已撤销该审批单\n${compactJson({ processInstanceId: args.processInstanceId, result: data })}`,
        state,
      );
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async returnTask(args: ReturnTaskParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.service.returnTask(args);
      const state: ReturnTaskState = { success: true, taskId: args.taskId };
      return ok(`已退回该审批任务\n${compactJson({ result: data, taskId: args.taskId })}`, state);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async addApprover(args: AddApproverParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.service.addApprover(args);
      const state: AddApproverState = { success: true, taskId: args.taskId };
      return ok(`已加签\n${compactJson({ result: data, taskId: args.taskId })}`, state);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async saveTemplate(args: SaveTemplateParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.service.saveTemplate(args);
      const processCode = pickString(data, ['processCode']) ?? args.processCode;
      const notes =
        isRecord(data) && Array.isArray(data.notes) ? (data.notes as string[]) : undefined;
      const state: SaveTemplateState = { notes, processCode, success: true };
      const noteLine =
        notes && notes.length > 0
          ? `审批流、可见范围等仍需在钉钉管理后台配置：${notes.join('；')}\n`
          : '审批流、可见范围、抄送等无法通过接口配置，请提醒用户在钉钉管理后台补全。\n';
      return ok(`${noteLine}${compactJson({ notes, processCode, result: data })}`, state);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async deleteTemplate(args: DeleteTemplateParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.service.deleteTemplate(args);
      const state: DeleteTemplateState = { processCode: args.processCode, success: true };
      return ok(
        `已删除审批模板\n${compactJson({ processCode: args.processCode, result: data })}`,
        state,
      );
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async createApprovalRule(
    args: CreateApprovalRuleRuntimeInput,
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.service.createApprovalRule(args);
      const ruleId = pickString(data, ['id', 'ruleId']);
      const state: CreateApprovalRuleState = { ruleId, success: true };
      return ok(`已创建自动审批规则\n${compactJson({ result: data, ruleId })}`, state);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async updateApprovalRule(args: UpdateApprovalRuleParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.service.updateApprovalRule(args);
      const state: UpdateApprovalRuleState = { ruleId: args.id, success: true };
      return ok(`已更新自动审批规则\n${compactJson({ result: data, ruleId: args.id })}`, state);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }

  async deleteApprovalRule(args: DeleteApprovalRuleParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.service.deleteApprovalRule(args);
      const state: DeleteApprovalRuleState = { ruleId: args.id, success: true };
      return ok(`已删除自动审批规则\n${compactJson({ result: data, ruleId: args.id })}`, state);
    } catch (error) {
      return dingtalkFailureResult(error);
    }
  }
}

export const createDingtalkApprovalRuntime = (service: IDingtalkApprovalService) =>
  new DingtalkApprovalExecutionRuntime(service);
