'use client';

import { createStaticStyles, cssVar } from 'antd-style';
import { memo, type ReactNode, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import AuthorizeCard from './AuthorizeCard';
import { useDingtalkPersonalEnabled } from './capability';
import { useDingtalkPersonalStatus } from './useDingtalkPersonalStatus';

/**
 * `?dingtalkPersonal=authorize` — the one-click link an unauthorized tool result hands the member
 * (contract §4.2 addendum). The server builds the same URL; keep the two in step.
 */
export const DINGTALK_PERSONAL_QUERY_KEY = 'dingtalkPersonal';
export const DINGTALK_PERSONAL_AUTHORIZE_VALUE = 'authorize';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;

    min-height: 0;
  `,
  shell: css`
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  `,
  strip: css`
    overflow-y: auto;
    flex-shrink: 0;

    max-height: 45%;
    padding-block: 16px;
    padding-inline: 24px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

export interface DingtalkPersonalSettingsStripProps {
  children: ReactNode;
}

/**
 * Puts the 钉钉个人数据 card above whatever the connector settings page renders (the managed list
 * or the ordinary catalog alike), on the personal and the workspace connector routes.
 *
 * Without the capability the children are returned bare: the master-detail catalog only scrolls
 * while its height chain is unbroken, so an unconditional wrapper would clip it. With it, the card
 * gets a bounded strip with its own scroller and the page keeps a shrinkable flex box below.
 *
 * Arriving through the authorize link, the card is scrolled into view and starts the login on its
 * own; the query is dropped from the URL (history replaced) so a reload does not start another.
 */
export const DingtalkPersonalSettingsStrip = memo<DingtalkPersonalSettingsStripProps>(
  ({ children }) => {
    const enabled = useDingtalkPersonalEnabled();
    const { data } = useDingtalkPersonalStatus(enabled);
    const [searchParams, setSearchParams] = useSearchParams();
    const requested =
      searchParams.get(DINGTALK_PERSONAL_QUERY_KEY) === DINGTALK_PERSONAL_AUTHORIZE_VALUE;
    const [autoAuthorize, setAutoAuthorize] = useState(requested);
    const stripRef = useRef<HTMLElement>(null);

    useEffect(() => {
      if (!requested) return;
      setAutoAuthorize(true);
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete(DINGTALK_PERSONAL_QUERY_KEY);
          return next;
        },
        { replace: true },
      );
    }, [requested, setSearchParams]);

    const visible = enabled && data?.state !== 'disabled';

    useEffect(() => {
      if (autoAuthorize && visible)
        stripRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }, [autoAuthorize, visible]);

    if (!visible) return <>{children}</>;

    return (
      <div className={styles.shell}>
        <section className={styles.strip} ref={stripRef}>
          <AuthorizeCard autoStart={autoAuthorize} />
        </section>
        <div className={styles.body}>{children}</div>
      </div>
    );
  },
);

DingtalkPersonalSettingsStrip.displayName = 'DingtalkPersonalSettingsStrip';
