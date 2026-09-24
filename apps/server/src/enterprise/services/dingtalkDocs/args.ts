import { z } from 'zod';

import { DingtalkPersonalError } from '../dingtalkPersonal/errors';
import { assertSheetRange } from './range';

const ID_PATTERN = /^[\w+/=.:-]{1,256}$/;
// eslint-disable-next-line no-control-regex -- reject control characters in user input
const CONTROL_STRICT = /[\u0000-\u001F\u007F]/;
// eslint-disable-next-line no-control-regex -- markdown and cells may contain tab and newline
const CONTROL_LOOSE = /[\u0000-\u0008\v\f\u000E-\u001F\u007F]/;

const idField = (label: string) =>
  z
    .string({ required_error: `缺少${label}`, invalid_type_error: `${label}必须是字符串` })
    .regex(ID_PATTERN, `${label}不合法`);

const lineText = (label: string, min: number, max: number) =>
  z
    .string({ required_error: `缺少${label}`, invalid_type_error: `${label}必须是字符串` })
    .trim()
    .min(min, `${label}过短`)
    .max(max, `${label}过长`)
    .refine((value) => !CONTROL_STRICT.test(value), `${label}包含无法使用的字符`);

/**
 * Same rules as the sidecar `assertMarkdown`: tab / newline stay, other controls
 * do not, `-` is stdin, and a leading `@` is a file path.
 */
const markdownText = (min: number) =>
  z
    .string({ required_error: '缺少正文', invalid_type_error: '正文必须是字符串' })
    .min(min, '正文过短')
    .max(20_000, '正文最多 20000 字')
    .refine((value) => !CONTROL_LOOSE.test(value), '正文包含无法使用的字符')
    .refine((value) => value !== '-', '正文不能是「-」')
    .refine((value) => !value.startsWith('@'), '正文不能以 @ 开头');

const optionalId = (label: string) => idField(label).optional();

const optionalCursor = idField('游标').optional();

/**
 * Sidecar HTTP body cap is 64 KB (`MAX_BODY_BYTES`). Stay under ~56 KB so the
 * op, profile, and actor envelope still fits.
 */
export const WRITE_PAYLOAD_MAX_BYTES = 56 * 1024;

const rejectOversizedPayload = (value: unknown, ctx: z.RefinementCtx): void => {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (bytes <= WRITE_PAYLOAD_MAX_BYTES) return;
  const kb = Math.max(1, Math.ceil(bytes / 1024));
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: `内容过大（约 ${kb} KB），请分成多次写入，每次不超过约 50 KB`,
  });
};

const sheetCellSchema = z.union([
  z
    .string()
    .max(500, '单元格最多 500 字')
    .refine((value) => !CONTROL_LOOSE.test(value), '单元格包含无法使用的字符')
    .refine((value) => !value.trimStart().startsWith('='), '单元格不能以 = 开头'),
  z.number().finite(),
]);

const aitableValueSchema = z.union([
  z
    .string()
    .max(2000, '单元格最多 2000 字')
    .refine((value) => !CONTROL_LOOSE.test(value), '单元格包含无法使用的字符'),
  z.number().finite(),
  z.boolean(),
]);

const cellsSchema = z
  .record(idField('字段'), aitableValueSchema)
  .refine((cells) => Object.keys(cells).length >= 1, '一条记录至少 1 个字段')
  .refine((cells) => Object.keys(cells).length <= 50, '一条记录最多 50 个字段');

export const searchDocsSchema = z
  .object({
    limit: z.number().int().min(1).max(10).optional(),
    query: lineText('关键词', 1, 200),
  })
  .strict();

export const readDocSchema = z.object({ nodeId: idField('文档') }).strict();

export const listWikiSpacesSchema = z.object({ scope: z.enum(['org', 'my']).optional() }).strict();

export const listWikiNodesSchema = z
  .object({
    cursor: optionalCursor,
    folderId: optionalId('目录'),
    workspaceId: idField('知识库'),
  })
  .strict();

export const searchDriveSchema = z
  .object({
    limit: z.number().int().min(1).max(10).optional(),
    query: lineText('关键词', 1, 200),
  })
  .strict();

export const listDriveSchema = z
  .object({ cursor: optionalCursor, folderId: optionalId('文件夹') })
  .strict();

export const downloadDriveSchema = z.object({ nodeId: idField('文件') }).strict();

export const listSheetsSchema = z.object({ nodeId: idField('表格') }).strict();

export const readSheetSchema = z
  .object({
    nodeId: idField('表格'),
    range: z.string().optional(),
    sheetId: optionalId('工作表'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.range === undefined) return;
    try {
      assertSheetRange(value.range);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : 'range 不合法',
        path: ['range'],
      });
    }
  });

export const searchAitableBasesSchema = z
  .object({ query: lineText('关键词', 2, 100).optional() })
  .strict();

export const listAitableTablesSchema = z.object({ baseId: idField('AI 表格') }).strict();

export const getAitableSchemaSchema = z
  .object({ baseId: idField('AI 表格'), tableId: idField('数据表') })
  .strict();

export const queryAitableRecordsSchema = z
  .object({
    baseId: idField('AI 表格'),
    cursor: optionalCursor,
    limit: z.number().int().min(1).max(50).optional(),
    query: lineText('关键词', 1, 200).optional(),
    tableId: idField('数据表'),
  })
  .strict();

export const appendDocSchema = z
  .object({ markdown: markdownText(1), nodeId: idField('文档') })
  .strict()
  .superRefine(rejectOversizedPayload);

export const createDocSchema = z
  .object({
    folderId: optionalId('文件夹'),
    markdown: markdownText(0),
    title: lineText('标题', 1, 100),
  })
  .strict()
  .superRefine(rejectOversizedPayload);

export const appendSheetRowsSchema = z
  .object({
    nodeId: idField('表格'),
    rows: z
      .array(z.array(sheetCellSchema).max(30, '一行最多 30 列'))
      .min(1, '至少追加 1 行')
      .max(50, '一次最多追加 50 行'),
    sheetId: idField('工作表'),
  })
  .strict()
  .superRefine(rejectOversizedPayload);

const createRecordSchema = z.object({ cells: cellsSchema }).strict();

export const createAitableRecordsSchema = z
  .object({
    baseId: idField('AI 表格'),
    records: z
      .array(createRecordSchema)
      .min(1, '至少新增 1 条记录')
      .max(20, '一次最多新增 20 条记录'),
    tableId: idField('数据表'),
  })
  .strict()
  .superRefine(rejectOversizedPayload);

const updateRecordSchema = z.object({ cells: cellsSchema, recordId: idField('记录') }).strict();

export const updateAitableRecordsSchema = z
  .object({
    baseId: idField('AI 表格'),
    records: z
      .array(updateRecordSchema)
      .min(1, '至少修改 1 条记录')
      .max(20, '一次最多修改 20 条记录'),
    tableId: idField('数据表'),
  })
  .strict()
  .superRefine((value, ctx) => {
    rejectOversizedPayload(value, ctx);
    const seen = new Set<string>();
    for (const record of value.records) {
      if (seen.has(record.recordId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `记录「${record.recordId}」重复`,
        });
        return;
      }
      seen.add(record.recordId);
    }
  });

export function invalidDocsArgs(detail: string): never {
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

export const parseDocsArgs = <T>(schema: z.ZodType<T>, args: unknown): T => {
  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) invalidDocsArgs(formatZodIssue(parsed.error));
  return parsed.data;
};

export const normalizedRange = (range: string): string => {
  try {
    return assertSheetRange(range);
  } catch (error) {
    invalidDocsArgs(error instanceof Error ? error.message : 'range 不合法');
  }
};
