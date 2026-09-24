export const DingtalkPersonalIdentifier = 'lobe-dingtalk-personal';

export const DingtalkPersonalApiName = {
  completeTodo: 'completeTodo',
  completeTodos: 'completeTodos',
  downloadMessageFile: 'downloadMessageFile',
  getReport: 'getReport',
  getReportTemplate: 'getReportTemplate',
  getTodo: 'getTodo',
  listGroupMessages: 'listGroupMessages',
  listMyGroups: 'listMyGroups',
  listMyTodos: 'listMyTodos',
  listReportTemplates: 'listReportTemplates',
  listReports: 'listReports',
  searchGroups: 'searchGroups',
  searchMessages: 'searchMessages',
  submitReport: 'submitReport',
  updateTodo: 'updateTodo',
} as const;

export type DingtalkPersonalApiName =
  (typeof DingtalkPersonalApiName)[keyof typeof DingtalkPersonalApiName];

/** Write APIs — each has humanIntervention: 'always'. */
export const DingtalkPersonalWriteApiNames = [
  DingtalkPersonalApiName.updateTodo,
  DingtalkPersonalApiName.completeTodo,
  DingtalkPersonalApiName.completeTodos,
  DingtalkPersonalApiName.submitReport,
] as const;

export type DingtalkPersonalWriteApiName = (typeof DingtalkPersonalWriteApiNames)[number];

export const DingtalkPersonalTodoPriorityValues = [10, 20, 30, 40] as const;
export type DingtalkPersonalTodoPriority = (typeof DingtalkPersonalTodoPriorityValues)[number];

export const DingtalkPersonalTodoStatuses = ['open', 'done', 'all'] as const;
export type DingtalkPersonalTodoStatus = (typeof DingtalkPersonalTodoStatuses)[number];

export const DingtalkPersonalReportBoxes = ['inbox', 'outbox'] as const;
export type DingtalkPersonalReportBox = (typeof DingtalkPersonalReportBoxes)[number];

export const DingtalkPersonalResourceTypes = ['fileId', 'mediaId'] as const;
export type DingtalkPersonalResourceType = (typeof DingtalkPersonalResourceTypes)[number];

export interface ListMyTodosParams {
  page?: number;
  status?: DingtalkPersonalTodoStatus;
}

export interface GetTodoParams {
  taskId: string;
}

export interface SearchGroupsParams {
  query: string;
}

export interface ListMyGroupsParams {
  cursor?: string;
}

export interface ListGroupMessagesParams {
  conversationId: string;
  /** ISO 8601. Window with endTime is at most 7 days. */
  endTime: string;
  /** 1–500. */
  maxMessages?: number;
  /** ISO 8601. */
  startTime: string;
}

export interface SearchMessagesParams {
  conversationId?: string;
  /** ISO 8601. Together with startTime, the window is at most 7 days. */
  endTime?: string;
  query: string;
  startTime?: string;
}

export interface DownloadMessageFileParams {
  conversationId?: string;
  fileName?: string;
  messageId?: string;
  resourceId: string;
  resourceType: DingtalkPersonalResourceType;
}

export interface ListReportsParams {
  box: DingtalkPersonalReportBox;
  cursor?: number;
  /** ISO 8601. Inbox window ≤ 180 days; outbox window ≤ 20 days. */
  endTime: string;
  startTime: string;
}

export interface GetReportParams {
  reportId: string;
}

/** No model-facing filters. */
export type ListReportTemplatesParams = Record<string, never>;

export interface GetReportTemplateParams {
  name: string;
}

export interface UpdateTodoParams {
  /** ISO 8601 due time. */
  dueTime?: string;
  priority?: DingtalkPersonalTodoPriority;
  taskId: string;
  title?: string;
}

export interface CompleteTodoParams {
  taskId: string;
}

/** 1–20 distinct todo ids. One confirmation completes every id. */
export interface CompleteTodosParams {
  taskIds: string[];
}

export interface SubmitReportContent {
  content: string;
  /** Must equal a template field name from getReportTemplate. */
  key: string;
}

export interface SubmitReportParams {
  contents: SubmitReportContent[];
  templateName: string;
  /** Recipient staff ids (1–20), from lobe-dingtalk-workspace searchDirectory. */
  toUserIds: string[];
}

export interface TodoItem {
  dueTime: number | null;
  priority: number | null;
  stage?: number;
  subject: string;
  taskId: string;
}

export interface ListMyTodosState {
  hasMore: boolean;
  kind: 'todos';
  page: number;
  status: DingtalkPersonalTodoStatus;
  todos: TodoItem[];
}

export interface TodoDetail {
  createdTime?: number;
  creatorName?: string;
  detailUrl?: string;
  dueTime: number | null;
  executorNames: string[];
  isDone: boolean;
  participantNames: string[];
  priority: number | null;
  subject: string;
  taskId: string;
}

export interface TodoDetailState {
  kind: 'todo';
  todo: TodoDetail;
}

export interface GroupItem {
  conversationId: string;
  memberCount?: number;
  name: string;
  type?: string;
}

export interface GroupsState {
  groups: GroupItem[];
  hasMore: boolean;
  kind: 'groups';
  nextCursor?: string;
}

export interface MessageFile {
  name: string;
  resourceId: string;
  resourceType: string;
}

export interface MessageItem {
  createTime: string;
  files: MessageFile[];
  messageId?: string;
  sender: string;
  senderId?: string;
  text: string;
}

export interface MessagesState {
  conversationId?: string;
  count: number;
  endTime?: string;
  hasMore: boolean;
  /** Model-only. Set when a message search has no hits. */
  hint?: string;
  kind: 'messages';
  messages: MessageItem[];
  startTime?: string;
  truncated: boolean;
}

export interface FileState {
  fileId?: string;
  kind: 'file';
  name: string;
  preview?: string;
  sizeBytes: number;
  url?: string;
}

export interface ReportItem {
  createTime?: number;
  creatorName?: string;
  creatorUserId?: string;
  modifiedTime?: number;
  reportId: string;
  templateName?: string;
}

export interface ReportsState {
  box: DingtalkPersonalReportBox;
  complete: boolean;
  kind: 'reports';
  nextCursor?: number;
  reports: ReportItem[];
}

export interface ReportContentItem {
  key: string;
  value: string;
}

export interface ReportDetail {
  contents: ReportContentItem[];
  createTime?: number;
  creatorName?: string;
  deptName?: string;
  name?: string;
  reportId: string;
  templateName?: string;
  url?: string;
}

export interface ReportDetailState {
  kind: 'report';
  report: ReportDetail;
}

export interface ReportTemplateSummary {
  id: string;
  name: string;
}

export interface TemplatesState {
  kind: 'templates';
  templates: ReportTemplateSummary[];
}

export interface ReportTemplateField {
  name: string;
  sort: number;
  type: number;
}

export interface ReportTemplateDetail {
  fields: ReportTemplateField[];
  id: string;
  name: string;
}

export interface TemplateState {
  kind: 'template';
  template: ReportTemplateDetail;
}

export interface WriteState {
  action: DingtalkPersonalWriteApiName;
  kind: 'write';
  reportId?: string;
  summary: string;
  taskId?: string;
}

/**
 * One row of a batch write.
 * `error` is a short Chinese sentence for the user (no codes, API names, or model instructions).
 * The full model sentence stays in the tool `content` only.
 */
export interface BatchWriteItem {
  /** Chinese button label when `actionUrl` is set, e.g. 申请权限 / 去授权 / 前往设置. */
  actionLabel?: string;
  /** Link the user should open. https, or an app-relative path this app generated. */
  actionUrl?: string;
  error?: string;
  /** Stable code, e.g. DINGTALK_PERSONAL_RATE_LIMITED. */
  errorCode?: string;
  id: string;
  ok: boolean;
  title?: string;
}

export interface BatchWriteState {
  action: DingtalkPersonalWriteApiName;
  failed: number;
  items: BatchWriteItem[];
  kind: 'batchWrite';
  succeeded: number;
  summary: string;
  total: number;
}

/**
 * Login card payload. Duplicated here (plain types) so client code can import
 * it from this package without the server module.
 */
export interface DingtalkPersonalLoginView {
  errorCode?: 'IDENTITY_MISMATCH' | 'ORG_CLI_DISABLED' | 'LOGIN_TIMEOUT' | 'LOGIN_FAILED';
  expiresAt: string;
  jobId: string;
  mismatchUserName?: string;
  status: 'pending' | 'succeeded' | 'failed' | 'expired' | 'cancelled';
  userCode: string;
  verificationUrl: string;
}

export interface AuthRequiredState {
  /**
   * URL already embedded in the tool `content` markdown link.
   * DingTalk: device verification URL. Web and other clients: settings deep link.
   */
  authUrl?: string;
  code: string;
  kind: 'authorizationRequired';
  login?: DingtalkPersonalLoginView;
  settingsPath: '/settings/connector';
}

/** Every projected tool state. `kind` selects the render. */
export type DingtalkPersonalToolState =
  | AuthRequiredState
  | BatchWriteState
  | FileState
  | GroupsState
  | ListMyTodosState
  | MessagesState
  | ReportDetailState
  | ReportsState
  | TemplateState
  | TemplatesState
  | TodoDetailState
  | WriteState;

/** Confirm-card preview (lambda `preview`; not a model-facing API). */
export interface DingtalkPersonalPreview {
  danger: boolean;
  lines: string[];
  title: string;
  warnings: string[];
}
