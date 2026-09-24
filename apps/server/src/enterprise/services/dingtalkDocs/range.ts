export const MAX_SHEET_ROWS = 200;
export const MAX_SHEET_COLS = 30;

const RANGE_RE = /^([A-Z]{1,3})([1-9]\d{0,4})(?::([A-Z]{1,3})([1-9]\d{0,4}))?$/;

export interface A1Span {
  endCol: number;
  endRow: number;
  startCol: number;
  startRow: number;
}

export const columnIndex = (letters: string): number => {
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index;
};

export const columnName = (index: number): string => {
  let current = index;
  let name = '';
  while (current > 0) {
    const rem = (current - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
};

export const parseA1 = (range: string): A1Span | undefined => {
  const match = RANGE_RE.exec(range.trim().toUpperCase());
  if (!match) return undefined;
  const startCol = columnIndex(match[1]);
  const startRow = Number(match[2]);
  const endCol = match[3] ? columnIndex(match[3]) : startCol;
  const endRow = match[4] ? Number(match[4]) : startRow;
  if (endCol < startCol || endRow < startRow) return undefined;
  return { endCol, endRow, startCol, startRow };
};

export const formatA1 = (span: A1Span): string => {
  const start = `${columnName(span.startCol)}${span.startRow}`;
  if (span.startCol === span.endCol && span.startRow === span.endRow) return start;
  return `${start}:${columnName(span.endCol)}${span.endRow}`;
};

export const spanSize = (span: A1Span): { cols: number; rows: number } => ({
  cols: span.endCol - span.startCol + 1,
  rows: span.endRow - span.startRow + 1,
});

/**
 * Clip a range to 200×30 from its top-left cell. Any legal A1 range is accepted;
 * a span past the cap is clipped and {@link sheetClipNote} names the next few blocks.
 */
export const clipA1Range = (
  range: string,
  maxRows = MAX_SHEET_ROWS,
  maxCols = MAX_SHEET_COLS,
): { clipped: boolean; range: string } | undefined => {
  const span = parseA1(range);
  if (!span) return undefined;
  const size = spanSize(span);
  const rows = Math.min(size.rows, maxRows);
  const cols = Math.min(size.cols, maxCols);
  const clippedSpan: A1Span = {
    endCol: span.startCol + cols - 1,
    endRow: span.startRow + rows - 1,
    startCol: span.startCol,
    startRow: span.startRow,
  };
  return { clipped: rows !== size.rows || cols !== size.cols, range: formatA1(clippedSpan) };
};

/** Any A1 range. Size is not a syntax error; the reader clips a span past 200×30. */
export const assertSheetRange = (range: string): string => {
  const span = parseA1(range);
  if (!span) throw new Error('range 必须是 A1 表示法');
  return formatA1(span);
};

/** How many following blocks a clip note names before 「等 N 块」. */
const UNREAD_BLOCKS_LISTED = 3;

export interface UnreadBlocks {
  /** The next blocks, at most three. */
  ranges: string[];
  /** Blocks past `ranges`. Zero when every remaining block is named. */
  rest: number;
}

/**
 * Blocks still unread after the top-left 200×30 clip.
 * `A1:AO14` → `AE1:AO14`. A span such as `A1:ZZZ99999` is hundreds of
 * thousands of blocks; only the next three are named.
 */
export const unreadBlocks = (
  original: string,
  maxRows = MAX_SHEET_ROWS,
  maxCols = MAX_SHEET_COLS,
): UnreadBlocks => {
  const span = parseA1(original);
  if (!span) return { ranges: [], rest: 0 };
  const size = spanSize(span);
  if (size.rows <= maxRows && size.cols <= maxCols) return { ranges: [], rest: 0 };
  const rowBlocks = Math.ceil(size.rows / maxRows);
  const colBlocks = Math.ceil(size.cols / maxCols);
  const total = rowBlocks * colBlocks - 1;
  const listed = Math.min(UNREAD_BLOCKS_LISTED, total);
  const ranges: string[] = [];
  for (let row = 0; row < rowBlocks && ranges.length < listed; row += 1) {
    for (let col = 0; col < colBlocks && ranges.length < listed; col += 1) {
      if (row === 0 && col === 0) continue;
      const startRow = span.startRow + row * maxRows;
      const startCol = span.startCol + col * maxCols;
      ranges.push(
        formatA1({
          endCol: Math.min(span.endCol, startCol + maxCols - 1),
          endRow: Math.min(span.endRow, startRow + maxRows - 1),
          startCol,
          startRow,
        }),
      );
    }
  }
  return { ranges, rest: total - ranges.length };
};

export const sheetClipNote = (input: {
  clipped: boolean;
  original: string;
  range: string;
  source: 'given' | 'used';
}): string => {
  if (!input.clipped) {
    return input.source === 'used' ? `未指定 range，已读取已用区域 ${input.range}。\n` : '';
  }
  const next = unreadBlocks(input.original);
  const follow =
    next.ranges.length > 0
      ? `继续读取请用 range=${next.ranges.join('，或 range=')}${
          next.rest > 0 ? `，等 ${next.rest} 块` : ''
        }。`
      : '';
  if (input.source === 'used') {
    return `未指定 range。已用区域 ${input.original} 超出 200 行 × 30 列，已改为读取 ${input.range}。${follow}\n`;
  }
  return `指定的 range ${input.original} 超出一次最多 200 行 × 30 列，已改为读取 ${input.range}。${follow}\n`;
};
