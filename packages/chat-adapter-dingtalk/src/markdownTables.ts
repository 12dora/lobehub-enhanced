/**
 * DingTalk `sampleMarkdown` renders bold, lists, and links, but not GFM tables.
 * Turn tables into short lines before send. Fenced code blocks are copied through.
 * A pipe inside an inline code span, or a backslash-escaped pipe, is not a column break.
 *
 * - 2-column key/value rows: `**键**：值`
 * - 4-column enterprise pair layout (`项目 | 内容 | 项目 | 内容`): each pair is
 *   its own `**键**：值` line
 * - other rows: `**第一列**：列2名 值；列3名 值`
 */

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE_RE = /^ {0,3}(?:`{3,}|~{3,})\s*$/;

const splitCells = (line: string): string[] => {
  let text = line.trim().replace(/\r$/, '');
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|')) text = text.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  let i = 0;
  while (i < text.length) {
    const ticks = /^`+/.exec(text.slice(i));
    if (ticks) {
      const mark = ticks[0];
      const closeAt = text.indexOf(mark, i + mark.length);
      if (closeAt === -1) {
        current += text.slice(i);
        break;
      }
      current += text.slice(i, closeAt + mark.length);
      i = closeAt + mark.length;
      continue;
    }
    if (text[i] === '\\' && text[i + 1] === '|') {
      current += '|';
      i += 2;
      continue;
    }
    if (text[i] === '|') {
      cells.push(current.trim());
      current = '';
      i += 1;
      continue;
    }
    current += text[i];
    i += 1;
  }
  cells.push(current.trim());
  return cells;
};

const isSeparatorRow = (line: string): boolean => {
  if (!line.includes('-') || !line.includes('|')) return false;
  const cells = splitCells(line);
  if (cells.length < 2) return false;
  return cells.every((cell) => /^:?-+:?$/.test(cell.replaceAll(/\s/g, '')));
};

const plainCell = (cell: string | undefined): string =>
  (cell ?? '').replaceAll('**', '').replaceAll(/\s+/g, ' ').trim();

/** Enterprise lookup's side-by-side `项目 | 内容 | 项目 | 内容` header. */
const isProjectPairHeader = (headers: string[]): boolean => {
  const norm = headers.map((header) => plainCell(header));
  if (norm.length < 4 || norm.length % 2 !== 0) return false;
  if (norm[0] !== '项目' || norm[1] !== '内容') return false;
  for (let i = 0; i < norm.length; i += 2) {
    if (norm[i] !== '项目' || norm[i + 1] !== '内容') return false;
  }
  return true;
};

const pairLines = (cells: string[]): string => {
  const lines: string[] = [];
  for (let i = 0; i < cells.length; i += 2) {
    const key = plainCell(cells[i]);
    const value = plainCell(cells[i + 1]);
    if (!key && !value) continue;
    if (!key) {
      lines.push(value);
      continue;
    }
    lines.push(value ? `**${key}**：${value}` : `**${key}**`);
  }
  return lines.join('\n');
};

const formatDataRow = (headers: string[], cells: string[]): string => {
  const width = Math.max(headers.length, cells.length);
  if (width < 2) return plainCell(cells[0]);

  if (isProjectPairHeader(headers)) return pairLines(cells);

  if (headers.length === 2 || (cells.length === 2 && headers.length <= 2)) {
    return pairLines([cells[0] ?? '', cells[1] ?? '']);
  }

  const key = plainCell(cells[0]);
  const rest: string[] = [];
  for (let i = 1; i < width; i++) {
    const value = plainCell(cells[i]);
    if (!value) continue;
    const name = plainCell(headers[i]);
    rest.push(name ? `${name} ${value}` : value);
  }
  if (!key && rest.length === 0) return '';
  if (!key) return rest.join('；');
  if (rest.length === 0) return `**${key}**`;
  return `**${key}**：${rest.join('；')}`;
};

const tryParseTable = (
  lines: string[],
  start: number,
): { end: number; replacement: string } | null => {
  if (start + 1 >= lines.length) return null;
  const headerLine = lines[start];
  if (!headerLine.includes('|') || isSeparatorRow(headerLine)) return null;
  if (!isSeparatorRow(lines[start + 1])) return null;

  const headers = splitCells(headerLine);
  if (headers.length < 2) return null;

  const rows: string[][] = [];
  let end = start + 2;
  while (end < lines.length) {
    const line = lines[end];
    if (!line.trim() || !line.includes('|') || isSeparatorRow(line)) break;
    // A header row whose next line is a separator starts the next table.
    if (end + 1 < lines.length && isSeparatorRow(lines[end + 1])) break;
    rows.push(splitCells(line));
    end += 1;
  }

  const replacement = rows
    .map((row) => formatDataRow(headers, row))
    .filter(Boolean)
    .join('\n');
  return { end, replacement };
};

export function convertGfmTablesForDingTalk(markdown: string): string {
  if (!markdown.includes('|')) return markdown;

  const lines = markdown.split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceSize = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const mark = fence[1];
      if (!inFence) {
        inFence = true;
        fenceChar = mark[0];
        fenceSize = mark.length;
        out.push(line);
        continue;
      }
      if (mark[0] === fenceChar && mark.length >= fenceSize && FENCE_CLOSE_RE.test(line)) {
        inFence = false;
        fenceChar = '';
        fenceSize = 0;
      }
      out.push(line);
      continue;
    }

    if (inFence) {
      out.push(line);
      continue;
    }

    const table = tryParseTable(lines, i);
    if (!table) {
      out.push(line);
      continue;
    }
    if (table.replacement) out.push(table.replacement);
    i = table.end - 1;
  }

  return out.join('\n');
}
