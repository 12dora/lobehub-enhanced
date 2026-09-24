import {
  type AuthRequiredState,
  DingtalkPersonalApiName as DingtalkPersonalApi,
  type DingtalkPersonalApiName,
  type DingtalkPersonalLoginView,
  type DingtalkPersonalPreview,
  type DingtalkPersonalToolState,
  type FileState,
  type WriteState,
} from '@lobechat/builtin-tool-dingtalk-personal';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';
import {
  adminEntrySuffix,
  APP_LINK_PATHS,
  type AppLinkResolver,
  buildAppUrl,
  cliSettingsMarkdownLink,
  dingtalkIdentityGuidance,
  markdownLink,
  oaAdminMarkdownLink,
} from '@lobechat/utils/appLink';
import debug from 'debug';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';

import { dingtalkDirectoryUsers } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import {
  appendDingtalkPersonalAudit,
  DingtalkPersonalError,
  DingtalkPersonalService,
} from '@/server/enterprise/services/dingtalkPersonal';
import { sendDingtalkPersonalAuthCard } from '@/server/services/messenger/platforms/dingtalk/personalAuthCard';
import { serverAppLinkResolver } from '@/server/utils/appLinks';

import { isDingtalkVerificationUrl } from './brokerClient';
import type { IngestedDingtalkFile } from './fileIngest';
import { ingestDingtalkPersonalFile } from './fileIngest';
import {
  projectGroups,
  projectMessages,
  projectReportDetail,
  projectReports,
  projectSubmittedReportId,
  projectTemplate,
  projectTemplates,
  projectTodoDetail,
  projectTodoList,
  projectWriteSubject,
} from './projection';

const log = debug('lobe-server:dingtalk-personal');

const DAY_MS = 24 * 60 * 60 * 1000;
const MESSAGE_WINDOW_MS = 7 * DAY_MS;
const INBOX_WINDOW_MS = 180 * DAY_MS;
const OUTBOX_WINDOW_MS = 20 * DAY_MS;
const CONTENT_LIMIT = 30_000;
const FILE_TEXT_LIMIT = 200_000;
const FILE_PREVIEW_LIMIT = 2_000;
const AUDIT_TEXT_MAX = 200;
const ID_PATTERN = /^[\w\-+/=.:]{1,256}$/;
// eslint-disable-next-line no-control-regex -- reject control characters in user input
const CONTROL_STRICT = /[\u0000-\u001F\u007F]/;
// eslint-disable-next-line no-control-regex -- reject control characters in user input
const CONTROL_LOOSE = /[\u0000-\u0008\v\f\u000E-\u001F\u007F]/;

const WRITE_UNKNOWN_CONTENT = '这次操作的结果未知，可能已经执行。请先到钉钉里核实，不要重复提交。';

const logFailure = (event: string, error: unknown): void => {
  let code = 'UnknownError';
  if (error instanceof Error) code = error.name;
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_]+$/.test(error.code)
  ) {
    code = error.code;
  }
  log('%s %s', event, code);
};

const INTERNAL_CONTENT = '钉钉个人数据暂时不可用（DINGTALK_PERSONAL_INTERNAL），请稍后重试。';

const PRIORITY_LABEL: Record<number, string> = {
  10: '较低',
  20: '普通',
  30: '较高',
  40: '紧急',
};

const FEATURE_LABEL: Record<string, string> = {
  chat: '群聊消息',
  report: '工作日志',
  todo: '待办',
  write: '写操作',
};

const identityLine = (prefix: string, links: AppLinkResolver, platform?: string | null): string =>
  `${prefix}${dingtalkIdentityGuidance(links, platform)}`;

/** Same strings as {@link DingtalkPersonalApi}, in the order the tool router publishes. */
export const DINGTALK_PERSONAL_API_NAMES = [
  DingtalkPersonalApi.listMyTodos,
  DingtalkPersonalApi.getTodo,
  DingtalkPersonalApi.searchGroups,
  DingtalkPersonalApi.listMyGroups,
  DingtalkPersonalApi.listGroupMessages,
  DingtalkPersonalApi.searchMessages,
  DingtalkPersonalApi.downloadMessageFile,
  DingtalkPersonalApi.listReports,
  DingtalkPersonalApi.getReport,
  DingtalkPersonalApi.listReportTemplates,
  DingtalkPersonalApi.getReportTemplate,
  DingtalkPersonalApi.updateTodo,
  DingtalkPersonalApi.completeTodo,
  DingtalkPersonalApi.submitReport,
] as [DingtalkPersonalApiName, ...DingtalkPersonalApiName[]];

export type { DingtalkPersonalApiName };

export interface DingtalkPersonalToolContext {
  botPlatform?: string;
  /** Chat-sdk thread id (`dingtalk:<conversationId>[:<senderStaffId>]`). */
  botThreadId?: string;
  /** Manual-action links for this surface. Defaults to `serverAppLinkResolver(botPlatform)`. */
  resolveLink?: AppLinkResolver;
  topicId?: string;
  workspaceId?: string;
}

interface WriteAudit {
  action: 'report.submit' | 'todo.complete' | 'todo.update';
  afterDiff?: Record<string, unknown> | null;
  targetId?: string;
}

interface ToolSuccess {
  audit?: WriteAudit;
  content?: string;
  state: Exclude<DingtalkPersonalToolState, AuthRequiredState>;
}

const idField = (label: string) =>
  z
    .string({ invalid_type_error: `${label}必须是字符串`, required_error: `缺少${label}` })
    .trim()
    .regex(ID_PATTERN, `${label}格式无效`);

const lineText = (label: string, max: number) =>
  z
    .string({ invalid_type_error: `${label}必须是字符串`, required_error: `缺少${label}` })
    .trim()
    .min(1, `${label}不能为空`)
    .max(max, `${label}不能超过 ${max} 个字符`)
    .refine((value) => !CONTROL_STRICT.test(value), `${label}包含非法字符`);

const isoTime = (label: string) =>
  z
    .string({ invalid_type_error: `${label}必须是字符串`, required_error: `缺少${label}` })
    .trim()
    .min(1, `${label}不能为空`)
    .refine((value) => !CONTROL_STRICT.test(value), `${label}包含非法字符`)
    .refine((value) => Number.isFinite(Date.parse(value)), `${label}不是有效时间`);

const prioritySchema = z.union([z.literal(10), z.literal(20), z.literal(30), z.literal(40)], {
  errorMap: () => ({ message: '优先级只能是 10、20、30 或 40' }),
});

const statusSchema = z.enum(['open', 'done', 'all'], {
  errorMap: () => ({ message: 'status 只能是 open、done 或 all' }),
});

const boxSchema = z.enum(['inbox', 'outbox'], {
  errorMap: () => ({ message: 'box 只能是 inbox 或 outbox' }),
});

const resourceTypeSchema = z.enum(['fileId', 'mediaId'], {
  errorMap: () => ({ message: 'resourceType 只能是 fileId 或 mediaId' }),
});

const optionalCursor = z
  .string({ invalid_type_error: 'cursor 必须是字符串' })
  .trim()
  .min(1, 'cursor 不能为空')
  .max(4096, 'cursor 过长')
  .refine((value) => !CONTROL_STRICT.test(value), 'cursor 包含非法字符')
  .optional();

const reportContentSchema = z
  .string({ invalid_type_error: '内容必须是字符串', required_error: '缺少内容' })
  .max(5000, '单条内容不能超过 5000 个字符')
  .refine((value) => !CONTROL_LOOSE.test(value), '内容包含非法字符');

const windowIssue = (
  value: { endTime?: string; startTime?: string },
  maxMs: number,
  tooLong: string,
  ctx: z.RefinementCtx,
) => {
  if (!value.startTime || !value.endTime) return;
  const start = Date.parse(value.startTime);
  const end = Date.parse(value.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  if (end <= start) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '结束时间必须晚于开始时间' });
    return;
  }
  if (end - start > maxMs) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: tooLong });
  }
};

const listTodosSchema = z
  .object({
    page: z
      .number({ invalid_type_error: '页码必须是数字' })
      .int('页码必须是整数')
      .min(1, '页码最小为 1')
      .max(40, '页码最大为 40')
      .optional(),
    status: statusSchema.optional(),
  })
  .strict();

const taskSchema = z.object({ taskId: idField('taskId') }).strict();

const searchGroupsSchema = z.object({ query: lineText('关键词', 500) }).strict();

const listGroupsSchema = z.object({ cursor: optionalCursor }).strict();

const listMessagesSchema = z
  .object({
    conversationId: idField('conversationId'),
    endTime: isoTime('结束时间'),
    maxMessages: z
      .number({ invalid_type_error: '条数必须是数字' })
      .int('条数必须是整数')
      .min(1, '条数最少为 1')
      .max(500, '单次最多读取 500 条消息')
      .optional(),
    startTime: isoTime('开始时间'),
  })
  .strict()
  .superRefine((value, ctx) => {
    windowIssue(value, MESSAGE_WINDOW_MS, '群消息时间窗口不能超过 7 天', ctx);
  });

const searchMessagesSchema = z
  .object({
    conversationId: idField('conversationId').optional(),
    endTime: isoTime('结束时间').optional(),
    query: lineText('关键词', 500),
    startTime: isoTime('开始时间').optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    windowIssue(value, MESSAGE_WINDOW_MS, '消息搜索时间窗口不能超过 7 天', ctx);
  });

const downloadSchema = z
  .object({
    conversationId: idField('conversationId').optional(),
    fileName: z
      .string({ invalid_type_error: 'fileName 必须是字符串' })
      .trim()
      .min(1, 'fileName 不能为空')
      .max(240, 'fileName 过长')
      .refine((value) => !CONTROL_STRICT.test(value), 'fileName 包含非法字符')
      .optional(),
    messageId: idField('messageId').optional(),
    resourceId: idField('resourceId'),
    resourceType: resourceTypeSchema,
  })
  .strict();

const listReportsSchema = z
  .object({
    box: boxSchema,
    cursor: z
      .number({ invalid_type_error: 'cursor 必须是数字' })
      .int('cursor 必须是整数')
      .min(0, 'cursor 不能为负数')
      .optional(),
    endTime: isoTime('结束时间'),
    startTime: isoTime('开始时间'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.box === 'inbox') {
      windowIssue(value, INBOX_WINDOW_MS, '收件箱时间窗口不能超过 180 天', ctx);
      return;
    }
    windowIssue(value, OUTBOX_WINDOW_MS, '发件箱时间窗口不能超过 20 天', ctx);
  });

const reportIdSchema = z.object({ reportId: idField('reportId') }).strict();

const templateNameSchema = z.object({ name: lineText('模板名称', 500) }).strict();

const updateTodoSchema = z
  .object({
    dueTime: isoTime('截止时间').optional(),
    priority: prioritySchema.optional(),
    taskId: idField('taskId'),
    title: lineText('标题', 500).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined || value.dueTime !== undefined || value.priority !== undefined,
    { message: '请至少提供标题、截止时间或优先级中的一项' },
  );

const contentItemSchema = z
  .object({
    content: reportContentSchema,
    key: lineText('字段名', 200),
  })
  .strict();

const submitSchema = z
  .object({
    contents: z
      .array(contentItemSchema, {
        invalid_type_error: 'contents 必须是数组',
        required_error: '缺少 contents',
      })
      .min(1, '至少填写一项内容')
      .max(20, '最多提交 20 项内容'),
    templateName: lineText('模板名称', 500),
    toUserIds: z
      .array(idField('收件人'), {
        invalid_type_error: '收件人必须是数组',
        required_error: '缺少收件人',
      })
      .min(1, '至少指定一名收件人')
      .max(20, '最多指定 20 名收件人'),
  })
  .strict()
  .superRefine((value, ctx) => {
    const keys = new Set<string>();
    for (const item of value.contents) {
      if (keys.has(item.key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `日志字段「${item.key}」重复` });
        return;
      }
      keys.add(item.key);
    }
    const recipients = new Set<string>();
    for (const id of value.toUserIds) {
      if (recipients.has(id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `收件人「${id}」重复` });
        return;
      }
      recipients.add(id);
    }
  });

function invalidArgs(detail: string): never {
  const message = detail.startsWith('参数无效（DINGTALK_PERSONAL_INVALID_ARGS）')
    ? detail
    : `参数无效（DINGTALK_PERSONAL_INVALID_ARGS）：${detail}`;
  throw new DingtalkPersonalError('DINGTALK_PERSONAL_INVALID_ARGS', { message });
}

const formatZodIssue = (error: z.ZodError): string => {
  const issue = error.issues[0];
  if (!issue) return '参数无效';
  if (issue.code === 'unrecognized_keys' && 'keys' in issue && Array.isArray(issue.keys)) {
    return `包含无法识别的字段 ${issue.keys.join('、')}`;
  }
  const path = issue.path.length > 0 ? `${issue.path.join('.')}：` : '';
  return `${path}${issue.message}`;
};

const parseArgs = <T>(schema: z.ZodType<T>, args: unknown): T => {
  if (!args || typeof args !== 'object' || Array.isArray(args)) invalidArgs('参数必须是对象');
  const parsed = schema.safeParse(args);
  if (!parsed.success) invalidArgs(formatZodIssue(parsed.error));
  return parsed.data;
};

const compactArgs = (input: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));

const auditDiff = (input: Record<string, unknown>): Record<string, unknown> | null => {
  const diff: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (key === 'body' || key === 'content' || key === 'contents' || key === 'text') continue;
    if (typeof value === 'string') {
      diff[key] = value.length > AUDIT_TEXT_MAX ? value.slice(0, AUDIT_TEXT_MAX) : value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      diff[key] = value;
    }
  }
  return Object.keys(diff).length > 0 ? diff : null;
};

const readPersonalError = (
  error: unknown,
): { code: string; details?: Record<string, unknown> } | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { code?: unknown; details?: unknown; name?: unknown };
  const named = error instanceof DingtalkPersonalError || record.name === 'DingtalkPersonalError';
  if (!named || typeof record.code !== 'string') return undefined;
  const details =
    record.details && typeof record.details === 'object' && !Array.isArray(record.details)
      ? (record.details as Record<string, unknown>)
      : undefined;
  return { code: record.code, ...(details ? { details } : {}) };
};

const ownInvalidMessage = (details?: Record<string, unknown>): string | undefined => {
  const message = details?.message;
  if (typeof message !== 'string') return undefined;
  const text = message.trim();
  if (!text.includes('DINGTALK_PERSONAL_INVALID_ARGS') || text.length > 500) return undefined;
  if (/bearer|password|postgres:\/\/|secret|token/i.test(text)) return undefined;
  return text;
};

const upstreamDetail = (details?: Record<string, unknown>): string | undefined => {
  const message = details?.message;
  if (typeof message !== 'string') return undefined;
  const text = message.replaceAll(/\s+/g, ' ').trim();
  if (!text || text.length > 200) return undefined;
  if (/bearer|password|postgres:\/\/|secret|token/i.test(text)) return undefined;
  return text;
};

/** DingTalk-returned permission page. https only; http and script URLs are dropped. */
const httpUri = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const uri = value.trim();
  if (!/^https:\/\//i.test(uri) || uri.length > 2000) return undefined;
  try {
    if (new URL(uri).protocol !== 'https:') return undefined;
  } catch {
    return undefined;
  }
  return uri;
};

const failure = (
  content: string,
  code: string,
  state?: DingtalkPersonalToolState,
): BuiltinServerRuntimeOutput => ({
  content,
  error: { code, message: content },
  success: false,
  ...(state ? { state } : {}),
});

const isPersonalWriteApi = (apiName?: DingtalkPersonalApiName): boolean =>
  apiName === 'updateTodo' || apiName === 'completeTodo' || apiName === 'submitReport';

const linksOf = (ctx?: DingtalkPersonalToolContext): AppLinkResolver =>
  ctx?.resolveLink ?? serverAppLinkResolver(ctx?.botPlatform);

const contentFor = (
  code: string,
  details: Record<string, unknown> | undefined,
  apiName: DingtalkPersonalApiName | undefined,
  ctx?: DingtalkPersonalToolContext,
): string | undefined => {
  const resolveLink = linksOf(ctx);
  const platform = ctx?.botPlatform;
  const admin = adminEntrySuffix(resolveLink);
  if (
    (code === 'DINGTALK_PERSONAL_TIMEOUT' || code === 'DINGTALK_PERSONAL_BROKER_UNAVAILABLE') &&
    isPersonalWriteApi(apiName)
  ) {
    return WRITE_UNKNOWN_CONTENT;
  }
  switch (code) {
    case 'DINGTALK_IDENTITY_INACTIVE': {
      return `钉钉账号已停用或已离职（DINGTALK_IDENTITY_INACTIVE），无法操作待办或日程。请联系钉钉组织管理员在${oaAdminMarkdownLink()}处理。`;
    }
    case 'DINGTALK_IDENTITY_UNBOUND': {
      return identityLine(
        '当前账号未绑定钉钉身份（DINGTALK_IDENTITY_UNBOUND）。',
        resolveLink,
        platform,
      );
    }
    case 'DINGTALK_IDENTITY_UNVERIFIED': {
      return identityLine(
        '钉钉身份未经验证（DINGTALK_IDENTITY_UNVERIFIED）。',
        resolveLink,
        platform,
      );
    }
    case 'DINGTALK_PERSONAL_BROKER_UNAVAILABLE': {
      return '钉钉个人数据服务暂时不可用（DINGTALK_PERSONAL_BROKER_UNAVAILABLE），请稍后重试。';
    }
    case 'DINGTALK_PERSONAL_CORP_ID_MISSING': {
      return `当前钉钉连接器未配置企业 ID（DINGTALK_PERSONAL_CORP_ID_MISSING）。请联系管理员检查钉钉连接器配置${admin}。`;
    }
    case 'DINGTALK_PERSONAL_DISABLED': {
      return `管理员未开启钉钉个人数据（DINGTALK_PERSONAL_DISABLED）。请联系管理员在即时通讯连接器中开启${admin}。`;
    }
    case 'DINGTALK_PERSONAL_FEATURE_DISABLED': {
      const feature =
        typeof details?.feature === 'string' ? FEATURE_LABEL[details.feature] : undefined;
      const what = feature ? `「${feature}」` : '该能力';
      return `管理员未开启${what}（DINGTALK_PERSONAL_FEATURE_DISABLED）。请联系管理员在钉钉连接器中开启${admin}。`;
    }
    case 'DINGTALK_PERSONAL_FILE_TOO_LARGE': {
      return '文件超过 20 MB，无法下载（DINGTALK_PERSONAL_FILE_TOO_LARGE）。';
    }
    case 'DINGTALK_PERSONAL_INVALID_ARGS': {
      return (
        ownInvalidMessage(details) ??
        '参数无效（DINGTALK_PERSONAL_INVALID_ARGS）。请检查参数后重试。'
      );
    }
    case 'DINGTALK_PERSONAL_LOGIN_NOT_FOUND': {
      return '授权会话不存在或已结束（DINGTALK_PERSONAL_LOGIN_NOT_FOUND）。请重新发起授权。';
    }
    case 'DINGTALK_PERSONAL_ORG_POLICY_DENIED': {
      return `贵司钉钉管理员未开放该功能给 CLI（开发者后台 → ${cliSettingsMarkdownLink()}），请联系管理员（DINGTALK_PERSONAL_ORG_POLICY_DENIED）`;
    }
    case 'DINGTALK_PERSONAL_OUTPUT_TOO_LARGE': {
      return '返回内容过大（DINGTALK_PERSONAL_OUTPUT_TOO_LARGE）。请缩小时间范围或减少条数后重试。';
    }
    case 'DINGTALK_PERSONAL_PAT_REQUIRED': {
      const uri = httpUri(details?.uri);
      return uri
        ? `该操作需要你在钉钉自己的权限页面上确认。这是钉钉自己的权限页面：${markdownLink('打开权限页面', uri)}（DINGTALK_PERSONAL_PAT_REQUIRED）`
        : '该操作需要你在钉钉自己的权限页面上确认（DINGTALK_PERSONAL_PAT_REQUIRED）。请稍后重试或联系管理员。';
    }
    case 'DINGTALK_PERSONAL_RATE_LIMITED': {
      return '钉钉个人数据接口限流（DINGTALK_PERSONAL_RATE_LIMITED），请稍后重试，不要并行密集调用。';
    }
    case 'DINGTALK_PERSONAL_TIMEOUT': {
      return '钉钉个人数据服务超时（DINGTALK_PERSONAL_TIMEOUT），请稍后重试。';
    }
    case 'DINGTALK_PERSONAL_UPSTREAM': {
      const detail = upstreamDetail(details);
      return detail
        ? `钉钉接口返回错误（DINGTALK_PERSONAL_UPSTREAM）：${detail}`
        : '钉钉接口返回错误（DINGTALK_PERSONAL_UPSTREAM），请稍后重试。';
    }
    default: {
      return undefined;
    }
  }
};

const mapFailure = (
  error: unknown,
  apiName?: DingtalkPersonalApiName,
  ctx?: DingtalkPersonalToolContext,
): BuiltinServerRuntimeOutput => {
  const personal = readPersonalError(error);
  if (personal && isAuthCode(personal.code)) return webAuthResult(personal.code, ctx);
  const content = personal ? contentFor(personal.code, personal.details, apiName, ctx) : undefined;
  if (!personal || !content) {
    logFailure('tool failed', error);
    return failure(INTERNAL_CONTENT, 'DINGTALK_PERSONAL_INTERNAL');
  }
  return failure(content, personal.code);
};

const collectArrays = (value: unknown, out: unknown[][]): void => {
  if (Array.isArray(value)) {
    if (value.length > 1) out.push(value);
    for (const item of value) collectArrays(item, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const child of Object.values(value as Record<string, unknown>)) collectArrays(child, out);
};

const halveLargestArray = (root: unknown): boolean => {
  const arrays: unknown[][] = [];
  collectArrays(root, arrays);
  arrays.sort((left, right) => right.length - left.length);
  const target = arrays[0];
  if (!target) return false;
  target.splice(Math.ceil(target.length / 2));
  return true;
};

const shrinkLongestString = (root: unknown): boolean => {
  let best: { key: string; length: number; parent: Record<string, unknown> } | undefined;
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (typeof child === 'string' && child.length > 80 && (!best || child.length > best.length)) {
        best = { key, length: child.length, parent: value as Record<string, unknown> };
      } else {
        walk(child);
      }
    }
  };
  walk(root);
  if (!best) return false;
  best.parent[best.key] = (best.parent[best.key] as string).slice(
    0,
    Math.max(40, Math.floor(best.length / 2)),
  );
  return true;
};

/** JSON for the model. Arrays (then long strings) are trimmed once past 30 000 chars. */
export const buildModelContent = (state: unknown): string => {
  const original = JSON.stringify(state);
  if (original.length <= CONTENT_LIMIT) return original;
  const payload = JSON.parse(original) as Record<string, unknown>;
  let json = original;
  for (let attempt = 0; attempt < 48 && json.length > CONTENT_LIMIT; attempt += 1) {
    if (!halveLargestArray(payload) && !shrinkLongestString(payload)) break;
    payload.truncated = true;
    if (payload.kind === 'messages' && Array.isArray(payload.messages)) {
      payload.count = payload.messages.length;
    }
    json = JSON.stringify(payload);
  }
  if (json.length <= CONTENT_LIMIT) return json;
  return JSON.stringify({
    kind: typeof payload.kind === 'string' ? payload.kind : undefined,
    note: '结果过大，已截断。请缩小查询范围。',
    truncated: true,
  });
};

const formatSize = (sizeBytes: number): string => {
  const kb = sizeBytes / 1024;
  if (!Number.isFinite(kb) || kb <= 0) return '0 KB';
  if (kb < 10) return `${kb.toFixed(1)} KB`;
  return `${Math.round(kb)} KB`;
};

const buildFileResult = (ingested: IngestedDingtalkFile): ToolSuccess => {
  const header = `已下载群文件「${ingested.name}」（${formatSize(ingested.sizeBytes)}）`;
  let content: string;
  let preview: string | undefined;
  if (ingested.parseFailed) {
    content = `${header}。文件已保存，但无法解析为文本。`;
  } else if (!ingested.parseable) {
    content = `${header}。该类型文件无法作为文本读取，已保存。`;
  } else if (!ingested.text) {
    content = `${header}。文件已保存，但没有解析出文本内容。`;
  } else {
    const clipped = ingested.text.length > FILE_TEXT_LIMIT;
    const body = clipped ? ingested.text.slice(0, FILE_TEXT_LIMIT) : ingested.text;
    content = `${header}，以下是文件内容：\n${body}`;
    if (clipped) content += '\n（文件内容已截断，仅保留前 200000 字）';
    preview = ingested.text.slice(0, FILE_PREVIEW_LIMIT);
  }
  const state: FileState = {
    fileId: ingested.fileId,
    kind: 'file',
    name: ingested.name,
    ...(preview ? { preview } : {}),
    sizeBytes: ingested.sizeBytes,
    ...(ingested.url ? { url: ingested.url } : {}),
  };
  return { content, state };
};

const formatMs = (ms: number | null | undefined): string => {
  if (ms == null || !Number.isFinite(ms)) return '未设置';
  return new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).format(new Date(ms));
};

const priorityLabel = (priority: number | null | undefined): string => {
  if (priority == null) return '未设置';
  return PRIORITY_LABEL[priority] ?? String(priority);
};

/** Settings deep link. A missing or blank APP_URL stays a relative path. */
export const dingtalkPersonalWebAuthorizeUrl = (appUrl?: string | null): string =>
  buildAppUrl(appUrl, APP_LINK_PATHS.dingtalkPersonalAuthorize);

const authorizeUrlFor = (ctx?: DingtalkPersonalToolContext): string =>
  linksOf(ctx)(APP_LINK_PATHS.dingtalkPersonalAuthorize);

const authState = (
  code: string,
  authUrl: string,
  login?: DingtalkPersonalLoginView,
): AuthRequiredState => ({
  authUrl,
  code,
  kind: 'authorizationRequired',
  ...(login ? { login } : {}),
  settingsPath: APP_LINK_PATHS.connectors,
});

const authResult = (
  content: string,
  code: string,
  authUrl: string,
  login?: DingtalkPersonalLoginView,
): BuiltinServerRuntimeOutput => ({
  content,
  state: authState(code, authUrl, login),
  success: false,
});

const webAuthContent = (authUrl: string): string =>
  [
    '你还没有授权 AI 助手读取你的钉钉个人数据。请点击下方卡片的「授权」按钮，或打开：',
    markdownLink('点此前往授权', authUrl),
    '授权后再问我一次即可。',
  ].join('\n');

const webAuthResult = (
  code: string,
  ctx?: DingtalkPersonalToolContext,
): BuiltinServerRuntimeOutput => {
  const authUrl = authorizeUrlFor(ctx);
  return authResult(webAuthContent(authUrl), code, authUrl);
};

/**
 * Link the device-login URL only when it is https on a DingTalk host.
 * Otherwise the settings authorize page (already resolved for this surface).
 */
const safeVerificationTarget = (
  login: DingtalkPersonalLoginView,
  ctx?: DingtalkPersonalToolContext,
): { login: DingtalkPersonalLoginView; url: string } => {
  const raw = login.verificationUrl?.trim() ?? '';
  if (isDingtalkVerificationUrl(raw)) return { login, url: raw };
  const url = authorizeUrlFor(ctx);
  return { login: { ...login, verificationUrl: url }, url };
};

const dingtalkAuthContent = (login: DingtalkPersonalLoginView, via?: 'oto' | 'session'): string => {
  const lines = [
    '你还没有授权 AI 助手读取你的钉钉个人数据。',
    markdownLink('点此授权钉钉个人数据', login.verificationUrl),
    `验证码 ${login.userCode}，有效期约 15 分钟，至 ${login.expiresAt}。`,
  ];
  if (via === 'session') lines.push('同时在当前会话发了一张授权卡片');
  if (via === 'oto') lines.push('同时在机器人单聊里发了一张授权卡片');
  lines.push('授权后再问我一次即可。');
  return lines.join('\n');
};

const isAuthCode = (code: string): boolean =>
  code === 'DINGTALK_PERSONAL_EXPIRED' || code === 'DINGTALK_PERSONAL_UNAUTHORIZED';

const handleAuth = async (
  service: DingtalkPersonalService,
  db: LobeChatDatabase,
  userId: string,
  ctx: DingtalkPersonalToolContext,
  code: string,
): Promise<BuiltinServerRuntimeOutput> => {
  if (ctx.botPlatform !== 'dingtalk') return webAuthResult(code, ctx);

  let login: DingtalkPersonalLoginView;
  try {
    login = (await service.startLogin({ origin: 'dingtalk' })) as DingtalkPersonalLoginView;
  } catch (error) {
    logFailure('startLogin failed', error);
    const nested = readPersonalError(error);
    if (nested && isAuthCode(nested.code)) return webAuthResult(code, ctx);
    return mapFailure(error, undefined, ctx);
  }

  if (!login?.verificationUrl?.trim()) {
    log('startLogin returned no verification url');
    return webAuthResult(code, ctx);
  }

  const linked = safeVerificationTarget(login, ctx);
  let via: 'oto' | 'session' | undefined;
  try {
    const staffId = await service.getStaffId();
    const threadId = ctx.botThreadId?.trim();
    const card = await sendDingtalkPersonalAuthCard({
      db,
      login: linked.login,
      staffId,
      userId,
      ...(threadId ? { threadId } : {}),
    });
    if (card?.sent && card.via) via = card.via;
  } catch (error) {
    logFailure('auth card failed', error);
  }

  return authResult(dingtalkAuthContent(linked.login, via), code, linked.url, linked.login);
};

const writeState = (
  action: WriteState['action'],
  summary: string,
  ids: { reportId?: string; taskId?: string },
): WriteState => ({
  action,
  kind: 'write',
  ...(ids.reportId ? { reportId: ids.reportId } : {}),
  summary,
  ...(ids.taskId ? { taskId: ids.taskId } : {}),
});

const execute = async (
  service: DingtalkPersonalService,
  db: LobeChatDatabase,
  userId: string,
  apiName: DingtalkPersonalApiName,
  args: unknown,
  ctx: DingtalkPersonalToolContext,
): Promise<ToolSuccess> => {
  switch (apiName) {
    case 'completeTodo': {
      const parsed = parseArgs(taskSchema, args);
      const raw = await service.exec('todo.complete', { taskId: parsed.taskId });
      const subject = projectWriteSubject(raw);
      return {
        audit: {
          action: 'todo.complete',
          afterDiff: auditDiff({ subject, taskId: parsed.taskId }),
          targetId: parsed.taskId,
        },
        state: writeState('completeTodo', subject ? `已完成待办「${subject}」` : '已完成待办', {
          taskId: parsed.taskId,
        }),
      };
    }
    case 'downloadMessageFile': {
      const parsed = parseArgs(downloadSchema, args);
      const file = await service.downloadFile({
        resourceId: parsed.resourceId,
        resourceType: parsed.resourceType,
        ...(parsed.conversationId ? { conversationId: parsed.conversationId } : {}),
        ...(parsed.messageId ? { messageId: parsed.messageId } : {}),
      });
      if (!file || !Buffer.isBuffer(file.buffer))
        throw new Error('downloadFile returned no buffer');
      const ingested = await ingestDingtalkPersonalFile({
        buffer: file.buffer,
        db,
        name:
          typeof file.name === 'string' && file.name.trim() ? file.name : parsed.fileName || 'file',
        sizeBytes: typeof file.sizeBytes === 'number' ? file.sizeBytes : file.buffer.length,
        userId,
        workspaceId: ctx.workspaceId || undefined,
      });
      return buildFileResult(ingested);
    }
    case 'getReport': {
      const parsed = parseArgs(reportIdSchema, args);
      const raw = await service.exec('report.get', { reportId: parsed.reportId });
      return { state: projectReportDetail(raw) };
    }
    case 'getReportTemplate': {
      const parsed = parseArgs(templateNameSchema, args);
      const raw = await service.exec('report.template', { name: parsed.name });
      return { state: projectTemplate(raw) };
    }
    case 'getTodo': {
      const parsed = parseArgs(taskSchema, args);
      const raw = await service.exec('todo.get', { taskId: parsed.taskId });
      return { state: projectTodoDetail(raw) };
    }
    case 'listGroupMessages': {
      const parsed = parseArgs(listMessagesSchema, args);
      const raw = await service.exec(
        'chat.messages',
        compactArgs({
          conversationId: parsed.conversationId,
          end: parsed.endTime,
          maxItems: parsed.maxMessages,
          start: parsed.startTime,
        }),
      );
      return {
        state: projectMessages(raw, {
          conversationId: parsed.conversationId,
          endTime: parsed.endTime,
          startTime: parsed.startTime,
        }),
      };
    }
    case 'listMyGroups': {
      const parsed = parseArgs(listGroupsSchema, args);
      const raw = await service.exec('chat.myGroups', compactArgs({ cursor: parsed.cursor }));
      return { state: projectGroups(raw) };
    }
    case 'listMyTodos': {
      const parsed = parseArgs(listTodosSchema, args);
      const status = parsed.status ?? 'open';
      const page = parsed.page ?? 1;
      const raw = await service.exec('todo.list', {
        page,
        roleTypes: ['creator', 'executor', 'participant'],
        status,
      });
      return { state: projectTodoList(raw, { page, status }) };
    }
    case 'listReportTemplates': {
      parseArgs(z.object({}).strict(), args);
      const raw = await service.exec('report.templates', {});
      return { state: projectTemplates(raw) };
    }
    case 'listReports': {
      const parsed = parseArgs(listReportsSchema, args);
      const op = parsed.box === 'inbox' ? 'report.inbox' : 'report.outbox';
      const raw = await service.exec(
        op,
        compactArgs({
          cursor: parsed.cursor,
          end: parsed.endTime,
          start: parsed.startTime,
        }),
      );
      return { state: projectReports(raw, parsed.box, parsed.cursor ?? 0) };
    }
    case 'searchGroups': {
      const parsed = parseArgs(searchGroupsSchema, args);
      const raw = await service.exec('chat.searchGroups', { query: parsed.query });
      return { state: projectGroups(raw) };
    }
    case 'searchMessages': {
      const parsed = parseArgs(searchMessagesSchema, args);
      const raw = await service.exec(
        'chat.searchMessages',
        compactArgs({
          conversationId: parsed.conversationId,
          end: parsed.endTime,
          query: parsed.query,
          start: parsed.startTime,
        }),
      );
      return {
        state: projectMessages(raw, {
          conversationId: parsed.conversationId,
          endTime: parsed.endTime,
          startTime: parsed.startTime,
        }),
      };
    }
    case 'submitReport': {
      const parsed = parseArgs(submitSchema, args);
      const template = projectTemplate(
        await service.exec('report.template', { name: parsed.templateName }),
      );
      const templateName = template.template.name || parsed.templateName;
      if (!template.template.id) invalidArgs(`未找到日志模板「${parsed.templateName}」`);
      const fields = new Map(template.template.fields.map((field) => [field.name, field]));
      const contents = parsed.contents.map((item) => {
        const field = fields.get(item.key);
        if (!field) invalidArgs(`日志字段「${item.key}」不在模板「${templateName}」中`);
        return {
          content: item.content,
          contentType: 'markdown',
          key: item.key,
          sort: String(field.sort),
          type: String(field.type),
        };
      });
      const raw = await service.exec('report.submit', {
        contents,
        templateId: template.template.id,
        toUserIds: parsed.toUserIds,
      });
      const reportId = projectSubmittedReportId(raw);
      return {
        audit: {
          action: 'report.submit',
          afterDiff: auditDiff({ templateName }),
          targetId: reportId ?? template.template.id,
        },
        state: writeState('submitReport', `已提交日志「${templateName}」`, { reportId }),
      };
    }
    case 'updateTodo': {
      const parsed = parseArgs(updateTodoSchema, args);
      const raw = await service.exec(
        'todo.update',
        compactArgs({
          due: parsed.dueTime,
          priority: parsed.priority,
          taskId: parsed.taskId,
          title: parsed.title,
        }),
      );
      const subject = projectWriteSubject(raw);
      const shown = parsed.title ?? subject;
      return {
        audit: {
          action: 'todo.update',
          afterDiff: auditDiff({
            dueTime: parsed.dueTime,
            priority: parsed.priority,
            subject,
            title: parsed.title,
          }),
          targetId: parsed.taskId,
        },
        state: writeState('updateTodo', shown ? `已更新待办「${shown}」` : '已更新待办', {
          taskId: parsed.taskId,
        }),
      };
    }
    default: {
      return invalidArgs('未知的操作');
    }
  }
};

const lookupStaffNames = async (
  db: LobeChatDatabase,
  staffIds: string[],
): Promise<Map<string, string>> => {
  const names = new Map<string, string>();
  if (staffIds.length === 0 || typeof (db as { select?: unknown }).select !== 'function')
    return names;
  try {
    const rows = await db
      .select({ name: dingtalkDirectoryUsers.name, staffId: dingtalkDirectoryUsers.staffId })
      .from(dingtalkDirectoryUsers)
      .where(inArray(dingtalkDirectoryUsers.staffId, staffIds));
    for (const row of rows) {
      if (row.staffId && row.name) names.set(row.staffId, row.name);
    }
  } catch (error) {
    logFailure('directory lookup failed', error);
  }
  return names;
};

const previewUpdate = async (
  service: DingtalkPersonalService,
  args: unknown,
): Promise<DingtalkPersonalPreview> => {
  const parsed = parseArgs(updateTodoSchema, args);
  const detail = projectTodoDetail(await service.exec('todo.get', { taskId: parsed.taskId }));
  const subject = detail.todo.subject || parsed.taskId;
  const lines = [`待办：${subject}`];
  if (parsed.title) {
    lines.push(
      !detail.todo.subject || parsed.title === detail.todo.subject
        ? `标题：${parsed.title}`
        : `标题：${detail.todo.subject} → ${parsed.title}`,
    );
  }
  if (parsed.dueTime) {
    lines.push(
      `截止时间：${formatMs(detail.todo.dueTime)} → ${formatMs(Date.parse(parsed.dueTime))}`,
    );
  }
  if (parsed.priority !== undefined) {
    lines.push(
      `优先级：${priorityLabel(detail.todo.priority)} → ${priorityLabel(parsed.priority)}`,
    );
  }
  return { danger: false, lines, title: '修改待办', warnings: [] };
};

const previewComplete = async (
  service: DingtalkPersonalService,
  args: unknown,
): Promise<DingtalkPersonalPreview> => {
  const parsed = parseArgs(taskSchema, args);
  const detail = projectTodoDetail(await service.exec('todo.get', { taskId: parsed.taskId }));
  return {
    danger: false,
    lines: [`待办：${detail.todo.subject || parsed.taskId}`],
    title: '完成待办',
    warnings: ['完成后该待办会标记为已完成。'],
  };
};

const previewSubmit = async (
  service: DingtalkPersonalService,
  db: LobeChatDatabase,
  args: unknown,
): Promise<DingtalkPersonalPreview> => {
  const parsed = parseArgs(submitSchema, args);
  const template = projectTemplate(
    await service.exec('report.template', { name: parsed.templateName }),
  );
  const templateName = template.template.name || parsed.templateName;
  if (!template.template.id) invalidArgs(`未找到日志模板「${parsed.templateName}」`);
  const fieldNames = new Set(template.template.fields.map((field) => field.name));
  for (const item of parsed.contents) {
    if (!fieldNames.has(item.key))
      invalidArgs(`日志字段「${item.key}」不在模板「${templateName}」中`);
  }
  const canQuery = typeof (db as { select?: unknown }).select === 'function';
  const names = await lookupStaffNames(db, parsed.toUserIds);
  const missing = parsed.toUserIds.filter((id) => !names.get(id));
  const recipients = parsed.toUserIds.map((id) => {
    const name = names.get(id);
    return name ? `${name}（${id}）` : id;
  });
  const lines = [`模板：${templateName}`, `收件人：${recipients.join('、')}`];
  for (const item of parsed.contents) lines.push(`${item.key}：${item.content}`);
  const warnings: string[] = [];
  const filled = new Set(parsed.contents.map((item) => item.key));
  const missingFields = template.template.fields
    .map((field) => field.name)
    .filter((name) => !filled.has(name));
  if (missingFields.length > 0) warnings.push(`未填写的字段：${missingFields.join('、')}`);
  if (!canQuery) warnings.push('通讯录暂时不可用，收件人仅显示工号。');
  else if (missing.length > 0) {
    warnings.push(`以下收件人未在通讯录中找到，将按工号提交：${missing.join('、')}`);
  }
  return { danger: false, lines, title: `提交「${templateName}」`, warnings };
};

export const runDingtalkPersonalTool = async (
  db: LobeChatDatabase,
  userId: string,
  apiName: DingtalkPersonalApiName,
  args: Record<string, unknown>,
  ctx: DingtalkPersonalToolContext = {},
): Promise<BuiltinServerRuntimeOutput> => {
  let service: DingtalkPersonalService;
  try {
    service = new DingtalkPersonalService(db, userId);
  } catch (error) {
    return mapFailure(error, undefined, ctx);
  }

  try {
    const outcome = await execute(service, db, userId, apiName, args ?? {}, ctx);
    if (outcome.audit) {
      try {
        await appendDingtalkPersonalAudit(db, userId, outcome.audit.action, {
          afterDiff: outcome.audit.afterDiff ?? null,
          result: 'success',
          targetId: outcome.audit.targetId,
        });
      } catch (error) {
        logFailure('audit write failed', error);
      }
    }
    return {
      content: outcome.content ?? buildModelContent(outcome.state),
      state: outcome.state,
      success: true,
    };
  } catch (error) {
    const personal = readPersonalError(error);
    if (personal && isAuthCode(personal.code)) {
      return handleAuth(service, db, userId, ctx, personal.code);
    }
    return mapFailure(error, apiName, ctx);
  }
};

export const previewDingtalkPersonalWrite = async (
  db: LobeChatDatabase,
  userId: string,
  apiName: DingtalkPersonalApiName,
  args: Record<string, unknown>,
): Promise<DingtalkPersonalPreview> => {
  if (apiName !== 'completeTodo' && apiName !== 'submitReport' && apiName !== 'updateTodo') {
    invalidArgs('该操作不需要确认');
  }
  const service = new DingtalkPersonalService(db, userId);
  if (apiName === 'updateTodo') return previewUpdate(service, args ?? {});
  if (apiName === 'completeTodo') return previewComplete(service, args ?? {});
  return previewSubmit(service, db, args ?? {});
};
