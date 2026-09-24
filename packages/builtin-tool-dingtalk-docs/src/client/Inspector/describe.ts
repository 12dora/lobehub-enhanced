import type { DingtalkDocsApiNameValue } from '../apiNames';
import { DingtalkDocsApiName, isDingtalkDocsApiName } from '../apiNames';

const P = 'builtins.lobe-dingtalk-docs' as const;

/** Inspector sentences that carry a detail from the call (`plugin` namespace). */
export const DINGTALK_DOCS_INSPECTOR_KEYS = {
  appendSheetRows: `${P}.inspector.appendSheetRows`,
  createAitableRecords: `${P}.inspector.createAitableRecords`,
  createDoc: `${P}.inspector.createDoc`,
  downloadDriveFile: `${P}.inspector.downloadDriveFile`,
  getAitableSchema: `${P}.inspector.getAitableSchema`,
  listMyWikiSpaces: `${P}.inspector.listMyWikiSpaces`,
  listOrgWikiSpaces: `${P}.inspector.listOrgWikiSpaces`,
  nextPage: `${P}.inspector.nextPage`,
  queryAitableRecords: `${P}.inspector.queryAitableRecords`,
  readDoc: `${P}.inspector.readDoc`,
  readSheet: `${P}.inspector.readSheet`,
  searchAitableBases: `${P}.inspector.searchAitableBases`,
  searchDocs: `${P}.inspector.searchDocs`,
  searchDrive: `${P}.inspector.searchDrive`,
  updateAitableRecords: `${P}.inspector.updateAitableRecords`,
} as const;

type InspectorKey =
  (typeof DINGTALK_DOCS_INSPECTOR_KEYS)[keyof typeof DINGTALK_DOCS_INSPECTOR_KEYS];

export type ApiNameKey = `${typeof P}.apiName.${DingtalkDocsApiNameValue}`;

export interface DocsCallSummary {
  /** The sentence: an inspector key with its params, or the plain action name. */
  key: ApiNameKey | InspectorKey;
  /** Wrap the sentence in 「…（下一页）」: the call continues a listing from a cursor. */
  nextPage?: boolean;
  params?: Record<string, number | string>;
}

const MAX_DETAIL_LENGTH = 40;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** One short, single-line detail (a keyword, a title, a range), or undefined. */
const clip = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;

  const text = value.trim().replaceAll(/\s+/g, ' ');
  if (!text) return undefined;

  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text;
};

/**
 * A field of the call: the final arguments win; while they are still streaming, the partial ones
 * already count.
 */
const pickText = (sources: unknown[], field: string): string | undefined => {
  for (const source of sources) {
    if (!isRecord(source)) continue;
    const value = clip(source[field]);
    if (value) return value;
  }
  return undefined;
};

/** Items of an array argument (rows, records), counted once at least one has streamed in. */
const pickCount = (
  sources: unknown[],
  field: string,
  isItem: (value: unknown) => boolean,
): number | undefined => {
  for (const source of sources) {
    if (!isRecord(source)) continue;
    const list = source[field];
    if (!Array.isArray(list)) continue;

    const count = list.filter(isItem).length;
    if (count > 0) return count;
  }
  return undefined;
};

/** A field of the finished result's state, when it is of the expected kind. */
const pickStateText = (state: unknown, kind: string, field: string): string | undefined =>
  isRecord(state) && state.kind === kind ? clip(state[field]) : undefined;

const hasCursor = (sources: unknown[]) =>
  sources.some((source) => isRecord(source) && !!clip(source.cursor));

/**
 * The one-line inspector sentence of a call, e.g. 「搜索文档：周报」, 「读取表格 A1:F20」 or
 * 「向 AI 表格新增 3 条记录」. Built only from what is already there — final or streaming
 * arguments, then the result — and never from ids: until a detail is known it is the plain action
 * name. Undefined for an API outside the toolset.
 */
export const describeDocsCall = (
  apiName: string,
  args?: unknown,
  partialArgs?: unknown,
  state?: unknown,
): DocsCallSummary | undefined => {
  if (!isDingtalkDocsApiName(apiName)) return undefined;

  const sources = [args, partialArgs];
  const plain: DocsCallSummary = { key: `${P}.apiName.${apiName}` };
  const K = DINGTALK_DOCS_INSPECTOR_KEYS;

  const withText = (key: InspectorKey, name: string, value?: string): DocsCallSummary =>
    value ? { key, params: { [name]: value } } : plain;
  const withCount = (key: InspectorKey, count?: number): DocsCallSummary =>
    count ? { key, params: { count } } : plain;

  switch (apiName) {
    case DingtalkDocsApiName.searchDocs: {
      return withText(K.searchDocs, 'query', pickText(sources, 'query'));
    }
    case DingtalkDocsApiName.readDoc: {
      return withText(K.readDoc, 'title', pickStateText(state, 'doc', 'title'));
    }
    case DingtalkDocsApiName.listWikiSpaces: {
      const scope = pickText(sources, 'scope');
      if (scope === 'my') return { key: K.listMyWikiSpaces };
      if (scope === 'org') return { key: K.listOrgWikiSpaces };
      return plain;
    }
    case DingtalkDocsApiName.listWikiNodes:
    case DingtalkDocsApiName.listDrive: {
      return hasCursor(sources) ? { ...plain, nextPage: true } : plain;
    }
    case DingtalkDocsApiName.searchDrive: {
      return withText(K.searchDrive, 'query', pickText(sources, 'query'));
    }
    case DingtalkDocsApiName.downloadDriveFile: {
      return withText(K.downloadDriveFile, 'name', pickStateText(state, 'file', 'name'));
    }
    case DingtalkDocsApiName.readSheet: {
      // Without a range the server reads the used range; the result says which one it was.
      const range = pickText(sources, 'range') ?? pickStateText(state, 'sheetRange', 'range');
      return withText(K.readSheet, 'range', range);
    }
    case DingtalkDocsApiName.searchAitableBases: {
      return withText(K.searchAitableBases, 'query', pickText(sources, 'query'));
    }
    case DingtalkDocsApiName.getAitableSchema: {
      const tableName = pickStateText(state, 'aitableSchema', 'tableName');
      return withText(K.getAitableSchema, 'name', tableName);
    }
    case DingtalkDocsApiName.queryAitableRecords: {
      const summary = withText(K.queryAitableRecords, 'query', pickText(sources, 'query'));
      return hasCursor(sources) ? { ...summary, nextPage: true } : summary;
    }
    case DingtalkDocsApiName.createDoc: {
      return withText(K.createDoc, 'title', pickText(sources, 'title'));
    }
    case DingtalkDocsApiName.appendSheetRows: {
      return withCount(K.appendSheetRows, pickCount(sources, 'rows', Array.isArray));
    }
    case DingtalkDocsApiName.createAitableRecords: {
      return withCount(K.createAitableRecords, pickCount(sources, 'records', isRecord));
    }
    case DingtalkDocsApiName.updateAitableRecords: {
      return withCount(K.updateAitableRecords, pickCount(sources, 'records', isRecord));
    }
    default: {
      // listSheets, listAitableTables, appendDoc: nothing worth naming beyond the action.
      return plain;
    }
  }
};
