import {
  type AitableField,
  type DingtalkDocsApiName,
  type DingtalkDocsPreview,
  DingtalkDocsWriteApiNames,
} from '@lobechat/builtin-tool-dingtalk-docs';

import type { LobeChatDatabase } from '@/database/type';
import { DingtalkPersonalService } from '@/server/enterprise/services/dingtalkPersonal/service';

import {
  appendDocSchema,
  appendSheetRowsSchema,
  createAitableRecordsSchema,
  createDocSchema,
  invalidDocsArgs,
  parseDocsArgs,
  updateAitableRecordsSchema,
} from './args';
import { aitableCellText, projectAitableSchema, readDocTitle, unwrapDws } from './project';

const WRITE_APIS = new Set<string>(DingtalkDocsWriteApiNames);

const markdownPreview = (markdown: string, shown = 10): string[] => {
  const all = markdown.split(/\r?\n/);
  const head = all.slice(0, shown);
  const lines = head.some((line) => line.length > 0) ? head : ['（无正文）'];
  if (all.length > shown) lines.push(`另有 ${all.length - shown} 行未显示`);
  return lines;
};

const hiddenCount = (lines: string[], total: number, unit: '行' | '条'): string[] => {
  if (total <= lines.length) return lines;
  return [...lines, `另有 ${total - lines.length} ${unit}未显示`];
};

const fieldLine = (
  fields: AitableField[],
  cells: Record<string, string | number | boolean>,
): string =>
  Object.entries(cells)
    .map(([fieldId, value]) => {
      const name = fields.find((field) => field.fieldId === fieldId)?.name;
      if (!name) invalidDocsArgs(`字段「${fieldId}」不在该数据表中`);
      return `${name}：${aitableCellText(value)}`;
    })
    .join('；');

const requireTable = async (service: DingtalkPersonalService, baseId: string, tableId: string) => {
  const raw = await service.exec('aitable.schema', { baseId, tableId });
  const schema = projectAitableSchema(raw, { baseId, tableId });
  if (!schema.tableName) invalidDocsArgs('无法确认数据表名称，不能发起确认');
  return schema;
};

const previewAppendDoc = async (
  service: DingtalkPersonalService,
  args: unknown,
): Promise<DingtalkDocsPreview> => {
  const parsed = parseDocsArgs(appendDocSchema, args);
  const raw = await service.exec('doc.info', { nodeId: parsed.nodeId });
  const title = readDocTitle(raw);
  if (!title) invalidDocsArgs('无法确认文档标题，不能发起确认');
  return {
    danger: false,
    lines: markdownPreview(parsed.markdown),
    title: `追加内容到文档「${title}」`,
    warnings: [],
  };
};

const previewCreateDoc = (args: unknown): DingtalkDocsPreview => {
  const parsed = parseDocsArgs(createDocSchema, args);
  const lines = markdownPreview(parsed.markdown);
  if (parsed.folderId) lines.unshift(`文件夹：${parsed.folderId}`);
  return { danger: false, lines, title: `新建文档「${parsed.title}」`, warnings: [] };
};

const previewAppendSheet = async (
  service: DingtalkPersonalService,
  args: unknown,
): Promise<DingtalkDocsPreview> => {
  const parsed = parseDocsArgs(appendSheetRowsSchema, args);
  const raw = await service.exec('sheet.info', {
    nodeId: parsed.nodeId,
    sheetId: parsed.sheetId,
  });
  const name = unwrapDws(raw).name;
  const title = typeof name === 'string' ? name.trim() : '';
  if (!title) invalidDocsArgs('无法确认工作表名称，不能发起确认');
  const shown = parsed.rows.slice(0, 5).map((row, index) => `${index + 1}. ${row.join(' | ')}`);
  const lines = hiddenCount(shown, parsed.rows.length, '行');
  return {
    danger: false,
    lines,
    title: `向「${title}」追加 ${parsed.rows.length} 行`,
    warnings: [],
  };
};

const previewCreateRecords = async (
  service: DingtalkPersonalService,
  args: unknown,
): Promise<DingtalkDocsPreview> => {
  const parsed = parseDocsArgs(createAitableRecordsSchema, args);
  const schema = await requireTable(service, parsed.baseId, parsed.tableId);
  const rendered = parsed.records.map(
    (record, index) => `${index + 1}. ${fieldLine(schema.fields, record.cells)}`,
  );
  const lines = hiddenCount(rendered.slice(0, 5), rendered.length, '条');
  return {
    danger: false,
    lines,
    title: `向「${schema.tableName}」新增 ${parsed.records.length} 条记录`,
    warnings: [],
  };
};

const previewUpdateRecords = async (
  service: DingtalkPersonalService,
  args: unknown,
): Promise<DingtalkDocsPreview> => {
  const parsed = parseDocsArgs(updateAitableRecordsSchema, args);
  const schema = await requireTable(service, parsed.baseId, parsed.tableId);
  const rendered = parsed.records.map(
    (record) => `${record.recordId} ${fieldLine(schema.fields, record.cells)}`,
  );
  const lines = hiddenCount(rendered.slice(0, 5), rendered.length, '条');
  return {
    danger: false,
    lines,
    title: `修改「${schema.tableName}」中的 ${parsed.records.length} 条记录`,
    warnings: [],
  };
};

export const previewDingtalkDocsWrite = async (
  db: LobeChatDatabase,
  userId: string,
  apiName: DingtalkDocsApiName,
  args: Record<string, unknown>,
): Promise<DingtalkDocsPreview> => {
  if (!WRITE_APIS.has(apiName)) invalidDocsArgs('该操作不需要确认');
  const service = new DingtalkPersonalService(db, userId);
  if (apiName === 'appendDoc') return previewAppendDoc(service, args);
  if (apiName === 'createDoc') return previewCreateDoc(args);
  if (apiName === 'appendSheetRows') return previewAppendSheet(service, args);
  if (apiName === 'createAitableRecords') return previewCreateRecords(service, args);
  return previewUpdateRecords(service, args);
};
