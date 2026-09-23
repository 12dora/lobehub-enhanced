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

export type DingtalkMergedTodoSource = 'assistant' | 'org';

export interface DingtalkMergedTodoCard extends DingtalkTodoCard {
  source: DingtalkMergedTodoSource;
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

export interface DingtalkTodoListResult {
  approvals: DingtalkMergedApprovals;
  appTodos: DingtalkMergedTodoCard[];
  notes: string[];
  /** Present only when Custom.Todo.Read is available. Omitted when the gate is closed. */
  orgTodos?: DingtalkMergedTodoCard[];
  truncated: boolean;
}

export const TODO_WRITE_API_NAMES = [
  'createTodo',
  'updateTodo',
  'completeTodo',
  'deleteTodo',
] as const;

export type TodoWriteApiName = (typeof TODO_WRITE_API_NAMES)[number];

export const isTodoWriteApiName = (value: string): value is TodoWriteApiName =>
  (TODO_WRITE_API_NAMES as readonly string[]).includes(value);
