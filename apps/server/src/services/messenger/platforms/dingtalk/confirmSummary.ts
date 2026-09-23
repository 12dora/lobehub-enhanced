import { appEnv } from '@/envs/app';

const API_LABELS: Record<string, string> = {
  addApprover: '加签',
  approveTask: '同意审批',
  commentApproval: '审批评论',
  completeTodo: '完成待办',
  createApprovalRule: '创建审批规则',
  createEvent: '创建日程',
  createTodo: '创建待办',
  deleteApprovalRule: '删除审批规则',
  deleteEvent: '删除日程',
  deleteTemplate: '删除审批模板',
  deleteTodo: '删除待办',
  refuseTask: '拒绝审批',
  respondEvent: '回复日程',
  returnTask: '退回审批',
  saveTemplate: '保存审批模板',
  submitApproval: '发起审批',
  transferTask: '转交审批',
  updateApprovalRule: '更新审批规则',
  updateEvent: '更新日程',
  updateTodo: '更新待办',
  withdrawApplication: '撤回申请',
};

const ARG_LABELS: Record<string, string> = {
  bizAlias: '别名',
  comment: '意见',
  componentId: '控件ID',
  default: '默认',
  defaultValue: '默认',
  description: '说明',
  dueTime: '截止时间',
  end: '结束',
  endTime: '结束时间',
  format: '格式',
  name: '名称',
  options: '选项',
  placeholder: '占位',
  processCode: '模板编码',
  reason: '原因',
  remark: '备注',
  result: '结果',
  start: '开始',
  startTime: '开始时间',
  subject: '标题',
  summary: '摘要',
  title: '标题',
  unit: '单位',
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Show the value the caller submitted. Do not drop it because it looks like an id. */
const formatValue = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
          return String(item);
        }
        if (item == null) return '';
        return JSON.stringify(item);
      })
      .filter((item) => item.length > 0)
      .join('、');
  }
  return JSON.stringify(value);
};

const formatOptions = (value: unknown): string => {
  if (!Array.isArray(value)) return formatValue(value);
  return value
    .map((item) => {
      if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        return String(item);
      }
      const record = asRecord(item);
      if (!record) return '';
      const label = asString(record.label);
      const raw = record.value;
      const optionValue =
        typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean'
          ? String(raw)
          : undefined;
      if (label && optionValue && label !== optionValue) return `${label}（${optionValue}）`;
      return label || optionValue || JSON.stringify(record);
    })
    .filter((item) => item.length > 0)
    .join('、');
};

/** One DingTalk-friendly block per control. Every submitted key is listed. */
const formatField = (field: Record<string, unknown>, depth = 0): string => {
  const props = asRecord(field.props) ?? {};
  const view: Record<string, unknown> = { ...props, ...field };
  delete view.props;
  const pad = '  '.repeat(depth);
  const label = asString(view.label) ?? '（未命名）';
  const type = asString(view.componentType);
  const flag = view.required === true ? '必填' : view.required === false ? '选填' : '';
  const meta = [type, flag].filter(Boolean).join('，');
  const lines = [`${pad}- ${label}${meta ? `（${meta}）` : ''}`];
  const skip = new Set(['label', 'componentType', 'required', 'children']);
  for (const [key, value] of Object.entries(view)) {
    if (skip.has(key) || value == null || value === '') continue;
    const rendered = key === 'options' ? formatOptions(value) : formatValue(value);
    if (!rendered) continue;
    lines.push(`${pad}  ${ARG_LABELS[key] ?? key}：${rendered}`);
  }
  if (Array.isArray(view.children)) {
    const children = view.children
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => !!item);
    if (children.length > 0) {
      lines.push(`${pad}  子字段：`);
      for (const child of children) lines.push(formatField(child, depth + 2));
    }
  }
  return lines.join('\n');
};

const formatFields = (fields: unknown[]): string => {
  const blocks = fields
    .map((item) => {
      const record = asRecord(item);
      return record ? formatField(record) : formatValue(item);
    })
    .filter((item) => item.length > 0);
  return blocks.length > 0 ? blocks.join('\n') : '无';
};

/**
 * Id keys are omitted only when args also carry a human label for the same
 * object. A bare taskId stays on the card: there is nothing else to confirm.
 */
const INTERNAL_ID_LABELS: Record<string, readonly string[]> = {
  activityId: ['activityName', 'name', 'title'],
  deptId: ['deptName', 'deptPath'],
  eventId: ['name', 'subject', 'summary', 'title'],
  processCode: ['name', 'processName', 'title'],
  processInstanceId: ['name', 'subject', 'title'],
  redirectToStaffToken: ['redirectToName', 'toStaffName'],
  sourceId: ['name', 'subject', 'title'],
  targetActivityId: ['activityName', 'name', 'title'],
  taskId: ['name', 'subject', 'title'],
  toStaffToken: ['staffName', 'toStaffName'],
};

const labelPresent = (args: Record<string, unknown>, keys: readonly string[]): boolean =>
  keys.some((key) => typeof args[key] === 'string' && args[key].trim().length > 0);

const shouldHideInternalId = (
  args: Record<string, unknown>,
  key: string,
  value: unknown = args[key],
): boolean => {
  const labels = INTERNAL_ID_LABELS[key];
  if (labels && labelPresent(args, labels)) return true;
  return (
    key === 'id' &&
    typeof value === 'string' &&
    value.startsWith('dar_') &&
    labelPresent(args, ['name', 'title'])
  );
};

export interface DingTalkConfirmToolView {
  apiName?: string;
  args: Record<string, unknown>;
  identifier?: string;
}

/**
 * Human-readable confirm body. Lines, not a table. `saveTemplate` lists every
 * control with its type, required flag, options, defaults, and any other key.
 * An internal id key is omitted when args already carry a human label for that
 * object. Every other submitted value is kept, even when it looks like an id.
 */
export const formatDingTalkConfirmSummary = (
  tool: DingTalkConfirmToolView,
): { content: string; title: string } => {
  const apiName = tool.apiName ?? '';
  const action = API_LABELS[apiName] ?? (apiName || tool.identifier || '操作');

  if (apiName === 'saveTemplate') {
    const name = asString(tool.args.name) ?? '';
    const processCode = asString(tool.args.processCode);
    const fields = Array.isArray(tool.args.fields) ? tool.args.fields : [];
    const title = name ? (processCode ? `更新模板「${name}」` : `创建模板「${name}」`) : action;
    const lines = [`模板名称：${name || '（未填写）'}`, `操作：${processCode ? '更新' : '创建'}`];
    if (processCode && !shouldHideInternalId(tool.args, 'processCode', processCode)) {
      lines.push(`模板编码：${processCode}`);
    }
    lines.push(`控件：\n${formatFields(fields)}`);
    for (const [key, value] of Object.entries(tool.args)) {
      if (key === 'name' || key === 'processCode' || key === 'fields') continue;
      if (shouldHideInternalId(tool.args, key, value)) continue;
      const rendered = formatValue(value);
      if (!rendered) continue;
      lines.push(`${ARG_LABELS[key] ?? key}：${rendered}`);
    }
    return { content: lines.join('\n'), title };
  }

  const title = action;
  const lines = [`操作：${action}`];
  for (const [key, value] of Object.entries(tool.args)) {
    if (shouldHideInternalId(tool.args, key, value)) continue;
    const rendered = formatValue(value);
    if (!rendered) continue;
    lines.push(`${ARG_LABELS[key] ?? key}：${rendered}`);
  }
  if (lines.length === 1) lines.push('参数：无');
  return { content: lines.join('\n'), title };
};

export interface DingTalkPreviewCard {
  danger?: boolean;
  lines?: Array<{ label?: string; value?: string }>;
  title?: string;
  warnings?: string[];
}

export interface DingTalkRenderedConfirm {
  /**
   * When false, both buttons stay on the card and the server ignores 批准.
   * The web-confirm instruction is `note`.
   */
  allowApprove?: boolean;
  content: string;
  /** Hint line copied onto the card `note` variable. */
  note?: string;
  title: string;
}

const previewLine = (label: unknown, value: unknown): string => {
  const name = typeof label === 'string' ? label.trim() : '';
  const text = typeof value === 'string' ? value : '';
  if (!name && !text) return '';
  if (!name) return text;
  return text ? `${name}：${text}` : name;
};

/**
 * Card body from a server preview. `saveTemplate` preview lines name the
 * controls but drop options, defaults, and required flags, so the full field
 * block is appended. Other user-submitted args the preview does not list
 * (description, and so on) are appended too. Internal ids are not.
 */
export const formatDingTalkPreviewCard = (
  tool: DingTalkConfirmToolView,
  preview: DingTalkPreviewCard,
): DingTalkRenderedConfirm => {
  const explicitTitle = typeof preview.title === 'string' ? preview.title.trim() : '';
  const title = explicitTitle || formatDingTalkConfirmSummary(tool).title;
  const parts: string[] = [];
  if (preview.danger === true) parts.push('⚠️ 高风险操作');
  for (const line of preview.lines ?? []) {
    const rendered = previewLine(line?.label, line?.value);
    if (rendered) parts.push(rendered);
  }
  if ((tool.apiName ?? '') === 'saveTemplate') {
    const fields = Array.isArray(tool.args.fields) ? tool.args.fields : [];
    if (fields.length > 0) parts.push(`控件：\n${formatFields(fields)}`);
    for (const [key, value] of Object.entries(tool.args)) {
      if (key === 'name' || key === 'processCode' || key === 'fields') continue;
      if (shouldHideInternalId(tool.args, key, value)) continue;
      const rendered = formatValue(value);
      if (!rendered) continue;
      parts.push(`${ARG_LABELS[key] ?? key}：${rendered}`);
    }
  }
  for (const warning of preview.warnings ?? []) {
    if (typeof warning !== 'string') continue;
    const text = warning.trim();
    if (!text) continue;
    parts.push(text.startsWith('⚠️') ? text : `⚠️ ${text}`);
  }
  if (parts.length === 0) parts.push(title);
  return { content: parts.join('\n'), title };
};

/** Body when the name preview cannot resolve the operation. 批准 stays off. */
export const formatDingTalkPreviewUnavailable = (code: string, link: string): string => {
  const target = link.trim() || '当前话题';
  const safe = code.trim() || 'UNKNOWN';
  return `无法解析操作对象（${safe}），请到网页端确认：${target}`;
};

export const buildDingTalkTopicDeepLink = (agentId: string, topicId: string): string => {
  if (!agentId || !topicId) return '';
  const path = `/agent/${agentId}/${topicId}`;
  const base = (appEnv.APP_URL || '').replace(/\/$/, '');
  const wrapped = `/dingtalk/sso?redirect=${encodeURIComponent(path)}`;
  return base ? `${base}${wrapped}` : wrapped;
};

/** Tool text the model sees when the confirm card cannot be sent. */
export const formatDingTalkCardSendFailedContent = (link: string): string => {
  const target = link.trim() || '当前话题';
  return `该操作需要本人确认，钉钉内确认卡片发送失败；请到网页端 ${target} 确认`;
};
