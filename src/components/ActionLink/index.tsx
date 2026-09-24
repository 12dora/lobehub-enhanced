'use client';

import { createStaticStyles, cssVar } from 'antd-style';
import { ExternalLink } from 'lucide-react';
import { memo, type MouseEventHandler, type ReactNode } from 'react';
import { useInRouterContext } from 'react-router';

import Link from '@/components/Link';

import { resolveActionHref } from './href';

export { type ActionHref, resolveActionHref } from './href';

const styles = createStaticStyles(({ css }) => ({
  icon: css`
    flex-shrink: 0;
    margin-inline-start: 2px;
    vertical-align: -1px;
  `,
  link: css`
    color: ${cssVar.colorPrimary};
    text-decoration: none;
    overflow-wrap: anywhere;

    &:hover {
      color: ${cssVar.colorPrimaryHover};
      text-decoration: underline;
    }
  `,
}));

export interface ActionLinkProps {
  children?: ReactNode;
  className?: string;
  /** App-relative path or https URL; anything else renders the children as plain text. */
  href?: string;
  /** E.g. close the modal the link sits in before the page changes under it. */
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}

/**
 * The one-click link a "do this by hand" message carries: app paths stay in the SPA (the app
 * `Link`), external consoles open in a new tab. Outside a router (tests, detached renders) an app
 * path falls back to a plain anchor.
 */
const ActionLink = memo<ActionLinkProps>(({ children, className, href, onClick }) => {
  const inRouter = useInRouterContext();
  const target = resolveActionHref(href);

  if (!target) return <>{children}</>;

  const classes = className ? `${styles.link} ${className}` : styles.link;

  if (target.external)
    return (
      <a
        className={classes}
        href={target.href}
        rel={'noopener noreferrer'}
        target={'_blank'}
        onClick={onClick}
      >
        {children}
        <ExternalLink aria-hidden className={styles.icon} size={12} />
      </a>
    );

  if (!inRouter)
    return (
      <a className={classes} href={target.href} onClick={onClick}>
        {children}
      </a>
    );

  return (
    <Link className={classes} href={target.href} onClick={onClick}>
      {children}
    </Link>
  );
});

ActionLink.displayName = 'ActionLink';

export default ActionLink;
