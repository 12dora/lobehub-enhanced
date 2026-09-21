import type {
  ApprovalAutomationTier,
  ApprovalRuleAction,
  ApprovalRuleConditions,
  ApprovalRuleFieldOp,
} from '@lobechat/types';
import { APPROVAL_AUTOMATION_TIERS } from '@lobechat/types';

import {
  DingtalkApprovalRuleEnableBlockedError,
  DingtalkApprovalRuleModel,
  type DingtalkApprovalRuleUpdatePatch,
} from '@/database/models/dingtalkApprovalRule';
import { DingTalkDirectoryModel } from '@/database/models/dingtalkDirectory';
import type { DingtalkApprovalRuleItem } from '@/database/schemas/dingtalkApprovalRule';
import type { LobeChatDatabase } from '@/database/type';

import type { AuditAction } from '../../audit/auditActionCatalog';
import { AUDIT_ACTION, AUDIT_TARGET_TYPE } from '../../audit/auditActionCatalog';
import { PlatformAuditService } from '../../platformAudit';
import { DingtalkApprovalService, type TemplateField } from '../approval';
import { assertDingtalkFeature, getDingtalkWorkspaceCapabilities } from '../capabilities';
import { type DingtalkStaffCandidate, resolveStaff, type ResolveStaffResult } from '../directory';
import { DingtalkWorkspaceError, type DingtalkWorkspaceErrorCode } from '../errors';
import { requireVerifiedDingtalkIdentity, type VerifiedDingtalkIdentity } from '../identity';
import { normalizeApprovalRuleConditions } from './conditions';
import { pickOriginatorLabels, resolveOriginatorLabels } from './labels';
import { fieldOpFitsComponentType } from './match';
import { addUtcDays } from './tier';
import { invalidateApprovalRuleWorkerMemory } from './workerMemory';

export const DINGTALK_APPROVAL_ACTIVE_RULE_LIMIT = 20;
const MAX_NAME_CHARS = 80;
const MAX_REMARK_CHARS = 1000;

const FIELD_OPS = new Set<ApprovalRuleFieldOp>([
  'contains',
  'eq',
  'gt',
  'gte',
  'in',
  'lt',
  'lte',
  'ne',
]);

export interface ApprovalRuleCreateInput {
  action: ApprovalRuleAction;
  conditions: ApprovalRuleConditions;
  createdByTopicId?: string | null;
  enabled?: boolean;
  expiresAt?: Date | string | null;
  name: string;
  processCode: string;
  redirectToStaffToken?: string;
  remark?: string | null;
}

export interface ApprovalRuleUpdateInput {
  action?: ApprovalRuleAction;
  conditions?: ApprovalRuleConditions;
  enabled?: boolean;
  expiresAt?: Date | string | null;
  name?: string;
  processCode?: string;
  redirectToStaffToken?: string | null;
  remark?: string | null;
}

export interface ApprovalRulePreviewLine {
  label: string;
  value: string;
}

export interface ApprovalRulePreview {
  actingAs: { deptPath: string; name: string };
  danger: boolean;
  lines: ApprovalRulePreviewLine[];
  title: string;
  warnings: string[];
}

export interface ApprovalRuleView extends DingtalkApprovalRuleItem {
  dailyCap: number | null;
  originatorLabels: Record<string, string>;
}

function throwWorkspace(code: DingtalkWorkspaceErrorCode): never {
  throw new DingtalkWorkspaceError(code);
}

const parseDateInput = (value: Date | string): Date => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throwWorkspace('DINGTALK_INVALID');
  return parsed;
};

const trimName = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_NAME_CHARS) throwWorkspace('DINGTALK_INVALID');
  return trimmed;
};

const trimRemark = (remark: string | null | undefined): string | null => {
  if (remark === undefined || remark === null) return null;
  const trimmed = remark.trim();
  if (trimmed.length > MAX_REMARK_CHARS) throwWorkspace('DINGTALK_INVALID');
  return trimmed || null;
};

const ruleMutationAuditAction = (kind: 'create' | 'delete' | 'disable' | 'update'): AuditAction => {
  switch (kind) {
    case 'create': {
      return 'dingtalk.approval.rule.create' as AuditAction;
    }
    case 'delete': {
      return 'dingtalk.approval.rule.delete' as AuditAction;
    }
    case 'disable': {
      return AUDIT_ACTION.SYSTEM_DINGTALK_APPROVAL_RULE_DISABLE;
    }
    case 'update': {
      return 'dingtalk.approval.rule.update' as AuditAction;
    }
  }
};

const appendRuleAudit = async (input: {
  action: 'create' | 'delete' | 'disable' | 'update';
  db: LobeChatDatabase;
  processName?: string | null;
  ruleName?: string | null;
  targetId: string;
  title?: string | null;
  userId: string;
}): Promise<void> => {
  const ruleName = input.ruleName?.trim() || undefined;
  const processName = input.processName?.trim() || undefined;
  const title = input.title?.trim() || undefined;
  if (!ruleName && !processName && !title) return;
  const afterDiff: Record<string, unknown> = {};
  if (ruleName) {
    afterDiff.name = ruleName;
    afterDiff.ruleName = ruleName;
  }
  if (processName) afterDiff.processName = processName;
  if (title) afterDiff.title = title;
  try {
    await new PlatformAuditService(input.db).append({
      action: ruleMutationAuditAction(input.action),
      actorUserId: input.userId,
      afterDiff,
      result: 'success',
      targetId: input.targetId,
      targetType: AUDIT_TARGET_TYPE.DINGTALK_APPROVAL,
    });
  } catch (error) {
    console.error('[dingtalk.approval.rule] audit append failed', {
      action: input.action,
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
  }
};

const validateConditionsShape = (conditions: ApprovalRuleConditions): ApprovalRuleConditions => {
  if (conditions.match !== 'all') throwWorkspace('DINGTALK_INVALID');
  const fields = conditions.fields ?? [];
  for (const field of fields) {
    if (!field.componentId?.trim() || !FIELD_OPS.has(field.op)) throwWorkspace('DINGTALK_INVALID');
  }
  return {
    fields,
    match: 'all',
    originators: conditions.originators,
  };
};

const validateConditionsAgainstSchema = (
  conditions: ApprovalRuleConditions,
  schemaFields: TemplateField[],
): void => {
  const byId = new Map(schemaFields.map((field) => [field.componentId, field]));
  for (const field of conditions.fields ?? []) {
    const schemaField = byId.get(field.componentId);
    if (!schemaField || !fieldOpFitsComponentType(field.op, schemaField.componentType)) {
      throwWorkspace('DINGTALK_INVALID');
    }
  }
};

const resolveExpiry = (input: {
  expiresAt: Date | null | undefined;
  now: Date;
  tier: ApprovalAutomationTier;
}): Date | null => {
  const limits = APPROVAL_AUTOMATION_TIERS[input.tier];
  if (input.expiresAt === undefined) {
    if (limits.defaultExpiryDays != null) return addUtcDays(input.now, limits.defaultExpiryDays);
    if (limits.expiryRequired) return addUtcDays(input.now, limits.defaultExpiryDays ?? 30);
    return null;
  }
  if (input.expiresAt === null) {
    if (limits.expiryRequired) throwWorkspace('DINGTALK_INVALID');
    return null;
  }
  if (input.expiresAt.getTime() <= input.now.getTime()) throwWorkspace('DINGTALK_INVALID');
  if (
    limits.maxExpiryDays != null &&
    input.expiresAt.getTime() > addUtcDays(input.now, limits.maxExpiryDays).getTime()
  ) {
    throwWorkspace('DINGTALK_INVALID');
  }
  return input.expiresAt;
};

const actionLabel = (action: ApprovalRuleAction): string => {
  switch (action) {
    case 'agree': {
      return '同意';
    }
    case 'refuse': {
      return '拒绝';
    }
    case 'redirect': {
      return '转交';
    }
    case 'comment': {
      return '评论';
    }
    default: {
      return action;
    }
  }
};

const summarizeConditions = (conditions: ApprovalRuleConditions): string => {
  const parts: string[] = [];
  const staffCount = conditions.originators?.staffIds?.length ?? 0;
  const deptCount = conditions.originators?.deptIds?.length ?? 0;
  if (staffCount > 0) parts.push(`发起人 ${staffCount} 人`);
  if (deptCount > 0) parts.push(`发起部门 ${deptCount} 个`);
  const fieldCount = conditions.fields?.length ?? 0;
  if (fieldCount > 0) {
    const labels = (conditions.fields ?? [])
      .slice(0, 4)
      .map((field) => field.label || field.componentId)
      .join('、');
    parts.push(`表单条件 ${fieldCount} 项（${labels}）`);
  }
  return parts.length > 0 ? parts.join('；') : '全部待办';
};

const isStaffHit = (value: ResolveStaffResult): value is DingtalkStaffCandidate =>
  'staffId' in value && !('ambiguous' in value) && !('notFound' in value);

const isRuleExpired = (expiresAt: Date | string | null | undefined, now: Date): boolean => {
  if (!expiresAt) return false;
  const at = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return true;
  return at.getTime() <= now.getTime();
};

/**
 * Owner re-enable is only allowed for a user-paused rule (`disabled_reason`
 * `user` or null) that has not expired. Admin / identity / tier stops, and
 * expired rows, must stay disabled.
 */
const assertOwnerMayEnable = (existing: DingtalkApprovalRuleItem): void => {
  const reason = existing.disabledReason;
  if (reason === 'admin' || reason === 'identity_invalid' || reason === 'tier_off') {
    throwWorkspace('DINGTALK_FORBIDDEN');
  }
  if (reason === 'expired' || isRuleExpired(existing.expiresAt, new Date())) {
    throwWorkspace('DINGTALK_INVALID');
  }
};

export class DingtalkApprovalRuleService {
  private readonly approval: DingtalkApprovalService;
  private readonly directory: DingTalkDirectoryModel;
  private readonly model: DingtalkApprovalRuleModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {
    this.approval = new DingtalkApprovalService(db, userId);
    this.directory = new DingTalkDirectoryModel(db);
    this.model = new DingtalkApprovalRuleModel(db, userId);
  }

  list = async (opts?: { includeDisabled?: boolean }): Promise<ApprovalRuleView[]> => {
    await this.assertReady();
    const rows = await this.model.list({ includeDisabled: opts?.includeDisabled ?? true });
    return this.withViewFields(rows);
  };

  get = async (id: string): Promise<ApprovalRuleView> => {
    await this.assertReady();
    const row = await this.model.findById(id);
    if (!row) {
      throw new DingtalkWorkspaceError('DINGTALK_NOT_FOUND');
    }
    const views = await this.withViewFields([row]);
    const view = views[0];
    if (!view) {
      throw new DingtalkWorkspaceError('DINGTALK_NOT_FOUND');
    }
    return view;
  };

  listRuns = async (id: string, opts?: { limit?: number }) => {
    await this.assertReady();
    const row = await this.model.findById(id);
    if (!row) throwWorkspace('DINGTALK_NOT_FOUND');
    return this.model.listRuns(id, opts);
  };

  create = async (input: ApprovalRuleCreateInput): Promise<DingtalkApprovalRuleItem> => {
    const { identity, tier } = await this.assertWritable();
    await this.assertActiveLimit();

    const name = trimName(input.name);
    const remark = trimRemark(input.remark);
    const conditions = await normalizeApprovalRuleConditions(
      this.db,
      validateConditionsShape(input.conditions),
      identity.staffId,
    );
    const template = await this.requireVisibleTemplate(input.processCode);
    const schema = await this.approval.getTemplateSchema(input.processCode);
    validateConditionsAgainstSchema(conditions, schema.fields);

    const action = input.action;
    const redirect = await this.resolveRedirectTarget({
      action,
      identityStaffId: identity.staffId,
      token: input.redirectToStaffToken,
    });
    this.assertActionPayload(action, remark, redirect);

    const expiresAt = resolveExpiry({
      expiresAt:
        input.expiresAt === undefined
          ? undefined
          : input.expiresAt === null
            ? null
            : parseDateInput(input.expiresAt),
      now: new Date(),
      tier,
    });

    const created = await this.model.create({
      action,
      conditions,
      createdByTopicId: input.createdByTopicId ?? null,
      expiresAt,
      name,
      processCode: template.processCode,
      processName: template.name,
      redirectToName: redirect?.name ?? null,
      redirectToStaffId: redirect?.staffId ?? null,
      remark,
      staffId: identity.staffId,
    });
    const saved =
      input.enabled === false ? await this.model.update(created.id, { enabled: false }) : created;
    invalidateApprovalRuleWorkerMemory(identity.staffId);
    await appendRuleAudit({
      action: 'create',
      db: this.db,
      processName: saved.processName,
      ruleName: saved.name,
      targetId: saved.id,
      userId: this.userId,
    });
    return saved;
  };

  update = async (
    id: string,
    patch: ApprovalRuleUpdateInput,
  ): Promise<DingtalkApprovalRuleItem> => {
    const { identity, tier } = await this.assertWritable();
    const existing = await this.model.findById(id);
    if (!existing) {
      throw new DingtalkWorkspaceError('DINGTALK_NOT_FOUND');
    }

    if (patch.enabled === true && !existing.enabled) {
      assertOwnerMayEnable(existing);
      await this.assertActiveLimit();
    }

    const nextAction = patch.action ?? existing.action;
    const nextRemark = patch.remark === undefined ? existing.remark : trimRemark(patch.remark);
    const nextConditions =
      patch.conditions === undefined
        ? existing.conditions
        : await normalizeApprovalRuleConditions(
            this.db,
            validateConditionsShape(patch.conditions),
            identity.staffId,
          );
    const processCode = patch.processCode ?? existing.processCode;

    if (patch.conditions || patch.processCode) {
      const schema = await this.approval.getTemplateSchema(processCode);
      validateConditionsAgainstSchema(nextConditions, schema.fields);
    }
    if (patch.processCode && patch.processCode !== existing.processCode) {
      await this.requireVisibleTemplate(patch.processCode);
    }

    let redirectToStaffId = existing.redirectToStaffId;
    let redirectToName = existing.redirectToName;
    if (patch.redirectToStaffToken !== undefined) {
      if (!patch.redirectToStaffToken) {
        redirectToStaffId = null;
        redirectToName = null;
      } else {
        const redirect = await this.resolveRedirectTarget({
          action: nextAction,
          identityStaffId: identity.staffId,
          token: patch.redirectToStaffToken,
        });
        redirectToStaffId = redirect?.staffId ?? null;
        redirectToName = redirect?.name ?? null;
      }
    }

    this.assertActionPayload(nextAction, nextRemark, {
      name: redirectToName ?? '',
      staffId: redirectToStaffId ?? '',
    });

    const next: DingtalkApprovalRuleUpdatePatch = {};
    if (patch.name !== undefined) next.name = trimName(patch.name);
    if (patch.action !== undefined) next.action = patch.action;
    if (patch.remark !== undefined) next.remark = nextRemark;
    if (patch.conditions !== undefined) next.conditions = nextConditions;
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.processCode !== undefined) {
      const template = await this.requireVisibleTemplate(patch.processCode);
      next.processCode = template.processCode;
      next.processName = template.name;
    }
    if (patch.redirectToStaffToken !== undefined) {
      next.redirectToStaffId = redirectToStaffId;
      next.redirectToName = redirectToName;
    }
    if (patch.expiresAt !== undefined) {
      next.expiresAt = resolveExpiry({
        expiresAt: patch.expiresAt === null ? null : parseDateInput(patch.expiresAt),
        now: new Date(),
        tier,
      });
    }

    try {
      const saved = await this.model.update(id, next);
      invalidateApprovalRuleWorkerMemory(identity.staffId);
      await appendRuleAudit({
        action: patch.enabled === false ? 'disable' : 'update',
        db: this.db,
        processName: saved.processName ?? existing.processName,
        ruleName: saved.name ?? existing.name,
        targetId: saved.id,
        userId: this.userId,
      });
      return saved;
    } catch (error) {
      if (error instanceof DingtalkApprovalRuleEnableBlockedError) {
        throwWorkspace(error.blocked === 'expired' ? 'DINGTALK_INVALID' : 'DINGTALK_FORBIDDEN');
      }
      throw error;
    }
  };

  remove = async (id: string): Promise<{ success: true }> => {
    const identity = await this.assertReady();
    const existing = await this.model.findById(id);
    const deleted = await this.model.delete(id);
    if (!deleted) throwWorkspace('DINGTALK_NOT_FOUND');
    invalidateApprovalRuleWorkerMemory(identity.staffId);
    await appendRuleAudit({
      action: 'delete',
      db: this.db,
      processName: existing?.processName,
      ruleName: existing?.name,
      targetId: id,
      userId: this.userId,
    });
    return { success: true };
  };

  setEnabled = async (id: string, enabled: boolean): Promise<DingtalkApprovalRuleItem> =>
    this.update(id, { enabled });

  previewRule = async (input: ApprovalRuleCreateInput): Promise<ApprovalRulePreview> => {
    const { identity, tier } = await this.assertWritable();
    const name = trimName(input.name);
    const remark = trimRemark(input.remark);
    const conditions = await normalizeApprovalRuleConditions(
      this.db,
      validateConditionsShape(input.conditions),
      identity.staffId,
    );
    const template = await this.requireVisibleTemplate(input.processCode);
    const schema = await this.approval.getTemplateSchema(input.processCode);
    validateConditionsAgainstSchema(conditions, schema.fields);
    const redirect = await this.resolveRedirectTarget({
      action: input.action,
      identityStaffId: identity.staffId,
      token: input.redirectToStaffToken,
    });
    this.assertActionPayload(input.action, remark, redirect);

    const expiresAt = resolveExpiry({
      expiresAt:
        input.expiresAt === undefined
          ? undefined
          : input.expiresAt === null
            ? null
            : parseDateInput(input.expiresAt),
      now: new Date(),
      tier,
    });

    const [user] = await this.directory.getUsers([identity.staffId]);
    const limits = APPROVAL_AUTOMATION_TIERS[tier];
    const warnings: string[] = [];
    if (!expiresAt) warnings.push('该规则永久有效，直至您停用或删除。');
    if (limits.perRuleDailyCap != null) {
      warnings.push(`每条规则每日最多自动处理 ${limits.perRuleDailyCap} 次。`);
    }
    if (input.action === 'comment') {
      warnings.push('评论不会结束审批任务，单据仍会留在待办中。');
    }

    const actionValue =
      input.action === 'redirect'
        ? `转交给 ${redirect?.name ?? ''}`.trim()
        : actionLabel(input.action);

    return {
      actingAs: { deptPath: user?.deptPath ?? '', name: identity.name },
      danger: input.action === 'refuse' || input.action === 'redirect',
      lines: [
        { label: '规则名称', value: name },
        { label: '审批模板', value: template.name },
        { label: '匹配条件', value: summarizeConditions(conditions) },
        { label: '自动操作', value: actionValue },
        ...(remark ? [{ label: '备注', value: remark }] : []),
        {
          label: '有效期',
          value: expiresAt ? expiresAt.toISOString() : '永久',
        },
      ],
      title: `自动审批规则「${name}」`,
      warnings,
    };
  };

  private withViewFields = async (
    rows: DingtalkApprovalRuleItem[],
  ): Promise<ApprovalRuleView[]> => {
    const capabilities = await getDingtalkWorkspaceCapabilities();
    const dailyCap = APPROVAL_AUTOMATION_TIERS[capabilities.automationTier].perRuleDailyCap;
    const allLabels = await resolveOriginatorLabels(
      this.db,
      rows.map((row) => row.conditions),
    );
    return rows.map((row) => ({
      ...row,
      dailyCap,
      originatorLabels: pickOriginatorLabels(row.conditions, allLabels),
    }));
  };

  private assertReady = async (): Promise<VerifiedDingtalkIdentity> => {
    await assertDingtalkFeature('approval');
    return requireVerifiedDingtalkIdentity(this.db, this.userId);
  };

  private assertWritable = async () => {
    await assertDingtalkFeature('approval');
    const identity = await requireVerifiedDingtalkIdentity(this.db, this.userId);
    const capabilities = await getDingtalkWorkspaceCapabilities();
    if (!capabilities.approval || capabilities.automationTier === 'off') {
      throwWorkspace('DINGTALK_AUTOMATION_OFF');
    }
    return { identity, tier: capabilities.automationTier };
  };

  private assertActiveLimit = async (): Promise<void> => {
    const active = await this.model.countActive();
    if (active >= DINGTALK_APPROVAL_ACTIVE_RULE_LIMIT) throwWorkspace('DINGTALK_RULE_LIMIT');
  };

  private requireVisibleTemplate = async (
    processCode: string,
  ): Promise<{ name: string; processCode: string }> => {
    const templates = await this.approval.listTemplates();
    const template = templates.find((item) => item.processCode === processCode);
    if (!template) {
      throw new DingtalkWorkspaceError('DINGTALK_NOT_FOUND');
    }
    return template;
  };

  private resolveRedirectTarget = async (input: {
    action: ApprovalRuleAction;
    identityStaffId: string;
    token?: string;
  }): Promise<{ name: string; staffId: string } | null> => {
    if (input.action !== 'redirect') return null;
    const token = input.token?.trim();
    if (!token) throwWorkspace('DINGTALK_INVALID');
    const resolved = await resolveStaff(this.db, token);
    if (isStaffHit(resolved)) {
      if (resolved.staffId === input.identityStaffId) throwWorkspace('DINGTALK_INVALID');
      return { name: resolved.name, staffId: resolved.staffId };
    }
    if ('ambiguous' in resolved) throwWorkspace('DINGTALK_AMBIGUOUS');
    throwWorkspace('DINGTALK_NOT_FOUND');
  };

  private assertActionPayload = (
    action: ApprovalRuleAction,
    remark: string | null,
    redirect: { name: string; staffId: string } | null,
  ): void => {
    if (action === 'refuse' && !remark) throwWorkspace('DINGTALK_INVALID');
    if (action === 'redirect' && !redirect?.staffId) throwWorkspace('DINGTALK_INVALID');
  };
}
