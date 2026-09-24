import type { LobeChatDatabase } from '@/database/type';

import { AUDIT_ACTION, AUDIT_TARGET_TYPE } from '../../audit/auditActionCatalog';
import { PlatformAuditService } from '../../platformAudit';
import { assertDingtalkFeature } from '../capabilities';
import { DingtalkWorkspaceError, sanitizeDingtalkApplyUrl } from '../errors';
import { isDingtalkApprovalAdmin, requireVerifiedDingtalkIdentity } from '../identity';
import {
  addCommentAs,
  appendTaskAs,
  deleteFormTemplate,
  executeTaskAs,
  forecastProcess,
  getFormSchema,
  getInstanceDetail,
  redirectTaskAs,
  revertTaskAs,
  saveFormTemplate,
  startProcessInstance,
  terminateProcessInstance,
} from './api';
import { encodeSaveTemplateFields } from './formComponents';
import { encodeFormValues, formSummary, isSuiteTemplate } from './formValues';
import {
  invalidateApprovalInstanceCache,
  invalidateApprovalListCache,
  invalidatePendingCaches,
  listInitiatedApprovals,
  listPendingApprovals,
  loadVisibleTemplatesCached,
} from './pending';
import { buildApprovalPreview } from './preview';
import { attachInstancePersonNames, requireStaff, requireStaffList } from './staff';
import {
  type AddCommentInput,
  type AppendTaskInput,
  type ApprovalListResult,
  type ApprovalPreview,
  type ApprovalPreviewInput,
  canViewInstance,
  type CreateInstanceInput,
  dingtalkTemplateAdminUrl,
  type ExecuteTaskInput,
  type InitiatedApprovalRow,
  type PendingApprovalRow,
  type ProcessInstanceDetail,
  type RedirectTaskInput,
  type RevertTaskInput,
  type SaveTemplateInput,
  type SaveTemplateResult,
  SUMMARY_FIELD_LIMIT,
  TEMPLATE_CACHE_TTL_MS,
  TEMPLATE_CONSOLE_NOTES,
  type TemplateSchema,
  type TerminateInstanceInput,
  type VisibleTemplate,
} from './types';

const runningTaskFor = (detail: ProcessInstanceDetail, staffId: string, taskId: string | number) =>
  detail.tasks.find(
    (task) =>
      task.taskId === String(taskId) && task.userId === staffId && task.status === 'RUNNING',
  );

const appendApprovalAudit = async (input: {
  action:
    | typeof AUDIT_ACTION.DINGTALK_APPROVAL_AGREE
    | typeof AUDIT_ACTION.DINGTALK_APPROVAL_APPEND
    | typeof AUDIT_ACTION.DINGTALK_APPROVAL_COMMENT
    | typeof AUDIT_ACTION.DINGTALK_APPROVAL_CREATE
    | typeof AUDIT_ACTION.DINGTALK_APPROVAL_DELETE_TEMPLATE
    | typeof AUDIT_ACTION.DINGTALK_APPROVAL_REDIRECT
    | typeof AUDIT_ACTION.DINGTALK_APPROVAL_REFUSE
    | typeof AUDIT_ACTION.DINGTALK_APPROVAL_REVERT
    | typeof AUDIT_ACTION.DINGTALK_APPROVAL_SAVE_TEMPLATE
    | typeof AUDIT_ACTION.DINGTALK_APPROVAL_TERMINATE;
  db: LobeChatDatabase;
  name?: string;
  processName?: string;
  targetId: string;
  title?: string;
  userId: string;
}): Promise<void> => {
  const title = input.title?.trim() || undefined;
  const name = input.name?.trim() || undefined;
  const processName = input.processName?.trim() || undefined;
  const afterDiff =
    title || name || processName
      ? {
          ...(name ? { name } : {}),
          ...(processName ? { processName } : {}),
          ...(title ? { title } : {}),
        }
      : null;
  try {
    await new PlatformAuditService(input.db).append({
      action: input.action,
      actorUserId: input.userId,
      afterDiff,
      reason: null,
      result: 'success',
      targetId: input.targetId,
      targetType: AUDIT_TARGET_TYPE.DINGTALK_APPROVAL,
    });
  } catch (error) {
    console.error('[dingtalk.approval] audit append failed', {
      action: input.action,
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
  }
};

const APPROVAL_BATCH_LIMIT = 20;

/** Auth, permission, rate-limit, and org-policy failures stop a batch. A single task miss does not. */
const APPROVAL_BATCH_STOP_CODES = new Set<string>([
  'DINGTALK_NOT_CONFIGURED',
  'DINGTALK_FEATURE_DISABLED',
  'DINGTALK_FORBIDDEN',
  'DINGTALK_PREMIUM_REQUIRED',
  'DINGTALK_RATE_LIMITED',
  'DINGTALK_IDENTITY_UNBOUND',
  'DINGTALK_IDENTITY_UNVERIFIED',
  'DINGTALK_IDENTITY_INACTIVE',
  'DINGTALK_NOT_APPROVAL_ADMIN',
  'DINGTALK_AUTOMATION_OFF',
]);

/** Two consecutive DINGTALK_UNAVAILABLE responses stop the rest of the batch. */
const APPROVAL_BATCH_UNAVAILABLE_STREAK = 2;

export interface ApprovalBatchItem {
  /** Sanitized https://open-dev.dingtalk.com permission-apply link, when DingTalk returned one. */
  applyUrl?: string;
  errorCode?: string;
  id: string;
  ok: boolean;
  skipped?: boolean;
  title?: string;
}

export interface ApprovalBatchResult {
  items: ApprovalBatchItem[];
}

export interface ExecuteTasksInput {
  remark?: string;
  result: 'agree' | 'refuse';
  tasks: Array<{ processInstanceId: string; taskId: string }>;
}

const approvalBatchValidation = (message: string): never => {
  const error = new Error(message);
  Object.assign(error, { code: 'VALIDATION' });
  throw error;
};

const asTaskRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const readApprovalTasks = (
  value: unknown,
): { reason: 'duplicate' | 'invalid' } | { tasks: ExecuteTasksInput['tasks'] } => {
  if (!Array.isArray(value) || value.length < 1 || value.length > APPROVAL_BATCH_LIMIT) {
    return { reason: 'invalid' };
  }
  const seen = new Set<string>();
  const tasks: ExecuteTasksInput['tasks'] = [];
  for (const item of value) {
    const record = asTaskRecord(item);
    const processInstanceId =
      typeof record.processInstanceId === 'string' ? record.processInstanceId : '';
    const taskId = typeof record.taskId === 'string' ? record.taskId : '';
    if (!processInstanceId.trim() || !taskId.trim()) return { reason: 'invalid' };
    const key = `${processInstanceId}\0${taskId}`;
    if (seen.has(key) || seen.has(`task:${taskId}`)) return { reason: 'duplicate' };
    seen.add(key);
    seen.add(`task:${taskId}`);
    tasks.push({ processInstanceId, taskId });
  }
  return { tasks };
};

const requireApprovalTasks = (value: unknown): ExecuteTasksInput['tasks'] => {
  const read = readApprovalTasks(value);
  if ('reason' in read) {
    return approvalBatchValidation(
      read.reason === 'duplicate'
        ? '审批任务不能重复。'
        : '审批任务须为 1 到 20 个互不重复的任务，每项都要有 processInstanceId 和 taskId。',
    );
  }
  return read.tasks;
};

const approvalErrorCodeOf = (error: unknown): string => {
  if (error instanceof DingtalkWorkspaceError) return error.code;
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  if (error instanceof Error) {
    const match = /DINGTALK_[A-Z_]+/.exec(error.message);
    if (match) return match[0];
  }
  return 'DINGTALK_INTERNAL';
};

const readBatchApplyUrl = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object' || !('applyUrl' in error)) return undefined;
  return sanitizeDingtalkApplyUrl((error as { applyUrl?: unknown }).applyUrl);
};

const attachInstanceTitle = (error: unknown, title?: string): void => {
  const trimmed = title?.trim();
  if (!trimmed || !error || typeof error !== 'object') return;
  Object.assign(error, { instanceTitle: trimmed });
};

const instanceTitleOf = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object' || !('instanceTitle' in error)) return undefined;
  const value = (error as { instanceTitle?: unknown }).instanceTitle;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

/** Domain failures stay quiet. Anything else is unexpected and must show up in logs. */
const logUnexpectedApprovalBatchError = (error: unknown): void => {
  if (error instanceof DingtalkWorkspaceError) return;
  const code = approvalErrorCodeOf(error);
  if (code.startsWith('DINGTALK_') && code !== 'DINGTALK_INTERNAL') return;
  console.error('[dingtalk.approval] batch item failed', {
    code,
    errorClass: error instanceof Error ? error.name : 'UnknownError',
  });
};

const cachedTemplateName = async (
  userId: string,
  staffId: string,
  processCode: string,
): Promise<string | undefined> => {
  try {
    const templates = await loadVisibleTemplatesCached(userId, staffId, TEMPLATE_CACHE_TTL_MS);
    return templates.find((item) => item.processCode === processCode)?.name;
  } catch {
    return undefined;
  }
};

export class DingtalkApprovalService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  private prepare = async () => {
    await assertDingtalkFeature('approval');
    const identity = await requireVerifiedDingtalkIdentity(this.db, this.userId);
    return identity;
  };

  private templates = async (staffId: string, refresh = false): Promise<VisibleTemplate[]> =>
    loadVisibleTemplatesCached(this.userId, staffId, TEMPLATE_CACHE_TTL_MS, refresh);

  private requireApprovalAdmin = async (staffId: string): Promise<void> => {
    const isAdmin = await isDingtalkApprovalAdmin(staffId);
    if (!isAdmin) throw new DingtalkWorkspaceError('DINGTALK_NOT_APPROVAL_ADMIN');
  };

  private refetchOwnedTask = async (
    staffId: string,
    processInstanceId: string,
    taskId: string | number,
  ) => {
    const detail = await getInstanceDetail(processInstanceId, { fresh: true });
    const task = runningTaskFor(detail, staffId, taskId);
    if (!task) {
      const error = new DingtalkWorkspaceError('DINGTALK_NOT_TASK_OWNER');
      attachInstanceTitle(error, detail.title);
      throw error;
    }
    return { detail, task };
  };

  listTemplates = async (input?: { q?: string }): Promise<VisibleTemplate[]> => {
    const identity = await this.prepare();
    const templates = await this.templates(identity.staffId);
    const q = input?.q?.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (item) => item.name.toLowerCase().includes(q) || item.processCode.toLowerCase().includes(q),
    );
  };

  getTemplateSchema = async (processCode: string): Promise<TemplateSchema> => {
    await this.prepare();
    return getFormSchema(processCode);
  };

  listPending = async (input?: {
    limit?: number;
    refresh?: boolean;
  }): Promise<ApprovalListResult<PendingApprovalRow>> => {
    const identity = await this.prepare();
    const templates = await this.templates(identity.staffId, input?.refresh === true);
    return listPendingApprovals({
      db: this.db,
      limit: input?.limit,
      refresh: input?.refresh,
      staffId: identity.staffId,
      templates,
      userId: this.userId,
    });
  };

  listInitiated = async (input?: {
    limit?: number;
    processCode?: string;
    q?: string;
    status?: string;
  }): Promise<ApprovalListResult<InitiatedApprovalRow>> => {
    const identity = await this.prepare();
    const templates = await this.templates(identity.staffId);
    return listInitiatedApprovals({
      db: this.db,
      limit: input?.limit,
      processCode: input?.processCode,
      q: input?.q,
      staffId: identity.staffId,
      status: input?.status,
      templates,
      userId: this.userId,
    });
  };

  getInstance = async (
    processInstanceId: string,
  ): Promise<ProcessInstanceDetail & { summary: Array<{ label: string; value: string }> }> => {
    const identity = await this.prepare();
    const detail = await getInstanceDetail(processInstanceId);
    if (!canViewInstance(detail, identity.staffId)) {
      throw new DingtalkWorkspaceError('DINGTALK_FORBIDDEN');
    }
    const named = await attachInstancePersonNames(this.db, detail);
    return { ...named, summary: formSummary(named.formComponentValues, SUMMARY_FIELD_LIMIT) };
  };

  createInstance = async (input: CreateInstanceInput): Promise<{ instanceId: string }> => {
    const identity = await this.prepare();
    const schema = await getFormSchema(input.processCode);
    if (isSuiteTemplate(schema)) throw new DingtalkWorkspaceError('DINGTALK_INVALID');
    const formComponentValues = encodeFormValues(schema, input.formValues);

    const approvers = input.approverStaffTokens?.length
      ? (await requireStaffList(this.db, input.approverStaffTokens)).map((staff) => ({
          actionType: 'NONE' as const,
          userIds: [staff.staffId],
        }))
      : undefined;
    const ccList = input.ccStaffTokens?.length
      ? (await requireStaffList(this.db, input.ccStaffTokens)).map((staff) => staff.staffId)
      : undefined;

    let targetSelectActioners:
      Array<{ actionerKey: string; actionerUserIds: string[] }> | undefined;
    if (input.targetSelectActioners?.length) {
      targetSelectActioners = [];
      for (const item of input.targetSelectActioners) {
        const staff = await requireStaffList(this.db, item.staffTokens);
        targetSelectActioners.push({
          actionerKey: item.actionerKey,
          actionerUserIds: staff.map((row) => row.staffId),
        });
      }
    }

    const deptId = approvers ? input.deptId : (input.deptId ?? -1);
    if (!approvers) {
      const forecast = await forecastProcess({
        deptId: deptId ?? -1,
        formComponentValues,
        processCode: input.processCode,
        userId: identity.staffId,
      });
      const requiredSelects = forecast.workflowActivityRules.filter(
        (rule) =>
          (rule.isTargetSelect || rule.activityType === 'target_select') &&
          rule.workflowActor?.required !== false,
      );
      for (const rule of requiredSelects) {
        const key = rule.workflowActor?.actorKey;
        const provided = targetSelectActioners?.some((item) => item.actionerKey === key);
        if (key && !provided) throw new DingtalkWorkspaceError('DINGTALK_INVALID');
      }
    }

    const created = await startProcessInstance({
      approvers,
      ccList: approvers ? ccList : undefined,
      ccPosition: approvers && ccList?.length ? 'START_FINISH' : undefined,
      deptId,
      formComponentValues,
      originatorUserId: identity.staffId,
      processCode: input.processCode,
      targetSelectActioners,
    });

    invalidatePendingCaches(this.userId);
    await appendApprovalAudit({
      action: AUDIT_ACTION.DINGTALK_APPROVAL_CREATE,
      db: this.db,
      targetId: created.instanceId,
      title: schema.name,
      userId: this.userId,
    });
    return created;
  };

  /**
   * Ownership check, pacing (via getInstanceDetail), and the execute call.
   * The pending-list cache stays with the caller so a batch can drop it once.
   * A failed execute drops that instance's detail cache here as well.
   */
  private performExecute = async (
    input: ExecuteTaskInput,
  ): Promise<{ result: boolean; title?: string }> => {
    const identity = await this.prepare();
    const { detail } = await this.refetchOwnedTask(
      identity.staffId,
      input.processInstanceId,
      input.taskId,
    );
    const title = detail.title?.trim() || undefined;
    if (input.result === 'refuse' && !input.remark?.trim()) {
      const error = new DingtalkWorkspaceError('DINGTALK_INVALID');
      attachInstanceTitle(error, title);
      throw error;
    }
    try {
      const result = await executeTaskAs(identity.staffId, input);
      return { result: result.result, title };
    } catch (error) {
      invalidateApprovalInstanceCache(input.processInstanceId);
      attachInstanceTitle(error, title);
      throw error;
    }
  };

  private auditExecute = async (input: ExecuteTaskInput, title?: string): Promise<void> => {
    await appendApprovalAudit({
      action:
        input.result === 'agree'
          ? AUDIT_ACTION.DINGTALK_APPROVAL_AGREE
          : AUDIT_ACTION.DINGTALK_APPROVAL_REFUSE,
      db: this.db,
      targetId: input.processInstanceId,
      title,
      userId: this.userId,
    });
  };

  executeTask = async (input: ExecuteTaskInput): Promise<{ result: boolean }> => {
    const performed = await this.performExecute(input);
    // May become async when the pending cache moves to Redis.
    await Promise.resolve(invalidatePendingCaches(this.userId));
    await this.auditExecute(input, performed.title);
    return { result: performed.result };
  };

  /**
   * Sequential agree/refuse. Each item reuses performExecute, so instance-detail
   * pacing between tasks is the same as N single calls. The pending cache is
   * dropped once, after at least one write landed.
   */
  executeTasks = async (input: ExecuteTasksInput): Promise<ApprovalBatchResult> => {
    const tasks = requireApprovalTasks(input?.tasks);
    if (input?.result === 'refuse' && !input.remark?.trim()) {
      approvalBatchValidation('拒绝审批必须填写意见。');
    }
    const items: ApprovalBatchItem[] = [];
    let stop = false;
    let wrote = false;
    let unavailableStreak = 0;
    for (const task of tasks) {
      if (stop) {
        items.push({ id: task.taskId, ok: false, skipped: true });
        continue;
      }
      const single: ExecuteTaskInput = {
        processInstanceId: task.processInstanceId,
        remark: input.remark,
        result: input.result,
        taskId: task.taskId,
      };
      try {
        const performed = await this.performExecute(single);
        wrote = true;
        unavailableStreak = 0;
        await this.auditExecute(single, performed.title);
        items.push({
          id: task.taskId,
          ok: true,
          ...(performed.title ? { title: performed.title } : {}),
        });
      } catch (error) {
        const code = approvalErrorCodeOf(error);
        const applyUrl = readBatchApplyUrl(error);
        const title = instanceTitleOf(error);
        items.push({
          ...(applyUrl ? { applyUrl } : {}),
          errorCode: code,
          id: task.taskId,
          ok: false,
          ...(title ? { title } : {}),
        });
        logUnexpectedApprovalBatchError(error);
        if (code === 'DINGTALK_UNAVAILABLE') {
          unavailableStreak += 1;
          if (unavailableStreak >= APPROVAL_BATCH_UNAVAILABLE_STREAK) stop = true;
        } else {
          unavailableStreak = 0;
          if (APPROVAL_BATCH_STOP_CODES.has(code)) stop = true;
        }
      }
    }
    if (wrote) await Promise.resolve(invalidatePendingCaches(this.userId));
    return { items };
  };

  redirectTask = async (input: RedirectTaskInput): Promise<{ result: boolean }> => {
    const identity = await this.prepare();
    const { detail } = await this.refetchOwnedTask(
      identity.staffId,
      input.processInstanceId,
      input.taskId,
    );
    const target = await requireStaff(this.db, input.toStaffToken);
    const result = await redirectTaskAs(identity.staffId, {
      remark: input.remark,
      taskId: input.taskId,
      toUserId: target.staffId,
    });
    invalidatePendingCaches(this.userId);
    invalidateApprovalInstanceCache(input.processInstanceId);
    await appendApprovalAudit({
      action: AUDIT_ACTION.DINGTALK_APPROVAL_REDIRECT,
      db: this.db,
      targetId: input.processInstanceId,
      title: detail.title,
      userId: this.userId,
    });
    return result;
  };

  addComment = async (input: AddCommentInput): Promise<{ result: boolean }> => {
    const identity = await this.prepare();
    const detail = await getInstanceDetail(input.processInstanceId);
    if (!canViewInstance(detail, identity.staffId)) {
      throw new DingtalkWorkspaceError('DINGTALK_FORBIDDEN');
    }
    const text = input.text.trim();
    if (!text) throw new DingtalkWorkspaceError('DINGTALK_INVALID');
    const result = await addCommentAs(identity.staffId, {
      processInstanceId: input.processInstanceId,
      text,
    });
    await appendApprovalAudit({
      action: AUDIT_ACTION.DINGTALK_APPROVAL_COMMENT,
      db: this.db,
      targetId: input.processInstanceId,
      title: detail.title,
      userId: this.userId,
    });
    return result;
  };

  terminateInstance = async (input: TerminateInstanceInput): Promise<void> => {
    const identity = await this.prepare();
    const detail = await getInstanceDetail(input.processInstanceId);
    if (detail.originatorUserId !== identity.staffId) {
      throw new DingtalkWorkspaceError('DINGTALK_NOT_ORIGINATOR');
    }
    if (detail.status !== 'RUNNING') throw new DingtalkWorkspaceError('DINGTALK_INVALID');
    await terminateProcessInstance({
      operatingUserId: identity.staffId,
      processInstanceId: input.processInstanceId,
      remark: input.remark,
    });
    invalidatePendingCaches(this.userId);
    await appendApprovalAudit({
      action: AUDIT_ACTION.DINGTALK_APPROVAL_TERMINATE,
      db: this.db,
      targetId: input.processInstanceId,
      title: detail.title,
      userId: this.userId,
    });
  };

  revertTask = async (input: RevertTaskInput): Promise<{ result: boolean }> => {
    const identity = await this.prepare();
    const { detail } = await this.refetchOwnedTask(
      identity.staffId,
      input.processInstanceId,
      input.taskId,
    );
    const result = await revertTaskAs(identity.staffId, input);
    invalidatePendingCaches(this.userId);
    await appendApprovalAudit({
      action: AUDIT_ACTION.DINGTALK_APPROVAL_REVERT,
      db: this.db,
      targetId: input.processInstanceId,
      title: detail.title,
      userId: this.userId,
    });
    return result;
  };

  appendTask = async (input: AppendTaskInput): Promise<{ result: boolean }> => {
    const identity = await this.prepare();
    const { detail } = await this.refetchOwnedTask(
      identity.staffId,
      input.processInstanceId,
      input.taskId,
    );
    const appenders = await requireStaffList(this.db, input.appenderStaffTokens);
    if (appenders.length === 0) throw new DingtalkWorkspaceError('DINGTALK_INVALID');
    const result = await appendTaskAs(identity.staffId, {
      activateType: input.activateType ?? 'ALL',
      agreeAll: input.agreeAll,
      appenderUserIds: appenders.map((staff) => staff.staffId),
      processInstanceId: input.processInstanceId,
      remark: input.remark,
      taskId: input.taskId,
      type: input.type,
    });
    invalidatePendingCaches(this.userId);
    await appendApprovalAudit({
      action: AUDIT_ACTION.DINGTALK_APPROVAL_APPEND,
      db: this.db,
      targetId: input.processInstanceId,
      title: detail.title,
      userId: this.userId,
    });
    return result;
  };

  saveTemplate = async (input: SaveTemplateInput): Promise<SaveTemplateResult> => {
    const identity = await this.prepare();
    await this.requireApprovalAdmin(identity.staffId);
    const name = input.name.trim();
    if (!name) {
      throw new DingtalkWorkspaceError('DINGTALK_INVALID');
    }
    const encoded = encodeSaveTemplateFields(input.fields);
    const processCode = input.processCode?.trim() || undefined;
    const saved = await saveFormTemplate({
      description: input.description,
      formComponents: encoded.components,
      name,
      processCode,
    });
    invalidateApprovalListCache(this.userId);
    await appendApprovalAudit({
      action: AUDIT_ACTION.DINGTALK_APPROVAL_SAVE_TEMPLATE,
      db: this.db,
      targetId: saved.processCode,
      title: name,
      userId: this.userId,
    });
    return {
      adminUrl: dingtalkTemplateAdminUrl(saved.processCode),
      created: !processCode,
      fields: encoded.fields,
      name,
      notes: [...TEMPLATE_CONSOLE_NOTES],
      processCode: saved.processCode,
    };
  };

  deleteTemplate = async (input: {
    processCode: string;
  }): Promise<{ name?: string; processCode: string }> => {
    const identity = await this.prepare();
    await this.requireApprovalAdmin(identity.staffId);
    const processCode = input.processCode.trim();
    if (!processCode) throw new DingtalkWorkspaceError('DINGTALK_INVALID');
    const title = await cachedTemplateName(this.userId, identity.staffId, processCode);
    await deleteFormTemplate(processCode);
    invalidateApprovalListCache(this.userId);
    await appendApprovalAudit({
      action: AUDIT_ACTION.DINGTALK_APPROVAL_DELETE_TEMPLATE,
      db: this.db,
      name: title,
      targetId: processCode,
      title,
      userId: this.userId,
    });
    return { name: title || undefined, processCode };
  };

  preview = async (input: ApprovalPreviewInput): Promise<ApprovalPreview> => {
    const identity = await this.prepare();
    return buildApprovalPreview(
      { db: this.db, identity, userId: this.userId },
      input.apiName,
      input.args ?? {},
    );
  };
}
