/**
 * Server-authored notes may carry one markdown link, e.g.
 * 「…全部待办：[点此前往授权](https://aihub.example.com/settings/connector)」. This is
 * the whole markdown support: `[text](url)` becomes a link when the url is a web
 * address or an in-app path, every other character stays plain text. Nothing is
 * ever handed to the DOM as HTML.
 */

export type LinkTextSegment =
  { text: string; type: 'text' } | { href: string; text: string; type: 'link' };

const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^\s)]+)\)/g;

/** `http(s)://…` or a root-relative path; anything else (`javascript:`, `//host`, …) is refused. */
export const toSafeLinkHref = (value: string): string | undefined => {
  const href = value.trim();

  if (/^https?:\/\/[^\s/?#]/i.test(href)) return href;
  if (href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/\\')) return href;

  return undefined;
};

/** Text and link segments in order; an unsafe link stays in the text exactly as written. */
export const splitMarkdownLinks = (text: string): LinkTextSegment[] => {
  const segments: LinkTextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const [raw, label, target] = match;
    const start = match.index ?? 0;
    const href = toSafeLinkHref(target);
    const linkText = label.trim();
    if (!href || !linkText) continue;

    if (start > cursor) segments.push({ text: text.slice(cursor, start), type: 'text' });
    segments.push({ href, text: linkText, type: 'link' });
    cursor = start + raw.length;
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor), type: 'text' });

  return segments;
};

/**
 * The in-app path for a link that points at this app: a root-relative path, or an
 * absolute url on `origin`. Links elsewhere return undefined and open normally.
 */
export const toInAppPath = (href: string, origin?: string): string | undefined => {
  if (href.startsWith('/')) return href;
  if (!origin) return undefined;

  try {
    const url = new URL(href);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : undefined;
  } catch {
    return undefined;
  }
};
