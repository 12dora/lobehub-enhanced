import type { ApprovalRuleAction, ApprovalRuleConditions } from '@lobechat/types';

import type { ApprovalRuleCreateInput, ApprovalRuleView } from '../approvalRules';
import { DingtalkWorkspaceError, type DingtalkWorkspaceErrorCode } from '../errors';
import { getFormSchema, getInstanceDetail } from './api';
import { encodeFormValues, isSuiteTemplate } from './formValues';
import { actingAsFromIdentity, formatStaffLabel, requireStaff, requireStaffList } from './staff';
import {
  type ApprovalPreview,
  type ApprovalServiceContext,
  canViewInstance,
  type CreateInstanceInput,
  type ProcessInstanceDetail,
} from './types';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

type PreviewBody = Omit<ApprovalPreview, 'actingAs'>;

const failPreview: (code: DingtalkWorkspaceErrorCode) => never = (code) => {
  throw new DingtalkWorkspaceError(code);
};

type ActivityNameBearer = {
  activityId?: string;
  activityName?: string;
  taskGroupName?: string;
};

const activityNameFromBearer = (
  item: ActivityNameBearer,
  activityId: string,
): string | undefined => {
  if (item.activityId !== activityId) return undefined;
  return asString(item.activityName) ?? asString(item.taskGroupName);
};

const resolveActivityName = (
  detail: ProcessInstanceDetail,
  activityId: string,
  forecastNames?: ReadonlyMap<string, string>,
): string => {
  const forecastName = forecastNames?.get(activityId);
  if (forecastName) return forecastName;
  for (const task of detail.tasks ?? []) {
    const name = activityNameFromBearer(task, activityId);
    if (name) return name;
  }
  for (const record of detail.operationRecords ?? []) {
    const name = activityNameFromBearer(record, activityId);
    if (name) return name;
  }
  return '指定节点';
};

const instanceHeadline = (detail: ProcessInstanceDetail): string => {
  const title = asString(detail.title);
  if (title) return title;
  const processName = asString(asRecord(detail).processName);
  const originator = asString(detail.originatorName);
  if (processName && originator) return `${processName} · ${originator}`;
  if (processName) return processName;
  if (originator) return originator;
  return '审批单';
};

const loadApprovalRuleService = async (ctx: ApprovalServiceContext) => {
  // Dynamic import avoids a cycle: approvalRules/service imports DingtalkApprovalService.
  const { DingtalkApprovalRuleService } = await import('../approvalRules');
  return new DingtalkApprovalRuleService(ctx.db, ctx.userId);
};

const loadVisibleTemplates = async (ctx: ApprovalServiceContext) => {
  // Same 5-minute per-user cache as DingtalkApprovalService.listTemplates.
  const { DingtalkApprovalService } = await import('./service');
  return new DingtalkApprovalService(ctx.db, ctx.userId).listTemplates();
};

const resolveTemplateName = async (
  ctx: ApprovalServiceContext,
  processCode: string,
): Promise<{ fieldCount?: number; name: string }> => {
  const visible = await loadVisibleTemplates(ctx);
  const hit = visible.find((item) => item.processCode === processCode);
  if (hit?.name) return { name: hit.name };

  try {
    const schema = await getFormSchema(processCode);
    const name = asString(schema.name);
    if (!name) return failPreview('DINGTALK_NOT_FOUND');
    return { fieldCount: schema.fields.length, name };
  } catch (error) {
    if (error instanceof DingtalkWorkspaceError) throw error;
    return failPreview('DINGTALK_NOT_FOUND');
  }
};

const isRuleAction = (value: string): value is ApprovalRuleAction =>
  value === 'agree' || value === 'comment' || value === 'redirect' || value === 'refuse';

const ruleActionText = (input: {
  action: ApprovalRuleAction | string;
  redirectToName?: string | null;
}): string => {
  switch (input.action) {
    case 'agree': {
      return '同意';
    }
    case 'refuse': {
      return '拒绝';
    }
    case 'comment': {
      return '评论';
    }
    case 'redirect': {
      const target = asString(input.redirectToName);
      return target ? `转交给 ${target}` : '转交';
    }
    default: {
      return '转交';
    }
  }
};

/** Matches DingtalkApprovalRuleService.summarizeConditions. */
const summarizeRuleConditions = (conditions: ApprovalRuleConditions | null | undefined): string => {
  const staffCount = conditions?.originators?.staffIds?.length ?? 0;
  const deptCount = conditions?.originators?.deptIds?.length ?? 0;
  const fields = conditions?.fields ?? [];
  const fieldLabels = fields
    .slice(0, 4)
    .map((field) => field.label || field.componentId)
    .join('、');
  const parts = [
    ...(staffCount > 0 ? [`发起人 ${staffCount} 人`] : []),
    ...(deptCount > 0 ? [`发起部门 ${deptCount} 个`] : []),
    ...(fields.length > 0 ? [`表单条件 ${fields.length} 项（${fieldLabels}）`] : []),
  ];
  return parts.length > 0 ? parts.join('；') : '全部待办';
};

const changedLine = (
  label: string,
  from: string,
  to: string,
): ApprovalPreview['lines'][number] => ({
  label,
  value: `${from} → ${to}`,
});

const previewCreate = async (
  ctx: ApprovalServiceContext,
  args: Record<string, unknown>,
): Promise<PreviewBody> => {
  const processCode = asString(args.processCode);
  if (!processCode) throw new DingtalkWorkspaceError('DINGTALK_INVALID');
  const schema = await getFormSchema(processCode);
  if (isSuiteTemplate(schema)) throw new DingtalkWorkspaceError('DINGTALK_INVALID');
  const formValues = Array.isArray(args.formValues)
    ? (args.formValues as CreateInstanceInput['formValues'])
    : [];
  encodeFormValues(schema, formValues);

  const warnings: string[] = [];
  const lines: ApprovalPreview['lines'] = [{ label: '模板', value: schema.name }];
  for (const field of formValues.slice(0, 8)) {
    const label = asString(field.label) ?? asString(field.componentId) ?? '字段';
    const value =
      field.value == null
        ? ''
        : typeof field.value === 'string'
          ? field.value
          : JSON.stringify(field.value);
    if (value) lines.push({ label, value });
  }

  const approverTokens = asStringArray(args.approverStaffTokens);
  if (approverTokens.length > 0) {
    const approvers = await requireStaffList(ctx.db, approverTokens);
    lines.push({ label: '审批人', value: approvers.map(formatStaffLabel).join('、') });
    warnings.push('指定审批人会覆盖该模板在钉钉后台配置的流程。');
  }
  const ccTokens = asStringArray(args.ccStaffTokens);
  if (ccTokens.length > 0) {
    const cc = await requireStaffList(ctx.db, ccTokens);
    lines.push({ label: '抄送', value: cc.map(formatStaffLabel).join('、') });
    if (approverTokens.length === 0) {
      warnings.push('抄送仅在同时指定审批人时生效，否则沿用模板原有抄送设置。');
    }
  }

  return {
    danger: false,
    lines,
    title: `提交「${schema.name}」`,
    warnings,
  };
};

const loadOwnedTask = async (
  staffId: string,
  processInstanceId: string,
  taskId: string | number,
) => {
  const detail = await getInstanceDetail(processInstanceId);
  const task = detail.tasks.find(
    (item) =>
      item.taskId === String(taskId) && item.userId === staffId && item.status === 'RUNNING',
  );
  if (!task) throw new DingtalkWorkspaceError('DINGTALK_NOT_TASK_OWNER');
  return { detail, task };
};

const previewExecute = async (
  ctx: ApprovalServiceContext,
  args: Record<string, unknown>,
  result: 'agree' | 'refuse',
): Promise<PreviewBody> => {
  const processInstanceId = asString(args.processInstanceId);
  const taskId = args.taskId;
  if (!processInstanceId || taskId == null) throw new DingtalkWorkspaceError('DINGTALK_INVALID');
  const { detail } = await loadOwnedTask(
    ctx.identity.staffId,
    processInstanceId,
    taskId as string | number,
  );
  const remark = asString(args.remark);
  if (result === 'refuse' && !remark) throw new DingtalkWorkspaceError('DINGTALK_INVALID');
  const headline = instanceHeadline(detail);
  const lines: ApprovalPreview['lines'] = [
    { label: '审批单', value: headline },
    { label: '结果', value: result === 'agree' ? '同意' : '拒绝' },
    ...(remark ? [{ label: '意见', value: remark }] : []),
  ];
  return {
    danger: result === 'refuse',
    lines,
    title: result === 'agree' ? `同意「${headline}」` : `拒绝「${headline}」`,
    warnings: result === 'refuse' ? ['拒绝后该审批单将结束。'] : [],
  };
};

const previewRedirect = async (
  ctx: ApprovalServiceContext,
  args: Record<string, unknown>,
): Promise<PreviewBody> => {
  const processInstanceId = asString(args.processInstanceId);
  const taskId = args.taskId;
  const toStaffToken = asString(args.toStaffToken);
  if (!processInstanceId || taskId == null || !toStaffToken) {
    throw new DingtalkWorkspaceError('DINGTALK_INVALID');
  }
  const { detail } = await loadOwnedTask(
    ctx.identity.staffId,
    processInstanceId,
    taskId as string | number,
  );
  const target = await requireStaff(ctx.db, toStaffToken);
  const remark = asString(args.remark);
  const headline = instanceHeadline(detail);
  const lines: ApprovalPreview['lines'] = [
    { label: '审批单', value: headline },
    { label: '转交给', value: formatStaffLabel(target) },
    ...(remark ? [{ label: '意见', value: remark }] : []),
  ];
  return {
    danger: true,
    lines,
    title: `转交「${headline}」`,
    warnings: [],
  };
};

const previewComment = async (
  ctx: ApprovalServiceContext,
  args: Record<string, unknown>,
): Promise<PreviewBody> => {
  const processInstanceId = asString(args.processInstanceId);
  const text = asString(args.text);
  if (!processInstanceId || !text) throw new DingtalkWorkspaceError('DINGTALK_INVALID');
  const detail = await getInstanceDetail(processInstanceId);
  if (!canViewInstance(detail, ctx.identity.staffId)) {
    throw new DingtalkWorkspaceError('DINGTALK_FORBIDDEN');
  }
  const headline = instanceHeadline(detail);
  return {
    danger: false,
    lines: [
      { label: '审批单', value: headline },
      { label: '评论', value: text },
    ],
    title: `评论「${headline}」`,
    warnings: [],
  };
};

const previewTerminate = async (
  ctx: ApprovalServiceContext,
  args: Record<string, unknown>,
): Promise<PreviewBody> => {
  const processInstanceId = asString(args.processInstanceId);
  if (!processInstanceId) throw new DingtalkWorkspaceError('DINGTALK_INVALID');
  const detail = await getInstanceDetail(processInstanceId);
  if (detail.originatorUserId !== ctx.identity.staffId) {
    throw new DingtalkWorkspaceError('DINGTALK_NOT_ORIGINATOR');
  }
  const remark = asString(args.remark);
  const headline = instanceHeadline(detail);
  const lines: ApprovalPreview['lines'] = [
    { label: '审批单', value: headline },
    ...(remark ? [{ label: '原因', value: remark }] : []),
  ];
  return {
    danger: true,
    lines,
    title: `撤销「${headline}」`,
    warnings: ['仅发起人可撤销进行中的审批单，且模板需允许提交人撤销。'],
  };
};

const previewRevert = async (
  ctx: ApprovalServiceContext,
  args: Record<string, unknown>,
): Promise<PreviewBody> => {
  const processInstanceId = asString(args.processInstanceId);
  const taskId = args.taskId;
  const revertAction = asString(args.revertAction);
  const targetActivityId = asString(args.targetActivityId);
  if (!processInstanceId || taskId == null || !revertAction || !targetActivityId) {
    throw new DingtalkWorkspaceError('DINGTALK_INVALID');
  }
  const { detail } = await loadOwnedTask(
    ctx.identity.staffId,
    processInstanceId,
    taskId as string | number,
  );
  const remark = asString(args.remark);
  const headline = instanceHeadline(detail);
  const targetName =
    revertAction === 'REVERT_FOR_RESUBMIT'
      ? '发起人'
      : resolveActivityName(detail, targetActivityId);
  const lines: ApprovalPreview['lines'] = [
    { label: '审批单', value: headline },
    { label: '退回至', value: targetName },
    ...(remark ? [{ label: '原因', value: remark }] : []),
  ];
  return {
    danger: true,
    lines,
    title: `退回「${headline}」`,
    warnings: ['退回需要 OA 审批高级版。'],
  };
};

const previewAppend = async (
  ctx: ApprovalServiceContext,
  args: Record<string, unknown>,
): Promise<PreviewBody> => {
  const processInstanceId = asString(args.processInstanceId);
  const taskId = args.taskId;
  const tokens = asStringArray(args.appenderStaffTokens);
  const type = asString(args.type);
  if (
    !processInstanceId ||
    taskId == null ||
    tokens.length === 0 ||
    (type !== 'before' && type !== 'after')
  ) {
    throw new DingtalkWorkspaceError('DINGTALK_INVALID');
  }
  const { detail } = await loadOwnedTask(
    ctx.identity.staffId,
    processInstanceId,
    taskId as string | number,
  );
  const appenders = await requireStaffList(ctx.db, tokens);
  const headline = instanceHeadline(detail);
  return {
    danger: false,
    lines: [
      { label: '审批单', value: headline },
      { label: '加签类型', value: type === 'before' ? '前加签' : '后加签' },
      { label: '加签人', value: appenders.map(formatStaffLabel).join('、') },
    ],
    title: `加签「${headline}」`,
    warnings: ['加签需要 OA 审批高级版。'],
  };
};

const previewSaveTemplate = (args: Record<string, unknown>): PreviewBody => {
  const name = asString(args.name);
  if (!name) throw new DingtalkWorkspaceError('DINGTALK_INVALID');
  const processCode = asString(args.processCode);
  const fields = Array.isArray(args.fields) ? args.fields : [];
  const fieldLabels = fields
    .map((item) => asString(asRecord(item).label))
    .filter((item): item is string => Boolean(item));
  return {
    danger: false,
    lines: [
      { label: '模板名称', value: name },
      { label: '操作', value: processCode ? '更新' : '创建' },
      { label: '控件', value: fieldLabels.join('、') || '无' },
    ],
    title: processCode ? `更新模板「${name}」` : `创建模板「${name}」`,
    warnings: [
      '审批流程、可见范围和模板管理员无法通过接口配置。请登录钉钉管理后台打开该模板，在「流程设计」中设置后发布。',
    ],
  };
};

const previewDeleteTemplate = async (
  ctx: ApprovalServiceContext,
  args: Record<string, unknown>,
): Promise<PreviewBody> => {
  const processCode = asString(args.processCode);
  if (!processCode) return failPreview('DINGTALK_INVALID');
  const resolved = await resolveTemplateName(ctx, processCode);
  return {
    danger: true,
    lines: [
      { label: '模板名称', value: resolved.name },
      ...(resolved.fieldCount !== undefined
        ? [{ label: '字段数', value: String(resolved.fieldCount) }]
        : []),
    ],
    title: `删除模板「${resolved.name}」`,
    warnings: ['删除模板不会删除已发起的审批单。'],
  };
};

const asRuleCreateInput = (args: Record<string, unknown>): ApprovalRuleCreateInput | undefined => {
  const name = asString(args.name);
  const processCode = asString(args.processCode);
  const action = asString(args.action);
  if (
    !name ||
    !processCode ||
    !action ||
    !isRuleAction(action) ||
    args.conditions == null ||
    typeof args.conditions !== 'object'
  ) {
    return undefined;
  }
  const input: ApprovalRuleCreateInput = {
    action,
    conditions: args.conditions as ApprovalRuleCreateInput['conditions'],
    name,
    processCode,
  };
  if (typeof args.enabled === 'boolean') input.enabled = args.enabled;
  if (typeof args.redirectToStaffToken === 'string') {
    input.redirectToStaffToken = args.redirectToStaffToken;
  }
  if (typeof args.remark === 'string' || args.remark === null) {
    input.remark = args.remark;
  }
  if (
    args.expiresAt === null ||
    typeof args.expiresAt === 'string' ||
    args.expiresAt instanceof Date
  ) {
    input.expiresAt = args.expiresAt;
  }
  if (typeof args.createdByTopicId === 'string' || args.createdByTopicId === null) {
    input.createdByTopicId = args.createdByTopicId;
  }
  return input;
};

const requireRule = async (
  ctx: ApprovalServiceContext,
  args: Record<string, unknown>,
): Promise<ApprovalRuleView> => {
  const id = asString(args.id);
  if (!id) return failPreview('DINGTALK_INVALID');
  const service = await loadApprovalRuleService(ctx);
  return service.get(id);
};

const enabledLabel = (enabled: boolean): string => (enabled ? '启用' : '停用');

const previewDeleteRule = async (
  ctx: ApprovalServiceContext,
  args: Record<string, unknown>,
): Promise<PreviewBody> => {
  const rule = await requireRule(ctx, args);
  return {
    danger: true,
    lines: [
      { label: '规则名称', value: rule.name },
      { label: '审批模板', value: rule.processName },
      { label: '条件摘要', value: summarizeRuleConditions(rule.conditions) },
      { label: '动作', value: ruleActionText(rule) },
    ],
    title: `删除规则「${rule.name}」`,
    warnings: ['删除后不会撤销已经自动处理的审批。'],
  };
};

const resolveRedirectName = async (
  ctx: ApprovalServiceContext,
  token: string | undefined,
  fallback: string | null | undefined,
): Promise<string | undefined> => {
  if (!token) return asString(fallback);
  const staff = await requireStaff(ctx.db, token);
  return staff.name;
};

const previewUpdateRuleFallback = async (
  ctx: ApprovalServiceContext,
  args: Record<string, unknown>,
): Promise<PreviewBody> => {
  const rule = await requireRule(ctx, args);
  const nextActionRaw = asString(args.action);
  if (nextActionRaw && !isRuleAction(nextActionRaw)) return failPreview('DINGTALK_INVALID');

  const nextName = asString(args.name);
  const nextProcessCode = asString(args.processCode);
  const nextEnabled = typeof args.enabled === 'boolean' ? args.enabled : undefined;
  const nextConditions =
    args.conditions != null && typeof args.conditions === 'object'
      ? (args.conditions as ApprovalRuleConditions)
      : undefined;
  const nextRedirectToken =
    typeof args.redirectToStaffToken === 'string' ? args.redirectToStaffToken : undefined;
  const nextRedirectName = await resolveRedirectName(
    ctx,
    nextRedirectToken,
    nextActionRaw === 'redirect' || rule.action === 'redirect' ? rule.redirectToName : undefined,
  );
  const currentAction = ruleActionText(rule);
  const nextAction = nextActionRaw
    ? ruleActionText({ action: nextActionRaw, redirectToName: nextRedirectName })
    : undefined;
  const nextTemplateName =
    nextProcessCode && nextProcessCode !== rule.processCode
      ? (await resolveTemplateName(ctx, nextProcessCode)).name
      : undefined;
  const currentConditions = summarizeRuleConditions(rule.conditions);
  const nextConditionSummary = nextConditions ? summarizeRuleConditions(nextConditions) : undefined;

  const changed: ApprovalPreview['lines'] = [
    ...(nextName && nextName !== rule.name ? [changedLine('规则名称', rule.name, nextName)] : []),
    ...(nextTemplateName && nextTemplateName !== rule.processName
      ? [changedLine('审批模板', rule.processName, nextTemplateName)]
      : []),
    ...(nextConditionSummary && nextConditionSummary !== currentConditions
      ? [changedLine('条件摘要', currentConditions, nextConditionSummary)]
      : []),
    ...(nextAction && nextAction !== currentAction
      ? [changedLine('动作', currentAction, nextAction)]
      : []),
    ...(nextEnabled !== undefined && nextEnabled !== rule.enabled
      ? [changedLine('状态', enabledLabel(rule.enabled), enabledLabel(nextEnabled))]
      : []),
  ];

  const displayName = nextName ?? rule.name;
  const dangerAction = nextActionRaw ?? rule.action;
  const unchanged: ApprovalPreview['lines'] = [
    { label: '规则名称', value: rule.name },
    { label: '审批模板', value: rule.processName },
    { label: '条件摘要', value: currentConditions },
    { label: '动作', value: currentAction },
  ];
  return {
    danger: dangerAction === 'refuse' || dangerAction === 'redirect' || nextEnabled === false,
    lines: changed.length > 0 ? changed : unchanged,
    title: `更新规则「${displayName}」`,
    warnings: [],
  };
};

const previewRule = async (
  ctx: ApprovalServiceContext,
  apiName: string,
  args: Record<string, unknown>,
): Promise<PreviewBody> => {
  if (apiName === 'deleteApprovalRule') return previewDeleteRule(ctx, args);

  const createInput = asRuleCreateInput(args);
  if (createInput) {
    const service = await loadApprovalRuleService(ctx);
    const preview = await service.previewRule(createInput);
    return {
      danger: preview.danger,
      lines: preview.lines,
      title: preview.title,
      warnings: preview.warnings,
    };
  }

  return previewUpdateRuleFallback(ctx, args);
};

const WRITE_ALIASES: Record<string, string> = {
  addApprover: 'appendTask',
  approveTask: 'executeTaskAgree',
  commentApproval: 'addComment',
  createApprovalRule: 'createApprovalRule',
  deleteApprovalRule: 'deleteApprovalRule',
  deleteTemplate: 'deleteTemplate',
  refuseTask: 'executeTaskRefuse',
  returnTask: 'revertTask',
  saveTemplate: 'saveTemplate',
  submitApproval: 'createInstance',
  transferTask: 'redirectTask',
  updateApprovalRule: 'updateApprovalRule',
  withdrawApplication: 'terminateInstance',
};

export const buildApprovalPreview = async (
  ctx: ApprovalServiceContext,
  apiName: string,
  args: Record<string, unknown>,
): Promise<ApprovalPreview> => {
  const actingAs = await actingAsFromIdentity(ctx.db, ctx.identity);
  const name = WRITE_ALIASES[apiName] ?? apiName;
  let preview: PreviewBody;

  switch (name) {
    case 'createInstance': {
      preview = await previewCreate(ctx, args);
      break;
    }
    case 'executeTask': {
      const result = asString(args.result);
      if (result !== 'agree' && result !== 'refuse')
        throw new DingtalkWorkspaceError('DINGTALK_INVALID');
      preview = await previewExecute(ctx, args, result);
      break;
    }
    case 'executeTaskAgree': {
      preview = await previewExecute(ctx, args, 'agree');
      break;
    }
    case 'executeTaskRefuse': {
      preview = await previewExecute(ctx, args, 'refuse');
      break;
    }
    case 'redirectTask': {
      preview = await previewRedirect(ctx, args);
      break;
    }
    case 'addComment': {
      preview = await previewComment(ctx, args);
      break;
    }
    case 'terminateInstance': {
      preview = await previewTerminate(ctx, args);
      break;
    }
    case 'revertTask': {
      preview = await previewRevert(ctx, args);
      break;
    }
    case 'appendTask': {
      preview = await previewAppend(ctx, args);
      break;
    }
    case 'saveTemplate': {
      preview = previewSaveTemplate(args);
      break;
    }
    case 'deleteTemplate': {
      preview = await previewDeleteTemplate(ctx, args);
      break;
    }
    case 'createApprovalRule':
    case 'updateApprovalRule':
    case 'deleteApprovalRule': {
      preview = await previewRule(ctx, name, args);
      break;
    }
    default: {
      throw new DingtalkWorkspaceError('DINGTALK_INVALID');
    }
  }

  return { ...preview, actingAs };
};
