import type { LobeChatDatabase } from '@/database/type';

import { AUDIT_ACTION, AUDIT_TARGET_TYPE } from '../../audit/auditActionCatalog';
import { PlatformAuditService } from '../../platformAudit';
import { assertDingtalkFeature } from '../capabilities';
import { DingtalkWorkspaceError } from '../errors';
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
import { encodeFormValues, formSummary, isSuiteTemplate } from './formValues';
import {
  invalidateApprovalListCache,
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
  type ExecuteTaskInput,
  type InitiatedApprovalRow,
  type PendingApprovalRow,
  type ProcessInstanceDetail,
  type RedirectTaskInput,
  type RevertTaskInput,
  type SaveTemplateInput,
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
  targetId: string;
  title?: string;
  userId: string;
}): Promise<void> => {
  try {
    await new PlatformAuditService(input.db).append({
      action: input.action,
      actorUserId: input.userId,
      afterDiff: input.title ? { title: input.title } : null,
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

  private templates = async (staffId: string): Promise<VisibleTemplate[]> =>
    loadVisibleTemplatesCached(this.userId, staffId, TEMPLATE_CACHE_TTL_MS);

  private requireApprovalAdmin = async (staffId: string): Promise<void> => {
    const isAdmin = await isDingtalkApprovalAdmin(staffId);
    if (!isAdmin) throw new DingtalkWorkspaceError('DINGTALK_NOT_APPROVAL_ADMIN');
  };

  private refetchOwnedTask = async (
    staffId: string,
    processInstanceId: string,
    taskId: string | number,
  ) => {
    const detail = await getInstanceDetail(processInstanceId);
    const task = runningTaskFor(detail, staffId, taskId);
    if (!task) throw new DingtalkWorkspaceError('DINGTALK_NOT_TASK_OWNER');
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
  }): Promise<ApprovalListResult<PendingApprovalRow>> => {
    const identity = await this.prepare();
    const templates = await this.templates(identity.staffId);
    return listPendingApprovals({
      db: this.db,
      limit: input?.limit,
      staffId: identity.staffId,
      templates,
      userId: this.userId,
    });
  };

  listInitiated = async (input?: {
    limit?: number;
    status?: string;
  }): Promise<ApprovalListResult<InitiatedApprovalRow>> => {
    const identity = await this.prepare();
    const templates = await this.templates(identity.staffId);
    return listInitiatedApprovals({
      db: this.db,
      limit: input?.limit,
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

    invalidateApprovalListCache(this.userId);
    await appendApprovalAudit({
      action: AUDIT_ACTION.DINGTALK_APPROVAL_CREATE,
      db: this.db,
      targetId: created.instanceId,
      title: schema.name,
      userId: this.userId,
    });
    return created;
  };

  executeTask = async (input: ExecuteTaskInput): Promise<{ result: boolean }> => {
    const identity = await this.prepare();
    const { detail } = await this.refetchOwnedTask(
      identity.staffId,
      input.processInstanceId,
      input.taskId,
    );
    if (input.result === 'refuse' && !input.remark?.trim()) {
      throw new DingtalkWorkspaceError('DINGTALK_INVALID');
    }
    const result = await executeTaskAs(identity.staffId, input);
    invalidateApprovalListCache(this.userId);
    await appendApprovalAudit({
      action:
        input.result === 'agree'
          ? AUDIT_ACTION.DINGTALK_APPROVAL_AGREE
          : AUDIT_ACTION.DINGTALK_APPROVAL_REFUSE,
      db: this.db,
      targetId: input.processInstanceId,
      title: detail.title,
      userId: this.userId,
    });
    return result;
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
    invalidateApprovalListCache(this.userId);
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
    invalidateApprovalListCache(this.userId);
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
    invalidateApprovalListCache(this.userId);
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
    invalidateApprovalListCache(this.userId);
    await appendApprovalAudit({
      action: AUDIT_ACTION.DINGTALK_APPROVAL_APPEND,
      db: this.db,
      targetId: input.processInstanceId,
      title: detail.title,
      userId: this.userId,
    });
    return result;
  };

  saveTemplate = async (
    input: SaveTemplateInput,
  ): Promise<{ notes: string[]; processCode: string }> => {
    const identity = await this.prepare();
    await this.requireApprovalAdmin(identity.staffId);
    if (!input.name.trim() || input.fields.length === 0) {
      throw new DingtalkWorkspaceError('DINGTALK_INVALID');
    }
    const formComponents = input.fields.map((field, index) => ({
      componentType: field.componentType,
      props: {
        bizAlias: field.bizAlias,
        componentId: field.componentId || `${field.componentType}_${index + 1}`,
        format: field.format,
        label: field.label,
        options: field.options?.map((option) =>
          typeof option === 'string' ? { key: option, value: option } : option,
        ),
        placeholder: field.placeholder,
        required: field.required === true,
        unit: field.unit,
      },
    }));
    const saved = await saveFormTemplate({
      description: input.description,
      formComponents,
      name: input.name.trim(),
      processCode: input.processCode,
    });
    invalidateApprovalListCache(this.userId);
    await appendApprovalAudit({
      action: AUDIT_ACTION.DINGTALK_APPROVAL_SAVE_TEMPLATE,
      db: this.db,
      targetId: saved.processCode,
      title: input.name.trim(),
      userId: this.userId,
    });
    return { notes: [...TEMPLATE_CONSOLE_NOTES], processCode: saved.processCode };
  };

  deleteTemplate = async (input: { processCode: string }): Promise<void> => {
    const identity = await this.prepare();
    await this.requireApprovalAdmin(identity.staffId);
    const processCode = input.processCode.trim();
    if (!processCode) throw new DingtalkWorkspaceError('DINGTALK_INVALID');
    await deleteFormTemplate(processCode);
    invalidateApprovalListCache(this.userId);
    await appendApprovalAudit({
      action: AUDIT_ACTION.DINGTALK_APPROVAL_DELETE_TEMPLATE,
      db: this.db,
      targetId: processCode,
      title: processCode,
      userId: this.userId,
    });
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
