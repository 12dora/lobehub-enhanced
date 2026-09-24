import {
  APP_LINK_PATHS,
  buildAppUrl,
  buildDingTalkAppUrl,
  markdownLink,
} from '@lobechat/utils/appLink';

export interface DingtalkWorkspacePreviewLine {
  label: string;
  value: string;
}

export interface DingtalkWorkspacePreview {
  actingAs: { deptPath: string; name: string };
  danger: boolean;
  lines: DingtalkWorkspacePreviewLine[];
  title: string;
  warnings: string[];
}

export interface DingtalkTodoIdentity {
  name: string;
  staffId: string;
  unionId: string;
}

export interface DingtalkTodoListInput {
  done?: boolean;
  /** Bypass the 5-minute merged cache. Does not retry a remembered-unavailable org read. */
  refresh?: boolean;
}

export interface DingtalkTodoCreateInput {
  description?: string;
  dueTime?: string;
  executorTokens?: string[];
  priority?: 10 | 20 | 30 | 40;
  subject: string;
}

export interface DingtalkTodoUpdateInput {
  description?: string;
  done?: boolean;
  dueTime?: string | null;
  executorTokens?: string[];
  priority?: 10 | 20 | 30 | 40;
  subject?: string;
  taskId: string;
}

export interface DingtalkTodoIdInput {
  taskId: string;
}

export interface DingtalkTodoCard {
  createdTime?: number;
  creatorId?: string;
  done: boolean;
  dueTime?: number;
  modifiedTime?: number;
  priority?: number;
  sourceId?: string;
  subject: string;
  taskId: string;
  todoType?: string;
}

export type DingtalkMergedTodoSource = 'assistant' | 'org' | 'personal';

export interface DingtalkMergedTodoCard extends DingtalkTodoCard {
  source: DingtalkMergedTodoSource;
  /** dws `finalStatusStage`. Set on source `personal`. */
  stage?: number;
}

export interface DingtalkMergedApprovalItem {
  /** 时间 */
  createdAt?: string;
  /** 发起人 */
  originatorName?: string;
  processInstanceId: string;
  source: 'approval';
  taskId: string;
  title: string;
}

export interface DingtalkMergedApprovals {
  count: number;
  items: DingtalkMergedApprovalItem[];
  truncated: boolean;
}

/**
 * Shown to the model when organizations/tasks/query cannot be read.
 * Relay once, in one sentence.
 */
export const ORG_TODO_UNAVAILABLE_NOTE =
  '你在钉钉客户端里自己创建的待办，以及其他应用推送的待办，钉钉未向本系统开放读取（需专属钉钉的待办读权限），这里只包含：待我审批的流程、由本助手创建的待办。';

/** Personal todo.list was merged. Replaces {@link ORG_TODO_UNAVAILABLE_NOTE}. */
export const PERSONAL_TODO_MERGED_NOTE = '已包含你在钉钉里的全部待办（经你授权读取）';

/**
 * Shown instead of {@link ORG_TODO_UNAVAILABLE_NOTE} when personal todos are
 * enabled but the caller has not authorized (or the authorization expired).
 * `platform === 'dingtalk'` wraps the link in the SSO bridge.
 */
export const personalTodoAuthNote = (appUrl?: string | null, platform?: string | null): string => {
  const url =
    platform === 'dingtalk'
      ? buildDingTalkAppUrl(appUrl, APP_LINK_PATHS.dingtalkPersonalAuthorize)
      : buildAppUrl(appUrl, APP_LINK_PATHS.dingtalkPersonalAuthorize);
  return `授权「钉钉个人数据」后可查看你在钉钉客户端里的全部待办：${markdownLink('点此前往授权', url)}`;
};

/** Personal read failed. The rest of listTodos is still returned. */
export const PERSONAL_TODO_ERROR_NOTE = '暂时无法读取你在钉钉客户端里的待办，本次结果不含这部分。';

export interface DingtalkTodoListResult {
  approvals: DingtalkMergedApprovals;
  appTodos: DingtalkMergedTodoCard[];
  notes: string[];
  /** Present only when Custom.Todo.Read is available. Omitted when the gate is closed. */
  orgTodos?: DingtalkMergedTodoCard[];
  /**
   * Todos from the caller's 钉钉个人数据 authorization.
   * Omitted unless that read was merged. Same taskId as an assistant todo is dropped.
   */
  personalTodos?: DingtalkMergedTodoCard[];
  truncated: boolean;
}

export const TODO_WRITE_API_NAMES = [
  'createTodo',
  'updateTodo',
  'completeTodo',
  'completeTodos',
  'deleteTodo',
  'deleteTodos',
] as const;

export type TodoWriteApiName = (typeof TODO_WRITE_API_NAMES)[number];

export const isTodoWriteApiName = (value: string): value is TodoWriteApiName =>
  (TODO_WRITE_API_NAMES as readonly string[]).includes(value);
