import type { ApprovalRuleAction, ApprovalRuleConditions } from '@lobechat/types';

export type { ApprovalRuleAction, ApprovalRuleConditions } from '@lobechat/types';

export const DingtalkApprovalIdentifier = 'lobe-dingtalk-approval';

export const DingtalkApprovalReadApiName = {
  getApprovalDetail: 'getApprovalDetail',
  getTemplateSchema: 'getTemplateSchema',
  listApprovalRules: 'listApprovalRules',
  listMyApplications: 'listMyApplications',
  listPendingApprovals: 'listPendingApprovals',
  listTemplates: 'listTemplates',
  searchDirectory: 'searchDirectory',
} as const;

export const DingtalkApprovalWriteApiName = {
  addApprover: 'addApprover',
  approveTask: 'approveTask',
  approveTasks: 'approveTasks',
  commentApproval: 'commentApproval',
  createApprovalRule: 'createApprovalRule',
  deleteApprovalRule: 'deleteApprovalRule',
  deleteTemplate: 'deleteTemplate',
  refuseTask: 'refuseTask',
  refuseTasks: 'refuseTasks',
  returnTask: 'returnTask',
  saveTemplate: 'saveTemplate',
  submitApproval: 'submitApproval',
  transferTask: 'transferTask',
  updateApprovalRule: 'updateApprovalRule',
  withdrawApplication: 'withdrawApplication',
} as const;

export const DingtalkApprovalApiName = {
  ...DingtalkApprovalReadApiName,
  ...DingtalkApprovalWriteApiName,
} as const;

export type DingtalkApprovalReadApiNameType =
  (typeof DingtalkApprovalReadApiName)[keyof typeof DingtalkApprovalReadApiName];

export type DingtalkApprovalWriteApiNameType =
  (typeof DingtalkApprovalWriteApiName)[keyof typeof DingtalkApprovalWriteApiName];

export type DingtalkApprovalApiNameType =
  (typeof DingtalkApprovalApiName)[keyof typeof DingtalkApprovalApiName];

export const DINGTALK_APPROVAL_READ_APIS = Object.values(DingtalkApprovalReadApiName);

export const DINGTALK_APPROVAL_WRITE_APIS = Object.values(DingtalkApprovalWriteApiName);

/** Staff token (`staff:<id>`) or a directory name the server resolves. */
export type DingtalkStaffToken = string;

export interface DirectoryUserHit {
  active?: boolean;
  deptPath?: string;
  leafDeptName?: string;
  name: string;
  staffId: string;
}

export interface DirectoryDepartmentHit {
  deptId: string;
  memberCount?: number;
  name: string;
  pathNames?: string;
}

export interface AmbiguousCandidate {
  deptPath?: string;
  leafDeptName?: string;
  name: string;
  staffId: string;
}

export interface ApprovalFormValueInput {
  /** Schema component id. Provide this or `label`. */
  componentId?: string;
  /** Control label. Provide this or `componentId`. */
  label?: string;
  /** Stringified value per DingTalk field type. */
  value: string;
}

export interface TargetSelectActionerInput {
  actionerKey: string;
  actionerStaffTokens: DingtalkStaffToken[];
}

export const SAVE_TEMPLATE_COMPONENT_TYPES = [
  'AddressField',
  'DDAttachment',
  'DDDateField',
  'DDDateRangeField',
  'DDMultiSelectField',
  'DDPhotoField',
  'DDSelectField',
  'DepartmentField',
  'IdCardField',
  'InnerContactField',
  'MoneyField',
  'NumberField',
  'PhoneField',
  'StarRatingField',
  'TableField',
  'TextareaField',
  'TextField',
  'TextNote',
] as const;

export type SaveTemplateComponentType = (typeof SAVE_TEMPLATE_COMPONENT_TYPES)[number];

export interface SaveTemplateFieldProblem {
  componentType: string;
  index: number;
  issue: string;
  label: string;
  suggestion: string;
}

export interface SaveTemplateFieldInput {
  bizAlias?: string;
  /** TableField columns only. One level; nested TableField is rejected. */
  children?: Array<Omit<SaveTemplateFieldInput, 'children'>>;
  componentId?: string;
  componentType: string;
  format?: string;
  label: string;
  options?: string[];
  placeholder?: string;
  required?: boolean;
  unit?: string;
}

export interface ApprovalPreviewLine {
  label: string;
  value: string;
}

export interface ApprovalPreviewActingAs {
  deptPath?: string;
  name: string;
}

/**
 * Server-resolved summary of a write call. Frontend confirm cards read this
 * shape from `dingtalkApprovalService.preview`.
 */
export interface ApprovalPreviewResult {
  actingAs: ApprovalPreviewActingAs;
  danger: boolean;
  lines: ApprovalPreviewLine[];
  title: string;
  warnings: string[];
}

export interface DingtalkApprovalPreviewParams {
  apiName: DingtalkApprovalWriteApiNameType | string;
  args: Record<string, unknown>;
}

export interface ListTemplatesParams {
  q?: string;
}

export interface ListTemplatesState {
  count: number;
  items?: unknown[];
  success: boolean;
  truncated?: boolean;
}

export interface GetTemplateSchemaParams {
  processCode: string;
}

export interface TemplateSchemaFieldRow {
  bizAlias?: string;
  children?: TemplateSchemaFieldRow[];
  componentId?: string;
  componentType?: string;
  format?: string;
  label: string;
  options?: string[];
  required?: boolean;
  unit?: string;
}

/** Person as shown to the model on read APIs. Never a raw DingTalk userId. */
export interface ApprovalPersonRef {
  name?: string;
  staffToken: string;
}

export interface GetTemplateSchemaState {
  fields?: TemplateSchemaFieldRow[];
  processCode?: string;
  success: boolean;
  truncated?: boolean;
}

export interface ListPendingApprovalsParams {
  limit?: number;
  /** Bypass the 5-minute identical-query cache. Only when the user asks to refresh. */
  refresh?: boolean;
}

export interface ApprovalListRow {
  createdAt?: string;
  originatorName?: string;
  processInstanceId?: string;
  processName?: string;
  taskId?: string;
  title: string;
}

/** Present when a standard-edition template scan did not finish every visible template. */
export type ApprovalScanIncompleteReason = 'cap' | 'rate_limited' | 'time_budget';

export interface ApprovalScanIncomplete {
  reason: ApprovalScanIncompleteReason;
  scannedTemplates: number;
  totalTemplates: number;
}

export interface ListPendingApprovalsState {
  count: number;
  incomplete?: ApprovalScanIncomplete;
  items?: ApprovalListRow[];
  success: boolean;
  truncated?: boolean;
}

export interface ListMyApplicationsParams {
  limit?: number;
  status?: 'COMPLETED' | 'RUNNING' | 'TERMINATED';
}

export interface ListMyApplicationsState {
  count: number;
  incomplete?: ApprovalScanIncomplete;
  items?: ApprovalListRow[];
  success: boolean;
  truncated?: boolean;
}

export interface GetApprovalDetailParams {
  processInstanceId: string;
}

export interface ApprovalDetailLine {
  label: string;
  value: string;
}

export interface GetApprovalDetailState {
  lines?: ApprovalDetailLine[];
  processInstanceId?: string;
  success: boolean;
  title?: string;
  truncated?: boolean;
}

export interface SearchDirectoryParams {
  kind?: 'department' | 'user';
  q: string;
}

export interface SearchDirectoryState {
  ambiguous: boolean;
  departmentCount: number;
  hits?: {
    departments: DirectoryDepartmentHit[];
    users: DirectoryUserHit[];
  };
  success: boolean;
  truncated?: boolean;
  userCount: number;
}

export interface ListApprovalRulesParams {
  includeDisabled?: boolean;
}

export interface ApprovalRuleListRow {
  actionLabel?: string;
  enabled?: boolean;
  expiresAt?: string;
  id?: string;
  name?: string;
  processName?: string;
}

export interface ListApprovalRulesState {
  count: number;
  items?: ApprovalRuleListRow[];
  success: boolean;
  truncated?: boolean;
}

export interface SubmitApprovalParams {
  approverStaffTokens?: DingtalkStaffToken[];
  ccStaffTokens?: DingtalkStaffToken[];
  deptId?: number;
  formValues: ApprovalFormValueInput[];
  processCode: string;
  targetSelectActioners?: TargetSelectActionerInput[];
}

export interface SubmitApprovalState {
  processInstanceId?: string;
  success: boolean;
}

export interface ApproveTaskParams {
  processInstanceId: string;
  remark?: string;
  taskId: string;
}

export interface ApproveTaskState {
  success: boolean;
  taskId?: string;
}

export interface RefuseTaskParams {
  processInstanceId: string;
  remark: string;
  taskId: string;
}

export interface RefuseTaskState {
  success: boolean;
  taskId?: string;
}

export interface ApprovalTaskRef {
  processInstanceId: string;
  taskId: string;
}

export interface ApproveTasksParams {
  remark?: string;
  tasks: ApprovalTaskRef[];
}

export interface RefuseTasksParams {
  remark: string;
  tasks: ApprovalTaskRef[];
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
  /** Stable code, e.g. DINGTALK_NOT_TASK_OWNER. */
  errorCode?: string;
  id: string;
  ok: boolean;
  title?: string;
}

export type DingtalkApprovalBatchAction = 'approveTasks' | 'refuseTasks';

export interface BatchWriteState {
  action: DingtalkApprovalBatchAction;
  failed: number;
  items: BatchWriteItem[];
  kind: 'batchWrite';
  succeeded: number;
  summary: string;
  total: number;
}

export interface TransferTaskParams {
  processInstanceId: string;
  remark?: string;
  taskId: string;
  toStaffToken: DingtalkStaffToken;
}

export interface TransferTaskState {
  success: boolean;
  taskId?: string;
}

export interface CommentApprovalParams {
  processInstanceId: string;
  text: string;
}

export interface CommentApprovalState {
  processInstanceId?: string;
  success: boolean;
}

export interface WithdrawApplicationParams {
  processInstanceId: string;
  remark?: string;
}

export interface WithdrawApplicationState {
  processInstanceId?: string;
  success: boolean;
}

export interface ReturnTaskParams {
  processInstanceId: string;
  remark: string;
  revertAction: 'REVERT_FOR_APPROVAL' | 'REVERT_FOR_RESUBMIT';
  targetActivityId: string;
  taskId: string;
}

export interface ReturnTaskState {
  success: boolean;
  taskId?: string;
}

export interface AddApproverParams {
  activateType: 'ALL' | 'ONE_BY_ONE';
  agreeAll?: boolean;
  appenderStaffTokens: DingtalkStaffToken[];
  processInstanceId: string;
  remark?: string;
  taskId: string;
  type: 'after' | 'before';
}

export interface AddApproverState {
  success: boolean;
  taskId?: string;
}

export interface SaveTemplateParams {
  description?: string;
  fields: SaveTemplateFieldInput[];
  name: string;
  processCode?: string;
}

export interface SaveTemplateSavedField {
  componentType?: string;
  label: string;
  required?: boolean;
}

export interface SaveTemplateState {
  adminUrl?: string;
  created?: boolean;
  fields?: SaveTemplateSavedField[];
  name?: string;
  notes?: string[];
  processCode?: string;
  success: boolean;
}

export interface DeleteTemplateParams {
  processCode: string;
}

export interface DeleteTemplateState {
  processCode?: string;
  success: boolean;
}

export interface CreateApprovalRuleParams {
  action: ApprovalRuleAction;
  conditions: ApprovalRuleConditions;
  expiresAt?: string;
  name: string;
  processCode: string;
  processName: string;
  redirectToStaffToken?: DingtalkStaffToken;
  remark?: string;
}

export interface CreateApprovalRuleState {
  ruleId?: string;
  success: boolean;
}

export interface UpdateApprovalRuleParams {
  action?: ApprovalRuleAction;
  conditions?: ApprovalRuleConditions;
  enabled?: boolean;
  expiresAt?: string | null;
  id: string;
  name?: string;
  processCode?: string;
  processName?: string;
  redirectToStaffToken?: DingtalkStaffToken;
  remark?: string;
}

export interface UpdateApprovalRuleState {
  ruleId?: string;
  success: boolean;
}

export interface DeleteApprovalRuleParams {
  id: string;
}

export interface DeleteApprovalRuleState {
  ruleId?: string;
  success: boolean;
}
