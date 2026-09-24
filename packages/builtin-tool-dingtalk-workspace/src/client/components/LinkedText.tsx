'use client';

import { createStaticStyles } from 'antd-style';
import { Fragment, memo, type ReactNode, useMemo } from 'react';
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
 * One link to an already vetted `href` (see `toSafeLinkHref` / `toBatchActionHref`). Links into
 * this app navigate inside the SPA; other web links open in a new tab.
 */
export const TextLink = memo<{ children: ReactNode; href: string }>(({ children, href }) => {
  const inRouter = useInRouterContext();
  const inAppPath = toInAppPath(href, currentOrigin());

  if (inAppPath && inRouter) {
    return (
      <Link className={styles.link} to={inAppPath}>
        {children}
      </Link>
    );
  }

  if (inAppPath) {
    return (
      <a className={styles.link} href={inAppPath}>
        {children}
      </a>
    );
  }

  return (
    <a className={styles.link} href={href} rel={'noopener noreferrer'} target={'_blank'}>
      {children}
    </a>
  );
});

TextLink.displayName = 'DingtalkTextLink';

/**
 * Plain server text with its `[text](url)` links made clickable (see
 * `splitMarkdownLinks`). Links into this app navigate inside the SPA; other web
 * links open in a new tab.
 */
export const LinkedText = memo<{ text: string }>(({ text }) => {
  const segments = useMemo(() => splitMarkdownLinks(text), [text]);

  return (
    <>
      {segments.map((segment, index) => {
        const key = `${index}-${segment.text}`;
        if (segment.type === 'text') return <Fragment key={key}>{segment.text}</Fragment>;

        return (
          <TextLink href={segment.href} key={key}>
            {segment.text}
          </TextLink>
        );
      })}
    </>
  );
});

LinkedText.displayName = 'DingtalkLinkedText';

export default LinkedText;
