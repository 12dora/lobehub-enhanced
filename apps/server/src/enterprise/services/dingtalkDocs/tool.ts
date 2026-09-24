import {
  type DingtalkDocsApiName,
  DingtalkDocsWriteApiNames,
  type WriteState,
} from '@lobechat/builtin-tool-dingtalk-docs';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';
import { adminEntrySuffix } from '@lobechat/utils/appLink';
import debug from 'debug';

import type { LobeChatDatabase } from '@/database/type';
import {
  appendDingtalkPersonalAudit,
  type DingtalkPersonalAuditAction,
} from '@/server/enterprise/services/dingtalkPersonal/audit';
import { DingtalkPersonalError } from '@/server/enterprise/services/dingtalkPersonal/errors';
import { ingestDingtalkPersonalFile } from '@/server/enterprise/services/dingtalkPersonal/fileIngest';
import { DingtalkPersonalService } from '@/server/enterprise/services/dingtalkPersonal/service';
import {
  buildModelContent,
  type DingtalkPersonalToolContext,
  settleDingtalkPersonalToolError,
} from '@/server/enterprise/services/dingtalkPersonal/tool';
import { serverAppLinkResolver } from '@/server/utils/appLinks';

import {
  appendDocSchema,
  appendSheetRowsSchema,
  createAitableRecordsSchema,
  createDocSchema,
  downloadDriveSchema,
  getAitableSchemaSchema,
  listAitableTablesSchema,
  listDriveSchema,
  listSheetsSchema,
  listWikiNodesSchema,
  listWikiSpacesSchema,
  normalizedRange,
  parseDocsArgs,
  queryAitableRecordsSchema,
  readDocSchema,
  readSheetSchema,
  searchAitableBasesSchema,
  searchDocsSchema,
  searchDriveSchema,
  updateAitableRecordsSchema,
} from './args';
import { rewriteDriveDownloadError } from './driveError';
import { previewDingtalkDocsWrite } from './preview';
import {
  DOC_PREVIEW_LIMIT,
  DOC_TEXT_LIMIT,
  projectAitableBases,
  projectAitableRecords,
  projectAitableSchema,
  projectAitableTables,
  projectDoc,
  projectDocs,
  projectDriveFiles,
  projectSheetRange,
  projectSheets,
  projectWikiNodes,
  projectWikiSpaces,
  readResultUrl,
  readSheetSummaries,
  readUsedRange,
  renderRecordsContent,
  SHEET_INFO_LIMIT,
} from './project';
import { clipA1Range, sheetClipNote } from './range';
import { DINGTALK_DOCS_API_NAMES } from './types';

const log = debug('lobe-server:dingtalk-docs');

const WRITE_APIS = new Set<string>(DingtalkDocsWriteApiNames);

const WRITE_AUDIT_ACTION: Partial<Record<DingtalkDocsApiName, DingtalkPersonalAuditAction>> = {
  appendDoc: 'doc.append',
  appendSheetRows: 'sheet.append',
  createAitableRecords: 'aitable.records.create',
  createDoc: 'doc.create',
  updateAitableRecords: 'aitable.records.update',
};

const AUDIT_ARG_KEYS = ['baseId', 'folderId', 'nodeId', 'sheetId', 'tableId', 'title'] as const;

const countOf = (state: unknown): number | undefined => {
  if (!state || typeof state !== 'object' || !('count' in state)) return undefined;
  const count = (state as { count?: unknown }).count;
  return typeof count === 'number' ? count : undefined;
};

const auditTarget = (
  apiName: DingtalkDocsApiName,
  args: Record<string, unknown>,
): string | undefined => {
  const text = (key: string): string => {
    const value = args[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  if (apiName === 'createDoc') return text('title') || undefined;
  if (apiName === 'createAitableRecords' || apiName === 'updateAitableRecords') {
    return text('tableId') || text('baseId') || undefined;
  }
  return text('nodeId') || undefined;
};

/** Ids and counts only. Markdown, cell values, and record bodies stay out of the audit row. */
const docsAuditDiff = (
  args: Record<string, unknown>,
  count: number | undefined,
): Record<string, unknown> | null => {
  const diff: Record<string, unknown> = {};
  for (const key of AUDIT_ARG_KEYS) {
    const value = args[key];
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (!text) continue;
    diff[key] = text.length > 200 ? text.slice(0, 200) : text;
  }
  if (count !== undefined) diff.count = count;
  return Object.keys(diff).length > 0 ? diff : null;
};

const recordDocsWriteAudit = async (
  db: LobeChatDatabase,
  userId: string,
  apiName: DingtalkDocsApiName,
  args: Record<string, unknown>,
  state: unknown,
): Promise<void> => {
  const action = WRITE_AUDIT_ACTION[apiName];
  if (!action) return;
  try {
    await appendDingtalkPersonalAudit(db, userId, action, {
      afterDiff: docsAuditDiff(args, countOf(state)),
      result: 'success',
      targetId: auditTarget(apiName, args),
    });
  } catch (error) {
    log('audit write failed %s', error instanceof Error ? error.name : 'UnknownError');
  }
};

/** Admin switch labels (`dingtalkPersonal.features.docs` / `.sheets`). */
const FEATURE_LABEL: Record<string, string> = {
  docs: '文档 / 钉盘 / 知识库',
  sheets: '在线表格 / AI 表格',
  write: '写操作',
};

export { DINGTALK_DOCS_API_NAMES, previewDingtalkDocsWrite };
export type { DingtalkDocsApiName };

interface ToolSuccess {
  content?: string;
  state: unknown;
}

type DownloadOp = (
  op: 'drive.download',
  args: Record<string, unknown>,
) => Promise<{ buffer: Buffer; name: string; sizeBytes: number }>;

const linksOf = (ctx?: DingtalkPersonalToolContext) =>
  ctx?.resolveLink ?? serverAppLinkResolver(ctx?.botPlatform);

const compact = (input: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));

const failure = (content: string, code: string): BuiltinServerRuntimeOutput => ({
  content,
  error: { code, message: content },
  success: false,
});

/**
 * Same 「管理员未开启」 sentence as the personal tool. Kept here so a disabled
 * docs / sheets / write switch does not depend on the personal helper mock.
 */
const featureDisabledResult = (
  error: unknown,
  ctx?: DingtalkPersonalToolContext,
): BuiltinServerRuntimeOutput | undefined => {
  if (!(error instanceof DingtalkPersonalError)) return undefined;
  if (error.code !== 'DINGTALK_PERSONAL_FEATURE_DISABLED') return undefined;
  const feature = typeof error.details?.feature === 'string' ? error.details.feature : '';
  const label = FEATURE_LABEL[feature];
  if (!label) return undefined;
  const content = `管理员未开启「${label}」（DINGTALK_PERSONAL_FEATURE_DISABLED）。请联系管理员在钉钉连接器中开启${adminEntrySuffix(linksOf(ctx))}。`;
  return failure(content, error.code);
};

const outputTooLargeResult = (error: unknown): BuiltinServerRuntimeOutput | undefined => {
  if (!(error instanceof DingtalkPersonalError)) return undefined;
  if (error.code !== 'DINGTALK_PERSONAL_OUTPUT_TOO_LARGE') return undefined;
  const content = '内容过大，无法一次读取（DINGTALK_PERSONAL_OUTPUT_TOO_LARGE）。';
  return failure(content, error.code);
};

const downloadDrive = (service: DingtalkPersonalService, nodeId: string) =>
  (service as DingtalkPersonalService & { downloadOp: DownloadOp }).downloadOp('drive.download', {
    nodeId,
  });

const formatSize = (sizeBytes: number): string => {
  const kb = sizeBytes / 1024;
  if (!Number.isFinite(kb) || kb <= 0) return '0 KB';
  if (kb < 10) return `${kb.toFixed(1)} KB`;
  return `${Math.round(kb)} KB`;
};

const fileResult = (
  ingested: Awaited<ReturnType<typeof ingestDingtalkPersonalFile>>,
): ToolSuccess => {
  const header = `已下载钉盘文件「${ingested.name}」（${formatSize(ingested.sizeBytes)}）`;
  let content: string;
  let preview: string | undefined;
  if (ingested.parseFailed) {
    content = `${header}。文件已保存，但无法解析为文本。`;
  } else if (!ingested.parseable) {
    content = `${header}。该类型文件无法作为文本读取，已保存。`;
  } else if (!ingested.text) {
    content = `${header}。文件已保存，但没有解析出文本内容。`;
  } else {
    const clipped = ingested.text.length > DOC_TEXT_LIMIT;
    const body = clipped ? ingested.text.slice(0, DOC_TEXT_LIMIT) : ingested.text;
    content = `${header}，以下是文件内容：\n${body}`;
    if (clipped) content += '\n（文件内容已截断，仅保留前 100000 字）';
    preview = ingested.text.slice(0, DOC_PREVIEW_LIMIT);
  }
  return {
    content,
    state: {
      fileId: ingested.fileId,
      kind: 'file',
      name: ingested.name,
      ...(preview ? { preview } : {}),
      sizeBytes: ingested.sizeBytes,
      ...(ingested.url ? { url: ingested.url } : {}),
    },
  };
};

const writeResult = (
  action: WriteState['action'],
  summary: string,
  extra: { count?: number; url?: string } = {},
): ToolSuccess => ({
  content: summary,
  state: {
    action,
    kind: 'write',
    summary,
    ...(extra.count !== undefined ? { count: extra.count } : {}),
    ...(extra.url ? { url: extra.url } : {}),
  },
});

const execute = async (
  service: DingtalkPersonalService,
  db: LobeChatDatabase,
  userId: string,
  apiName: DingtalkDocsApiName,
  args: unknown,
  workspaceId?: string,
): Promise<ToolSuccess> => {
  switch (apiName) {
    case 'searchDocs': {
      const parsed = parseDocsArgs(searchDocsSchema, args);
      const raw = await service.exec('doc.search', {
        limit: parsed.limit ?? 5,
        query: parsed.query,
      });
      return { state: projectDocs(raw) };
    }
    case 'readDoc': {
      const parsed = parseDocsArgs(readDocSchema, args);
      const raw = await service.exec('doc.read', { nodeId: parsed.nodeId });
      return projectDoc(raw, parsed.nodeId);
    }
    case 'listWikiSpaces': {
      const parsed = parseDocsArgs(listWikiSpacesSchema, args);
      const raw = await service.exec('wiki.spaces', {
        type: parsed.scope === 'my' ? 'myWikiSpace' : 'orgWikiSpace',
      });
      return { state: projectWikiSpaces(raw) };
    }
    case 'listWikiNodes': {
      const parsed = parseDocsArgs(listWikiNodesSchema, args);
      const raw = await service.exec(
        'wiki.nodes',
        compact({
          cursor: parsed.cursor,
          folderId: parsed.folderId,
          limit: 20,
          workspaceId: parsed.workspaceId,
        }),
      );
      return { state: projectWikiNodes(raw, parsed.workspaceId) };
    }
    case 'searchDrive': {
      const parsed = parseDocsArgs(searchDriveSchema, args);
      const raw = await service.exec('drive.search', {
        limit: parsed.limit ?? 5,
        query: parsed.query,
      });
      return { state: projectDriveFiles(raw) };
    }
    case 'listDrive': {
      const parsed = parseDocsArgs(listDriveSchema, args);
      const raw = await service.exec(
        'drive.list',
        compact({ cursor: parsed.cursor, folderId: parsed.folderId }),
      );
      return { state: projectDriveFiles(raw) };
    }
    case 'downloadDriveFile': {
      const parsed = parseDocsArgs(downloadDriveSchema, args);
      const file = await downloadDrive(service, parsed.nodeId);
      const ingested = await ingestDingtalkPersonalFile({
        buffer: file.buffer,
        db,
        name: file.name,
        sizeBytes: file.sizeBytes,
        userId,
        ...(workspaceId ? { workspaceId } : {}),
      });
      return fileResult(ingested);
    }
    case 'listSheets': {
      const parsed = parseDocsArgs(listSheetsSchema, args);
      const listed = readSheetSummaries(
        await service.exec('sheet.list', { nodeId: parsed.nodeId }),
      );
      const infos = new Map<string, unknown>();
      for (const sheet of listed.slice(0, SHEET_INFO_LIMIT)) {
        infos.set(
          sheet.sheetId,
          await service.exec('sheet.info', { nodeId: parsed.nodeId, sheetId: sheet.sheetId }),
        );
      }
      const state = projectSheets(parsed.nodeId, listed, infos);
      const note =
        listed.length > SHEET_INFO_LIMIT
          ? `共 ${listed.length} 个工作表，仅读取了前 ${SHEET_INFO_LIMIT} 个的已用区域。\n`
          : '';
      return { content: `${note}${buildModelContent(state)}`, state };
    }
    case 'readSheet': {
      const parsed = parseDocsArgs(readSheetSchema, args);
      let range = parsed.range ? normalizedRange(parsed.range) : undefined;
      let note = '';
      if (!range) {
        const info = await service.exec(
          'sheet.info',
          compact({ nodeId: parsed.nodeId, sheetId: parsed.sheetId }),
        );
        const used = readUsedRange(info);
        if (!used) {
          throw new DingtalkPersonalError('DINGTALK_PERSONAL_INVALID_ARGS', {
            message:
              '参数无效（DINGTALK_PERSONAL_INVALID_ARGS）：该工作表没有已用区域，请指定 range。',
          });
        }
        const clipped = clipA1Range(used);
        if (!clipped) {
          throw new DingtalkPersonalError('DINGTALK_PERSONAL_INVALID_ARGS', {
            message: '参数无效（DINGTALK_PERSONAL_INVALID_ARGS）：已用区域不是合法的 A1 范围。',
          });
        }
        range = clipped.range;
        note = sheetClipNote({ clipped: clipped.clipped, original: used, range, source: 'used' });
      } else {
        const clipped = clipA1Range(range);
        if (!clipped) {
          throw new DingtalkPersonalError('DINGTALK_PERSONAL_INVALID_ARGS', {
            message: '参数无效（DINGTALK_PERSONAL_INVALID_ARGS）：range 不是合法的 A1 范围。',
          });
        }
        if (clipped.clipped) {
          note = sheetClipNote({
            clipped: true,
            original: range,
            range: clipped.range,
            source: 'given',
          });
          range = clipped.range;
        }
      }
      const raw = await service.exec(
        'sheet.read',
        compact({
          nodeId: parsed.nodeId,
          range,
          sheetId: parsed.sheetId,
        }),
      );
      const projected = projectSheetRange(raw, {
        nodeId: parsed.nodeId,
        range,
        ...(parsed.sheetId ? { sheetId: parsed.sheetId } : {}),
      });
      return { content: `${note}${projected.markdown}`, state: projected.state };
    }
    case 'searchAitableBases': {
      const parsed = parseDocsArgs(searchAitableBasesSchema, args);
      const raw = await service.exec('aitable.bases', parsed.query ? { query: parsed.query } : {});
      return { state: projectAitableBases(raw) };
    }
    case 'listAitableTables': {
      const parsed = parseDocsArgs(listAitableTablesSchema, args);
      const raw = await service.exec('aitable.tables', { baseId: parsed.baseId });
      return { state: projectAitableTables(raw, parsed.baseId) };
    }
    case 'getAitableSchema': {
      const parsed = parseDocsArgs(getAitableSchemaSchema, args);
      const raw = await service.exec('aitable.schema', {
        baseId: parsed.baseId,
        tableId: parsed.tableId,
      });
      const state = projectAitableSchema(raw, parsed);
      return {
        content: `写入记录时 cells 的键必须使用 fieldId，不要使用中文字段名。\n${buildModelContent(state)}`,
        state,
      };
    }
    case 'queryAitableRecords': {
      const parsed = parseDocsArgs(queryAitableRecordsSchema, args);
      const schema = projectAitableSchema(
        await service.exec('aitable.schema', { baseId: parsed.baseId, tableId: parsed.tableId }),
        parsed,
      );
      const raw = await service.exec(
        'aitable.records.query',
        compact({
          baseId: parsed.baseId,
          cursor: parsed.cursor,
          limit: parsed.limit ?? 20,
          query: parsed.query,
          tableId: parsed.tableId,
        }),
      );
      const projected = projectAitableRecords(raw, schema);
      return {
        content: renderRecordsContent(projected.state, projected.unknownFieldIds),
        state: projected.state,
      };
    }
    case 'appendDoc': {
      const parsed = parseDocsArgs(appendDocSchema, args);
      const raw = await service.exec('doc.append', {
        markdown: parsed.markdown,
        nodeId: parsed.nodeId,
      });
      const url = readResultUrl(raw);
      return writeResult('appendDoc', '已追加内容到文档', url ? { url } : {});
    }
    case 'createDoc': {
      const parsed = parseDocsArgs(createDocSchema, args);
      const raw = await service.exec(
        'doc.create',
        compact({
          folderId: parsed.folderId,
          markdown: parsed.markdown,
          title: parsed.title,
        }),
      );
      const url = readResultUrl(raw);
      return writeResult('createDoc', `已新建文档「${parsed.title}」`, url ? { url } : {});
    }
    case 'appendSheetRows': {
      const parsed = parseDocsArgs(appendSheetRowsSchema, args);
      const raw = await service.exec('sheet.append', {
        nodeId: parsed.nodeId,
        sheetId: parsed.sheetId,
        values: parsed.rows,
      });
      const url = readResultUrl(raw);
      return writeResult('appendSheetRows', `已追加 ${parsed.rows.length} 行`, {
        count: parsed.rows.length,
        ...(url ? { url } : {}),
      });
    }
    case 'createAitableRecords': {
      const parsed = parseDocsArgs(createAitableRecordsSchema, args);
      const raw = await service.exec('aitable.records.create', {
        baseId: parsed.baseId,
        records: parsed.records.map((record) => ({ cells: record.cells })),
        tableId: parsed.tableId,
      });
      const url = readResultUrl(raw);
      return writeResult('createAitableRecords', `已新增 ${parsed.records.length} 条记录`, {
        count: parsed.records.length,
        ...(url ? { url } : {}),
      });
    }
    case 'updateAitableRecords': {
      const parsed = parseDocsArgs(updateAitableRecordsSchema, args);
      const raw = await service.exec('aitable.records.update', {
        baseId: parsed.baseId,
        records: parsed.records,
        tableId: parsed.tableId,
      });
      const url = readResultUrl(raw);
      return writeResult('updateAitableRecords', `已修改 ${parsed.records.length} 条记录`, {
        count: parsed.records.length,
        ...(url ? { url } : {}),
      });
    }
    default: {
      const unknown: never = apiName;
      throw new DingtalkPersonalError('DINGTALK_PERSONAL_INVALID_ARGS', {
        message: `参数无效（DINGTALK_PERSONAL_INVALID_ARGS）：未知操作 ${String(unknown)}`,
      });
    }
  }
};

export const runDingtalkDocsTool = async (
  db: LobeChatDatabase,
  userId: string,
  apiName: DingtalkDocsApiName,
  args: Record<string, unknown>,
  ctx: DingtalkPersonalToolContext = {},
): Promise<BuiltinServerRuntimeOutput> => {
  let service: DingtalkPersonalService;
  try {
    service = new DingtalkPersonalService(db, userId);
  } catch (error) {
    log('service init failed %s', error instanceof Error ? error.name : 'UnknownError');
    return settleDingtalkPersonalToolError(error, {
      apiName,
      ctx,
      db,
      userId,
      write: WRITE_APIS.has(apiName),
    });
  }

  try {
    const outcome = await execute(service, db, userId, apiName, args ?? {}, ctx.workspaceId);
    await recordDocsWriteAudit(db, userId, apiName, args ?? {}, outcome.state);
    return {
      content: outcome.content ?? buildModelContent(outcome.state),
      state: outcome.state,
      success: true,
    };
  } catch (error) {
    const mapped = apiName === 'downloadDriveFile' ? rewriteDriveDownloadError(error) : error;
    const tooLarge = outputTooLargeResult(mapped);
    if (tooLarge) return tooLarge;
    const disabled = featureDisabledResult(mapped, ctx);
    if (disabled) return disabled;
    return settleDingtalkPersonalToolError(mapped, {
      apiName,
      ctx,
      db,
      service,
      userId,
      write: WRITE_APIS.has(apiName),
    });
  }
};
