'use client';

import { createStaticStyles } from 'antd-style';
import { Fragment, memo, useMemo } from 'react';
import { Link, useInRouterContext } from 'react-router';

import { splitMarkdownLinks, toInAppPath } from './linkText';

const styles = createStaticStyles(({ css, cssVar }) => ({
  link: css`
    color: ${cssVar.colorPrimary};
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorPrimaryHover};
      text-decoration: underline;
    }
  `,
}));

const currentOrigin = (): string | undefined => {
  try {
    return typeof window === 'undefined' ? undefined : window.location.origin;
  } catch {
    return undefined;
  }
};

/**
 * Plain server text with its `[text](url)` links made clickable (see
 * `splitMarkdownLinks`). Links into this app navigate inside the SPA; other web
 * links open in a new tab.
 */
export const LinkedText = memo<{ text: string }>(({ text }) => {
  const inRouter = useInRouterContext();
  const segments = useMemo(() => splitMarkdownLinks(text), [text]);
  const origin = currentOrigin();

  return (
    <>
      {segments.map((segment, index) => {
        const key = `${index}-${segment.text}`;
        if (segment.type === 'text') return <Fragment key={key}>{segment.text}</Fragment>;

        const inAppPath = toInAppPath(segment.href, origin);

        if (inAppPath && inRouter) {
          return (
            <Link className={styles.link} key={key} to={inAppPath}>
              {segment.text}
            </Link>
          );
        }

        if (inAppPath) {
          return (
            <a className={styles.link} href={inAppPath} key={key}>
              {segment.text}
            </a>
          );
        }

        return (
          <a
            className={styles.link}
            href={segment.href}
            key={key}
            rel={'noopener noreferrer'}
            target={'_blank'}
          >
            {segment.text}
          </a>
        );
      })}
    </>
  );
});

LinkedText.displayName = 'DingtalkLinkedText';

export default LinkedText;
