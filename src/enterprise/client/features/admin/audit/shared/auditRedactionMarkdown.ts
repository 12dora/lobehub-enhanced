/**
 * Server-applied `[REDACTED …]` markers must survive markdown rendering verbatim and stay
 * visually distinct. Left in the source they are fragile: `[REDACTED email]: x` at a line start
 * is a link-reference definition (the marker would silently vanish), and `[REDACTED](url)` is a
 * link. So markers are swapped for opaque private-use sentinels before parsing, then turned into
 * `audit-redacted` elements (text) or restored literally (code, urls, alt text) after parsing.
 */

/** Hast tag name the chat markdown maps to the redaction chip component. */
export const AUDIT_REDACTED_TAG = 'audit-redacted';

const REDACTION_MARKER = /\[REDACTED[^\]]*\]/g;
const SENTINEL_OPEN = '\uE000';
const SENTINEL_CLOSE = '\uE001';
const SENTINEL = /\uE000(\d+)\uE001/g;
const SENTINEL_CHARS = /[\uE000\uE001]/g;

export interface PreparedRedactedMarkdown {
  markers: string[];
  text: string;
}

/**
 * Swap each redaction marker for a sentinel. Pre-existing sentinel code points in the source are
 * dropped first (private-use, invisible) so message content can never forge a chip.
 */
export const prepareRedactedMarkdown = (content: string): PreparedRedactedMarkdown => {
  const markers: string[] = [];
  const text = content.replaceAll(SENTINEL_CHARS, '').replaceAll(REDACTION_MARKER, (marker) => {
    markers.push(marker);
    return `${SENTINEL_OPEN}${markers.length - 1}${SENTINEL_CLOSE}`;
  });
  return { markers, text };
};

/** Put the original markers back into a string (code, urls, titles …). */
export const restoreRedactionMarkers = (value: string, markers: readonly string[]): string =>
  value.replaceAll(SENTINEL, (whole, index: string) => markers[Number(index)] ?? whole);

/** Split plain text into literal runs and marker references. */
export const splitRedactionSentinels = (
  value: string,
  markers: readonly string[],
): Array<{ marker?: string; value: string }> => {
  const out: Array<{ marker?: string; value: string }> = [];
  let last = 0;
  for (const match of value.matchAll(SENTINEL)) {
    const start = match.index ?? 0;
    if (start > last) out.push({ value: value.slice(last, start) });
    const marker = markers[Number(match[1])];
    out.push(marker === undefined ? { value: match[0] } : { marker, value: marker });
    last = start + match[0].length;
  }
  if (last < value.length) out.push({ value: value.slice(last) });
  return out;
};

interface MdNode {
  [key: string]: unknown;
  children?: MdNode[];
  type: string;
  value?: string;
}

const RESTORABLE_FIELDS = ['value', 'url', 'alt', 'title'] as const;

const CHIP_TYPE = 'auditRedacted';
const LINK_TYPES = new Set(['link', 'linkReference']);

const containsChip = (node: MdNode): boolean =>
  node.type === CHIP_TYPE || Boolean(node.children?.some(containsChip));

const transform = (node: MdNode, markers: readonly string[]): void => {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const original of node.children) {
    // Raw HTML in evidence is shown as the literal source, never parsed into DOM (belt and braces
    // on top of `allowHtml={false}`, which would otherwise silently drop it).
    const child: MdNode =
      original.type === 'html' ? { type: 'text', value: original.value ?? '' } : original;
    if (
      child.type === 'text' &&
      typeof child.value === 'string' &&
      child.value.includes('\uE000')
    ) {
      for (const part of splitRedactionSentinels(child.value, markers)) {
        next.push(
          part.marker === undefined
            ? { type: 'text', value: part.value }
            : {
                data: {
                  hChildren: [{ type: 'text', value: part.marker }],
                  hName: AUDIT_REDACTED_TAG,
                },
                type: CHIP_TYPE,
              },
        );
      }
      continue;
    }
    for (const field of RESTORABLE_FIELDS) {
      const current = child[field];
      if (typeof current === 'string' && current.includes('\uE000')) {
        child[field] = restoreRedactionMarkers(current, markers);
      }
    }
    transform(child, markers);
    // A chip must never be a descendant of <a>: `[See [REDACTED]](https://evil.example)` would
    // otherwise dress an author-controlled link up as server evidence. Unwrap such links to their
    // text (href dropped) so the marker renders as a plain, non-clickable chip.
    if (LINK_TYPES.has(child.type) && containsChip(child)) {
      next.push(...(child.children ?? []));
      continue;
    }
    next.push(child);
  }
  node.children = next;
};

/**
 * Remark plugin factory bound to one message's marker table: redaction chips (never inside a
 * link) and raw HTML rendered as literal text.
 */
export const createRemarkAuditRedaction = (markers: readonly string[]) => () => (tree: unknown) => {
  transform(tree as MdNode, markers);
};
