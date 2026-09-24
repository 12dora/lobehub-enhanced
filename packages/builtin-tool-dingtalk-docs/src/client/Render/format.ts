export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A non-negative integer, or undefined for anything else. */
export const asCount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;

/**
 * Text of one table cell. The server projects every cell to a string; a number or boolean from
 * older history still reads, anything else (objects, null) shows as an empty cell.
 */
export const cellText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return String(value);
  return '';
};

/** Row-major cell text; rows that are not arrays are skipped rather than crashing the card. */
export const toTableRows = (value: unknown): string[][] =>
  Array.isArray(value) ? value.filter(Array.isArray).map((row) => row.map(cellText)) : [];

/** Every row padded to the same width, so the table never shows ragged columns. */
export const padRows = (rows: string[][], width: number): string[][] =>
  rows.map((row) =>
    row.length >= width ? row : [...row, ...Array.from({ length: width - row.length }, () => '')],
  );

/** What a node is, from the dws `type` / `extension` / `docType` it came with. */
export type NodeKind = 'aitable' | 'doc' | 'folder' | 'online' | 'sheet';

const KIND_BY_EXTENSION: Record<string, NodeKind> = {
  able: 'aitable',
  adoc: 'doc',
  axls: 'sheet',
};

export const resolveNodeKind = (type?: unknown, extension?: unknown): NodeKind | undefined => {
  const normalizedType = typeof type === 'string' ? type.trim().toLowerCase() : '';
  if (normalizedType === 'folder') return 'folder';

  const normalizedExtension = typeof extension === 'string' ? extension.trim().toLowerCase() : '';
  const byExtension = KIND_BY_EXTENSION[normalizedExtension];
  if (byExtension) return byExtension;

  // 钉盘 lists DingTalk's own online documents as `ALIDOC` without saying which kind.
  if (normalizedType === 'alidoc') return 'online';

  return undefined;
};

/** A short file extension worth showing as-is (`xlsx`, `pdf`); anything odd shows nothing. */
export const toExtensionLabel = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;

  const extension = value.trim().toLowerCase();
  return /^[\da-z]{1,8}$/.test(extension) ? extension : undefined;
};
