import type { LobeChatDatabase } from '@/database/type';

import type { VerifiedDingtalkIdentity } from '../identity';

export type { VerifiedDingtalkIdentity };

export type ApprovalTaskResult = 'agree' | 'refuse';

export type ApprovalInstanceStatus = 'RUNNING' | 'TERMINATED' | 'COMPLETED';

export interface TemplateFieldOption {
  key?: string;
  value: string;
}

export interface TemplateField {
  bizAlias?: string;
  children?: TemplateField[];
  componentId: string;
  componentType: string;
  format?: string;
  hidden?: boolean;
  label: string;
  /** Key+value pairs from DingTalk; create-instance submits `value` text. */
  optionItems?: TemplateFieldOption[];
  /** Human-readable option values (not raw JSON / not option keys). */
  options?: string[];
  required: boolean;
  unit?: string;
}

export interface TemplateSchema {
  bizType?: string;
  fields: TemplateField[];
  name: string;
  processCode: string;
}

export interface VisibleTemplate {
  iconUrl?: string;
  /** Present when the visible-templates payload carries gmtModified / modifiedTime. */
  modifiedAt?: string;
  name: string;
  processCode: string;
}

export interface FormValueInput {
  componentId?: string;
  label?: string;
  value: unknown;
}

export interface EncodedFormComponentValue {
  componentType?: string;
  id?: string;
  name: string;
  value: string;
}

export interface ApprovalFormSummaryItem {
  label: string;
  value: string;
}

export interface PendingApprovalRow {
  createdAt?: string;
  originatorName?: string;
  processInstanceId: string;
  processName?: string;
  summary: ApprovalFormSummaryItem[];
  taskId: string;
  title: string;
}

export interface InitiatedApprovalRow {
  createdAt?: string;
  originatorName?: string;
  processInstanceId: string;
  processName?: string;
  result?: string;
  status?: string;
  summary: ApprovalFormSummaryItem[];
  title: string;
}

export type ApprovalScanIncompleteReason = 'cap' | 'rate_limited' | 'time_budget';

export interface ApprovalScanIncomplete {
  reason: ApprovalScanIncompleteReason;
  scannedTemplates: number;
  totalTemplates: number;
}

export interface ApprovalListResult<T> {
  incomplete?: ApprovalScanIncomplete;
  rows: T[];
  truncated: boolean;
}

export interface ProcessInstancePerson {
  name?: string;
  userId: string;
}

export interface ProcessInstanceTask {
  activityId?: string;
  createTime?: string;
  finishTime?: string;
  name?: string;
  processInstanceId?: string;
  result?: string;
  status: string;
  taskId: string;
  userId: string;
}

export interface ProcessInstanceOperationRecord {
  activityId?: string;
  ccUserIds?: string[];
  ccUsers?: ProcessInstancePerson[];
  date?: string;
  name?: string;
  remark?: string;
  result?: string;
  showName?: string;
  type?: string;
  userId?: string;
}

export interface ProcessInstanceFormValue {
  bizAlias?: string;
  componentType?: string;
  extValue?: string;
  id?: string;
  name?: string;
  value?: string;
}

export interface ProcessInstanceDetail {
  businessId?: string;
  ccUserIds: string[];
  ccUsers?: ProcessInstancePerson[];
  createTime?: string;
  finishTime?: string;
  formComponentValues: ProcessInstanceFormValue[];
  operationRecords: ProcessInstanceOperationRecord[];
  originatorDeptId?: string;
  originatorDeptName?: string;
  originatorName?: string;
  originatorUserId: string;
  processInstanceId: string;
  result?: string;
  status?: string;
  tasks: ProcessInstanceTask[];
  title: string;
}

export const canViewInstance = (detail: ProcessInstanceDetail, staffId: string): boolean =>
  detail.originatorUserId === staffId ||
  detail.ccUserIds.includes(staffId) ||
  detail.tasks.some((task) => task.userId === staffId);

export interface CreateInstanceInput {
  approverStaffTokens?: string[];
  ccStaffTokens?: string[];
  deptId?: number;
  formValues: FormValueInput[];
  processCode: string;
  targetSelectActioners?: Array<{ actionerKey: string; staffTokens: string[] }>;
}

export interface ExecuteTaskInput {
  processInstanceId: string;
  remark?: string;
  result: ApprovalTaskResult;
  taskId: string | number;
}

export interface RedirectTaskInput {
  processInstanceId: string;
  remark?: string;
  taskId: string | number;
  toStaffToken: string;
}

export interface AddCommentInput {
  processInstanceId: string;
  text: string;
}

export interface TerminateInstanceInput {
  processInstanceId: string;
  remark?: string;
}

export interface RevertTaskInput {
  processInstanceId: string;
  remark?: string;
  revertAction: 'REVERT_FOR_APPROVAL' | 'REVERT_FOR_RESUBMIT';
  targetActivityId: string;
  taskId: string | number;
}

export interface AppendTaskInput {
  activateType?: 'ALL' | 'ONE_BY_ONE';
  agreeAll?: boolean;
  appenderStaffTokens: string[];
  processInstanceId: string;
  remark?: string;
  taskId: string | number;
  type: 'after' | 'before';
}

export interface SaveTemplateFieldInput {
  bizAlias?: string;
  componentId?: string;
  componentType: string;
  format?: string;
  label: string;
  options?: Array<string | TemplateFieldOption>;
  placeholder?: string;
  required?: boolean;
  unit?: string;
}

export interface SaveTemplateInput {
  description?: string;
  fields: SaveTemplateFieldInput[];
  name: string;
  processCode?: string;
}

export interface ApprovalPreviewLine {
  label: string;
  value: string;
}

export interface ApprovalPreview {
  actingAs: { deptPath: string; name: string };
  danger: boolean;
  lines: ApprovalPreviewLine[];
  title: string;
  warnings: string[];
}

export interface ApprovalPreviewInput {
  apiName: string;
  args: Record<string, unknown>;
}

export interface ForecastActivityRule {
  activityId?: string;
  activityName?: string;
  activityType?: string;
  isTargetSelect?: boolean;
  workflowActor?: {
    actorKey?: string;
    actorType?: string;
    required?: boolean;
  };
}

export interface ProcessForecastResult {
  isForecastSuccess?: boolean;
  workflowActivityRules: ForecastActivityRule[];
}

export interface ApprovalServiceContext {
  db: LobeChatDatabase;
  identity: VerifiedDingtalkIdentity;
  userId: string;
}

export const TEMPLATE_CACHE_TTL_MS = 5 * 60_000;
export const PENDING_CACHE_TTL_MS = 60_000;
export const INCOMPLETE_CACHE_TTL_MS = 10_000;
export const PENDING_INSTANCE_CAP = 300;
export const INSTANCE_DETAIL_CONCURRENCY = 2;
export const INSTANCE_IDS_QUERY_CONCURRENCY = 2;
export const SCAN_API_MAX_RPS = 8;
export const SCAN_TIME_BUDGET_MS = 25_000;
export const SCAN_RATE_LIMIT_RETRY_COUNT = 3;
export const SCAN_RATE_LIMIT_BACKOFF_MS = [500, 1000, 2000] as const;
export const INSTANCE_ID_PAGE_SIZE = 20;
export const INSTANCE_ID_HARD_CAP = 10_000;
export const TEMPLATE_PAGE_SIZE = 100;
export const PENDING_LOOKBACK_MS = 30 * 24 * 60 * 60_000;
export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;
export const SUMMARY_FIELD_LIMIT = 6;
export const PREMIUM_TODO_PAGE_SIZE = 20;
export const PREMIUM_TODO_MAX_PAGE = 10;

export const TEMPLATE_CONSOLE_NOTES = [
  'Approval flow, visibility, and template admins cannot be set via API. Finish those in the DingTalk OA admin console.',
] as const;
