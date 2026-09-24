import { formatDingTalkConfirmOverflowLine } from '@lobechat/chat-adapter-dingtalk';
import { markdownLink } from '@lobechat/utils/appLink';

import { serverAppLink } from '@/server/utils/appLinks';

const API_LABELS: Record<string, string> = {
  addApprover: '加签',
  appendDoc: '追加文档内容',
  appendSheetRows: '向表格追加行',
  approveTask: '同意审批',
  approveTasks: '批量同意审批',
  commentApproval: '审批评论',
  completeTodo: '完成待办',
  completeTodos: '批量完成待办',
  createAitableRecords: '新增 AI 表格记录',
  createApprovalRule: '创建审批规则',
  createDoc: '新建文档',
  createEvent: '创建日程',
  createTodo: '创建待办',
  deleteApprovalRule: '删除审批规则',
  deleteEvent: '删除日程',
  deleteTemplate: '删除审批模板',
  deleteTodo: '删除待办',
  deleteTodos: '批量删除待办',
  installPlugin: '安装技能',
  refuseTask: '拒绝审批',
  refuseTasks: '批量拒绝审批',
  respondEvent: '回复日程',
  returnTask: '退回审批',
  saveTemplate: '保存审批模板',
  saveUserQuestion: '保存助手设置',
  showAgentMarketplace: '打开助手市场',
  submitApproval: '发起审批',
  submitReport: '提交日志',
  transferTask: '转交审批',
  updateAitableRecords: '修改 AI 表格记录',
  updateApprovalRule: '更新审批规则',
  updateEvent: '更新日程',
  updateTodo: '更新待办',
  withdrawApplication: '撤回申请',
};

/** Leading verbs used to turn a single-item label into 「完成 3 项待办」. */
const COUNT_VERBS = [
  '完成',
  '删除',
  '创建',
  '更新',
  '同意',
  '拒绝',
  '提交',
  '发起',
  '转交',
  '撤回',
  '退回',
  '加签',
  '回复',
  '保存',
  '安装',
  '打开',
  '追加',
  '新建',
  '新增',
  '修改',
] as const;

export const hasDingTalkApiLabel = (apiName: string | undefined): boolean =>
  !!apiName && Object.prototype.hasOwnProperty.call(API_LABELS, apiName);

/**
 * Chinese action name. Never the raw English apiName.
 * A known label wins; otherwise the tool's manifest title, otherwise 「确认操作」.
 */
export const resolveDingTalkApiLabel = (
  apiName: string | undefined,
  manifestTitle?: string,
): string => {
  if (apiName && API_LABELS[apiName]) return API_LABELS[apiName];
  const title = manifestTitle?.trim();
  if (title) return `执行「${title}」操作`;
  return '确认操作';
};

/**
 * Labels whose 「项」 expansion is ungrammatical. These count rows or records.
 * 「向表格追加行」 + 15 → 「追加 15 行表格数据」.
 */
const COUNT_TITLE: Record<string, (count: number) => string> = {
  appendSheetRows: (count) => `追加 ${count} 行表格数据`,
  createAitableRecords: (count) => `新增 ${count} 条 AI 表格记录`,
  updateAitableRecords: (count) => `修改 ${count} 条 AI 表格记录`,
};

/** 「完成待办」 + 3 → 「完成 3 项待办」. Unknown apis use 「确认 N 项操作」. */
export const formatDingTalkCountTitle = (apiName: string, count: number): string => {
  const custom = COUNT_TITLE[apiName];
  if (custom) return custom(count);
  const label = API_LABELS[apiName];
  if (!label) return `确认 ${count} 项操作`;
  const stripped = label.replace(/^批量/, '').replace(/多项/, '');
  const verb = COUNT_VERBS.find((item) => stripped.startsWith(item));
  if (!verb) return `确认 ${count} 项操作`;
  const object = stripped.slice(verb.length);
  return object ? `${verb} ${count} 项${object}` : `${verb} ${count} 项`;
};

/** Batch writes count rows, not calls. Two completeTodos (3+2) is 「完成 5 项待办」. */
const BATCH_ITEM_ARGS: Record<string, string> = {
  appendSheetRows: 'rows',
  approveTasks: 'tasks',
  completeTodos: 'taskIds',
  createAitableRecords: 'records',
  deleteTodos: 'taskIds',
  refuseTasks: 'tasks',
  updateAitableRecords: 'records',
};

export interface DingTalkAggregateCall {
  apiName?: string;
  args?: Record<string, unknown>;
}

const batchItemCount = (call: DingTalkAggregateCall): number => {
  const key = call.apiName ? BATCH_ITEM_ARGS[call.apiName] : undefined;
  if (!key) return 1;
  const value = call.args?.[key];
  return Array.isArray(value) && value.length > 0 ? value.length : 1;
};

/**
 * Card title for one parked turn.
 * N=1 keeps the single preview title. N>1 with one apiName uses the count
 * title (batch apis sum taskIds/tasks/rows/records). Mixed apis use 「确认 N 项操作」.
 */
export const formatDingTalkAggregateTitle = (
  calls: DingTalkAggregateCall[],
  singleTitle: string,
): string => {
  if (calls.length <= 1) return singleTitle;
  const first = calls[0]?.apiName ?? '';
  if (first && calls.every((call) => call.apiName === first)) {
    const count = calls.reduce((sum, call) => sum + batchItemCount(call), 0);
    return formatDingTalkCountTitle(first, count);
  }
  return `确认 ${calls.length} 项操作`;
};

const aggregateLines = (content: string, title: string): string[] =>
  content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== title);

/**
 * One numbered block per parked call: preview title, then every preview line
 * and warning. The 900-character card cap turns an overflow into web-only.
 */
export const formatDingTalkAggregateBody = (
  items: Array<{ content: string; title: string }>,
): string =>
  items
    .map((item, index) => {
      const lines = aggregateLines(item.content, item.title);
      if (lines.length === 0) return `${index + 1}. ${item.title}`;
      const [first, ...rest] = lines;
      const head = `${index + 1}. ${item.title} — ${first}`;
      if (rest.length === 0) return head;
      return [head, ...rest.map((line) => `   ${line}`)].join('\n');
    })
    .join('\n');

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
  /** `manifest.meta.title` when the api has no Chinese label. */
  manifestTitle?: string;
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
  const action = resolveDingTalkApiLabel(apiName, tool.manifestTitle);

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
  /**
   * Sanitized invalid-args reason. When set, the calls are refused so the
   * model sees this text and can split or fix the write. 批准 stays off.
   */
  refusalReason?: string;
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

/** More parked calls than the card can preview. 批准 stays off; nothing is looked up. */
export const formatDingTalkOversizedBatch = (
  calls: DingTalkAggregateCall[],
  link: string,
): DingTalkRenderedConfirm => ({
  allowApprove: false,
  content: `共 ${calls.length} 项操作，请到网页端确认。`,
  note: formatDingTalkConfirmOverflowLine(link),
  title: formatDingTalkAggregateTitle(calls, '确认操作'),
});

const INVALID_PREVIEW_CODES = new Set([
  'DINGTALK_INVALID',
  'DINGTALK_PERSONAL_INVALID_ARGS',
  'VALIDATION',
]);

const PREVIEW_DETAIL_MAX = 150;
const PREVIEW_DETAIL_PREFIX = /^参数无效（\w+）：/;
const PREVIEW_DETAIL_SECRET = /bearer|password|postgres:\/\/|secret|token/i;

/**
 * Model- and card-facing invalid-args text. Strips 「参数无效（CODE）：」 and
 * caps the length. A secret-looking string is dropped so it never reaches
 * the card or the model.
 */
export const sanitizeDingTalkPreviewDetail = (raw: string): string | undefined => {
  let text = raw.replaceAll(/\s+/g, ' ').trim().replace(PREVIEW_DETAIL_PREFIX, '').trim();
  if (!text || PREVIEW_DETAIL_SECRET.test(text)) return undefined;
  if (text.length > PREVIEW_DETAIL_MAX) text = text.slice(0, PREVIEW_DETAIL_MAX).trim();
  return text || undefined;
};

/**
 * Invalid-args preview failures carry `details.message` (docs, personal,
 * workspace, approval). Other codes stay on the generic 「无法解析操作对象」 line.
 */
export const dingTalkInvalidPreviewDetail = (error: unknown, code: string): string | undefined => {
  if (!INVALID_PREVIEW_CODES.has(code)) return undefined;
  if (!error || typeof error !== 'object') return undefined;
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const message = (details as { message?: unknown }).message;
  if (typeof message !== 'string') return undefined;
  return sanitizeDingTalkPreviewDetail(message);
};

/** Body when the name preview cannot resolve the operation. 批准 stays off. */
export const formatDingTalkPreviewUnavailable = (
  code: string,
  link: string,
  detail?: string,
): string => {
  const target = link.trim() || '当前话题';
  const safe = code.trim() || 'UNKNOWN';
  const reason = detail?.trim();
  // Card `note` is plain text. A bare https URL stays clickable; markdown would show the brackets.
  if (reason) return `${reason}，请到网页端确认：${target}`;
  return `无法解析操作对象（${safe}），请到网页端确认：${target}`;
};

export const buildDingTalkTopicDeepLink = (agentId: string, topicId: string): string => {
  if (!agentId || !topicId) return '';
  return serverAppLink(`/agent/${agentId}/${topicId}`, 'dingtalk');
};

/** Tool text the model sees when the confirm card cannot be sent. */
export const formatDingTalkCardSendFailedContent = (link: string): string => {
  const target = link.trim();
  if (!target) return '该操作需要本人确认，钉钉内确认卡片发送失败；请到网页端确认';
  return `该操作需要本人确认，钉钉内确认卡片发送失败；请到${markdownLink('网页端', target)}确认`;
};

/**
 * Markdown form of the overflow line, for a DingTalk markdown reply.
 * The card `note` keeps {@link formatDingTalkConfirmOverflowLine}'s bare URL.
 */
export const formatDingTalkWebConfirmMarkdown = (link: string): string => {
  const target = link.trim();
  const line = formatDingTalkConfirmOverflowLine(target);
  if (!target || !line.includes(target)) return line;
  return line.replace(target, markdownLink('网页端', target));
};
