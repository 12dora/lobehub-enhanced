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

export interface DingtalkTodoListResult {
  items: DingtalkTodoCard[];
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
