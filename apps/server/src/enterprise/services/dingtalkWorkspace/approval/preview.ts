import type { ApprovalRuleCreateInput } from '../approvalRules';
import { DingtalkWorkspaceError } from '../errors';
import { getFormSchema, getInstanceDetail } from './api';
import { encodeFormValues, isSuiteTemplate } from './formValues';
import { actingAsFromIdentity, formatStaffLabel, requireStaff, requireStaffList } from './staff';
import {
  type ApprovalPreview,
  type ApprovalServiceContext,
  canViewInstance,
  type CreateInstanceInput,
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
  const lines = [
    { label: '审批单', value: detail.title || processInstanceId },
    { label: '结果', value: result === 'agree' ? '同意' : '拒绝' },
  ];
  if (remark) lines.push({ label: '意见', value: remark });
  return {
    danger: result === 'refuse',
    lines,
    title: result === 'agree' ? `同意「${detail.title}」` : `拒绝「${detail.title}」`,
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
  const lines = [
    { label: '审批单', value: detail.title || processInstanceId },
    { label: '转交给', value: formatStaffLabel(target) },
  ];
  if (remark) lines.push({ label: '意见', value: remark });
  return {
    danger: true,
    lines,
    title: `转交「${detail.title}」`,
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
  return {
    danger: false,
    lines: [
      { label: '审批单', value: detail.title || processInstanceId },
      { label: '评论', value: text },
    ],
    title: `评论「${detail.title}」`,
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
  const lines = [{ label: '审批单', value: detail.title || processInstanceId }];
  if (remark) lines.push({ label: '原因', value: remark });
  return {
    danger: true,
    lines,
    title: `撤销「${detail.title}」`,
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
  const lines = [
    { label: '审批单', value: detail.title || processInstanceId },
    {
      label: '退回至',
      value: revertAction === 'REVERT_FOR_RESUBMIT' ? '发起人' : targetActivityId,
    },
  ];
  if (remark) lines.push({ label: '原因', value: remark });
  return {
    danger: true,
    lines,
    title: `退回「${detail.title}」`,
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
  return {
    danger: false,
    lines: [
      { label: '审批单', value: detail.title || processInstanceId },
      { label: '加签类型', value: type === 'before' ? '前加签' : '后加签' },
      { label: '加签人', value: appenders.map(formatStaffLabel).join('、') },
    ],
    title: `加签「${detail.title}」`,
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

const previewDeleteTemplate = (args: Record<string, unknown>): PreviewBody => {
  const processCode = asString(args.processCode);
  if (!processCode) throw new DingtalkWorkspaceError('DINGTALK_INVALID');
  return {
    danger: true,
    lines: [{ label: '模板', value: processCode }],
    title: `删除模板「${processCode}」`,
    warnings: ['删除模板不会删除已发起的审批单。'],
  };
};

const isRuleAction = (value: string): value is ApprovalRuleCreateInput['action'] =>
  value === 'agree' || value === 'comment' || value === 'redirect' || value === 'refuse';

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

const previewRule = async (
  ctx: ApprovalServiceContext,
  apiName: string,
  args: Record<string, unknown>,
): Promise<PreviewBody> => {
  if (apiName === 'deleteApprovalRule') {
    const id = asString(args.id) ?? '';
    return {
      danger: true,
      lines: [{ label: '规则', value: id || '当前规则' }],
      title: '删除自动审批规则',
      warnings: ['删除后不会撤销已经自动处理的审批。'],
    };
  }

  const createInput = asRuleCreateInput(args);
  if (createInput) {
    // Dynamic import avoids a cycle: approvalRules/service imports DingtalkApprovalService.
    const { DingtalkApprovalRuleService } = await import('../approvalRules');
    const service = new DingtalkApprovalRuleService(ctx.db, ctx.userId);
    const preview = await service.previewRule(createInput);
    return {
      danger: preview.danger,
      lines: preview.lines,
      title: preview.title,
      warnings: preview.warnings,
    };
  }

  const action = asString(args.action);
  const name = asString(args.name) ?? asString(args.id) ?? '自动审批规则';
  const lines: ApprovalPreview['lines'] = [{ label: '规则', value: name }];
  if (action) lines.push({ label: '动作', value: action });
  if (args.enabled === false) lines.push({ label: '状态', value: '停用' });
  if (args.enabled === true) lines.push({ label: '状态', value: '启用' });
  return {
    danger: action === 'refuse' || action === 'redirect' || args.enabled === false,
    lines,
    title: `更新规则「${name}」`,
    warnings: [],
  };
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
      preview = previewDeleteTemplate(args);
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
