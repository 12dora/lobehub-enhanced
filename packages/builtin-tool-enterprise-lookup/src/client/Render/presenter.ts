/**
 * Presenter for the enterprise-lookup result payloads.
 *
 * Both providers answer through MCP content, and neither answers in one shape: 企查查 returns a
 * single text block holding a JSON document, 天眼查 returns markdown (tables and prose), and either
 * may wrap that in a content array or hand the object over directly. The card cannot know which,
 * so this module is deliberately tolerant: it recovers whatever structure is actually there and
 * gives up to plain text rather than throwing.
 *
 * Everything here is pure — no React, no i18n — so the shaping is testable on its own and the view
 * only has to decide how a row looks.
 */

/** Values longer than this are clamped to two lines with an 「展开」 affordance. */
export const PRESENTER_LONG_VALUE_CHARS = 80;

/** A compact table stays compact: at most this many columns, taken from the first rows. */
export const PRESENTER_MAX_COLUMNS = 5;

/** Rows shown before the table defers to its 「共 N 条」 footer. */
export const PRESENTER_MAX_ROWS = 8;

/** How a list of primitives reads in one cell. */
export const PRESENTER_LIST_SEPARATOR = '、';

/** 「父 · 子」 — a nested object flattened one level keeps its parent in the label. */
export const PRESENTER_LABEL_SEPARATOR = ' · ';

export interface PresentedRow {
  label: string;
  /** The value needs clamping; the view renders it at two lines with an expander. */
  long: boolean;
  value: string;
}

/**
 * The 项目 / 内容 pairs — the shape nearly every payload ends up in.
 *
 * `rows` is ordered for the two-pairs-per-row grid the card lays them out in: short pairs first in
 * the provider's own order, then the long ones (经营范围, 地址 …) which each take a whole row. That
 * way only the last short row can end up half-empty.
 */
export interface PresentedPairs {
  /** Short pairs first, long pairs last; the provider's order is kept inside each group. */
  rows: PresentedRow[];
  type: 'pairs';
}

/** A list of records (候选企业, 股东, 分支机构 …) as a compact grid. */
export interface PresentedTable {
  columns: string[];
  rows: string[][];
  /** The key the list was found under; absent when the whole payload was the list. */
  title?: string;
  /** How many records there really are — `rows` is capped. */
  total: number;
  type: 'table';
}

export interface PresentedMarkdown {
  text: string;
  type: 'markdown';
}

export interface PresentedText {
  text: string;
  type: 'text';
}

export type PresentedSection = PresentedMarkdown | PresentedPairs | PresentedTable | PresentedText;

export interface PresentedResult {
  /** The text the payload carried, kept so the card can still offer the raw answer. */
  rawText?: string;
  sections: PresentedSection[];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRecordList = (value: unknown): value is Record<string, unknown>[] =>
  Array.isArray(value) && value.length > 0 && value.every((item) => isPlainObject(item));

const stringify = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
};

/**
 * The text an MCP payload carries.
 *
 * Accepts the shapes the runtime actually produces — a bare string, a content array, a single
 * `{ type: 'text', text }` block, or a `{ content: [...] }` envelope — and returns `undefined` for
 * anything else, which is the signal that the payload is already structured data.
 */
export const extractPayloadText = (payload: unknown): string | undefined => {
  if (typeof payload === 'string') return payload;

  if (Array.isArray(payload)) {
    const parts = payload
      .map((item) => extractPayloadText(item))
      .filter((part): part is string => !!part && part.trim().length > 0);

    return parts.length > 0 ? parts.join('\n\n') : undefined;
  }

  if (isPlainObject(payload)) {
    if (Array.isArray(payload.content)) return extractPayloadText(payload.content);
    if (typeof payload.text === 'string') return payload.text;
  }

  return undefined;
};

/** Parse a JSON document, but only when the text plausibly is one — prose must stay prose. */
export const parseJsonPayload = (text: string): unknown => {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;

  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
};

const MARKDOWN_PATTERNS = [
  /^ {0,3}#{1,6}\s/m,
  /^\s*\|.*\|\s*$/m,
  /^\s*[*-]\s+\S/m,
  /^\s*\d+\.\s+\S/m,
  /\*\*[^\n*]+\*\*/,
  /\[[^\]\n]+\]\([^\s)]+\)/,
  /^\s*>\s+\S/m,
  /```/,
];

/** Whether the text is worth handing to the markdown renderer rather than showing verbatim. */
export const looksLikeMarkdown = (text: string): boolean =>
  MARKDOWN_PATTERNS.some((pattern) => pattern.test(text));

/** One value as a single line: lists join with 、, anything nested falls back to compact JSON. */
export const formatPresentedValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return String(value);

  if (Array.isArray(value))
    return value
      .map((item) => formatPresentedValue(item))
      .filter((part) => part.length > 0)
      .join(PRESENTER_LIST_SEPARATOR);

  if (isPlainObject(value)) return Object.keys(value).length > 0 ? stringify(value) : '';

  return '';
};

const toRow = (label: string, value: unknown): PresentedRow | undefined => {
  const text = formatPresentedValue(value);
  // An empty value says nothing an operator can act on; the row would only add noise.
  if (text.length === 0) return undefined;

  return { label, long: text.length > PRESENTER_LONG_VALUE_CHARS, value: text };
};

/**
 * A list of records as a compact table.
 *
 * Columns are the union of the keys carried by the first `PRESENTER_MAX_COLUMNS` records, capped at
 * the same number: providers pad later records with extra fields, and a grid that grows a column
 * per record stops being readable long before it stops being accurate.
 */
const buildTable = (
  title: string | undefined,
  items: Record<string, unknown>[],
): PresentedTable => {
  const columns: string[] = [];
  for (const item of items.slice(0, PRESENTER_MAX_COLUMNS))
    for (const key of Object.keys(item))
      if (!columns.includes(key) && columns.length < PRESENTER_MAX_COLUMNS) columns.push(key);

  return {
    columns,
    rows: items
      .slice(0, PRESENTER_MAX_ROWS)
      .map((item) => columns.map((column) => formatPresentedValue(item[column]))),
    ...(title ? { title } : {}),
    total: items.length,
    type: 'table',
  };
};

/**
 * Pairs as the grid wants them: the short ones first, then the long ones.
 *
 * The card packs two pairs per row and gives a long value the whole row, so a long pair left in the
 * middle would strand the slot beside it. Both groups keep the provider's own order, which is the
 * reading order, so the only thing this changes is where the long values sit.
 */
const orderPairs = (rows: PresentedRow[]): PresentedRow[] => [
  ...rows.filter((row) => !row.long),
  ...rows.filter((row) => row.long),
];

/**
 * A flat object as 项目 / 内容 rows, in the order the provider wrote them.
 *
 * Record lists interrupt the pairs rather than being appended after them: the provider's order is
 * the reading order (匹配结果 before 企业信息), and reordering would separate a list from the line
 * that introduces it.
 */
const flattenObject = (source: Record<string, unknown>): PresentedSection[] => {
  const sections: PresentedSection[] = [];
  let pairs: PresentedRow[] = [];

  const flush = () => {
    if (pairs.length === 0) return;
    sections.push({ rows: orderPairs(pairs), type: 'pairs' });
    pairs = [];
  };

  for (const [key, value] of Object.entries(source)) {
    if (isRecordList(value)) {
      flush();
      sections.push(buildTable(key, value));
      continue;
    }

    if (isPlainObject(value)) {
      // One level only: deeper nesting is rare here and reads better as compact JSON in a cell
      // than as a label with three ancestors in it.
      for (const [childKey, childValue] of Object.entries(value)) {
        const row = toRow(`${key}${PRESENTER_LABEL_SEPARATOR}${childKey}`, childValue);
        if (row) pairs.push(row);
      }
      continue;
    }

    const row = toRow(key, value);
    if (row) pairs.push(row);
  }

  flush();

  return sections;
};

const presentData = (data: unknown): PresentedSection[] => {
  if (isRecordList(data)) return [buildTable(undefined, data)];
  if (isPlainObject(data)) return flattenObject(data);

  const text = formatPresentedValue(data);

  return text.length > 0 ? [{ text, type: 'text' }] : [];
};

/**
 * Whatever the provider answered, as sections the card can lay out.
 *
 * JSON wins when the payload parses as one; otherwise markdown when the text looks like markdown;
 * otherwise the text verbatim. An unreadable payload yields no sections at all, which the card
 * shows as「暂无内容」rather than as an empty table.
 */
export const presentEnterpriseResult = (payload: unknown): PresentedResult => {
  const rawText = extractPayloadText(payload);
  const data = rawText === undefined ? payload : parseJsonPayload(rawText);

  if (data !== undefined) {
    const sections = presentData(data);
    if (sections.length > 0) return { ...(rawText ? { rawText } : {}), sections };
  }

  const trimmed = rawText?.trim() ?? '';
  if (trimmed.length === 0) return { sections: [] };

  return {
    rawText,
    sections: [{ text: trimmed, type: looksLikeMarkdown(trimmed) ? 'markdown' : 'text' }],
  };
};

/** One company as the tool knows it — the subset both providers agree on. */
export interface EnterpriseCompanySummary {
  creditCode?: string | null;
  /** 企查查 answers with a list here, 天眼查 with a single name. */
  legalPerson?: string | string[] | null;
  name?: string | null;
  status?: string | null;
}

/** 「名称 · 统一社会信用代码 · 法定代表人 · 状态」, with whatever the provider left out dropped. */
export const formatCompanySummary = (company: EnterpriseCompanySummary): string =>
  [company.name, company.creditCode, company.legalPerson, company.status]
    .map((part) => formatPresentedValue(part))
    .filter((part) => part.length > 0)
    .join(PRESENTER_LABEL_SEPARATOR);
