import { createStaticStyles, cssVar } from 'antd-style';
import type { ReactNode } from 'react';

const styles = createStaticStyles(({ css }) => ({
  link: css`
    color: ${cssVar.colorLink};
    text-decoration: underline;
    text-underline-offset: 2px;
    word-break: break-all;
  `,
}));

/** Absolute http(s) URLs. Flags are applied per call so `lastIndex` never leaks. */
const ABSOLUTE_HTTP_URL = /\bhttps?:\/\/[^\s<>"'`]+/;

const TRAILING_SENTENCE_PUNCT = new Set(['.', ',', ';', ':', '!', '?']);

export interface LinkifySegment {
  href?: string;
  value: string;
}

const countChar = (value: string, ch: string): number => value.split(ch).length - 1;

/**
 * Peel trailing sentence punctuation, then unbalanced `)` so
 * `https://en.wikipedia.org/wiki/X_(y)` stays intact while `(https://example.com).` does not.
 */
const splitUrlAndTrailing = (raw: string): { href: string; trailing: string } => {
  let end = raw.length;
  while (end > 0) {
    const ch = raw[end - 1]!;
    if (TRAILING_SENTENCE_PUNCT.has(ch)) {
      end -= 1;
      continue;
    }
    if (ch === ')') {
      const slice = raw.slice(0, end);
      if (countChar(slice, ')') > countChar(slice, '(')) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  if (end === raw.length) return { href: raw, trailing: '' };
  return { href: raw.slice(0, end), trailing: raw.slice(end) };
};

/** Split plain text so absolute http(s) URLs can be rendered as links. */
export const splitHttpUrls = (text: string): LinkifySegment[] => {
  if (!text) return [];

  const segments: LinkifySegment[] = [];
  const re = new RegExp(ABSOLUTE_HTTP_URL.source, 'gi');
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const raw = match[0];
    const start = match.index;
    const { href, trailing } = splitUrlAndTrailing(raw);

    if (start > lastIndex) {
      segments.push({ value: text.slice(lastIndex, start) });
    }

    if (href) {
      segments.push({ href, value: href });
    }
    if (trailing) {
      segments.push({ value: trailing });
    }
    lastIndex = start + raw.length;
  }

  if (lastIndex < text.length) {
    segments.push({ value: text.slice(lastIndex) });
  }

  return segments;
};

/** Turn absolute http(s) URLs into `<a target="_blank">` nodes; leave all other text as-is. */
export const linkifyText = (text: string): ReactNode => {
  const segments = splitHttpUrls(text);
  if (segments.length === 0) return text;
  if (segments.length === 1 && !segments[0]!.href) return text;

  return segments.map((segment, index) =>
    segment.href ? (
      <a
        className={styles.link}
        href={segment.href}
        key={`url-${index}`}
        rel="noopener noreferrer"
        target="_blank"
      >
        {segment.value}
      </a>
    ) : (
      <span key={`t-${index}`}>{segment.value}</span>
    ),
  );
};
