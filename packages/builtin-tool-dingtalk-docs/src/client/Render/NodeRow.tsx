'use client';

import { createStaticStyles, cx } from 'antd-style';
import type { ReactNode } from 'react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { cardStyles, toSafeHref } from '../components/shared';
import { resolveNodeKind, toExtensionLabel } from './format';

const styles = createStaticStyles(({ css, cssVar }) => ({
  link: css`
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorPrimaryHover};
      text-decoration: underline;
    }
  `,
}));

interface NodeRowProps {
  /** DingTalk page of the node; only web links become a link. */
  href?: unknown;
  meta?: ReactNode;
  title: string;
}

/**
 * One document / folder / file row: the name (opening the node in DingTalk when the result carried
 * its link) and a muted meta column. Ids never show — they stay React keys.
 */
export const NodeRow = memo<NodeRowProps>(({ href, meta, title }) => {
  const safeHref = toSafeHref(href);

  return (
    <div className={cardStyles.row}>
      {safeHref ? (
        <a
          className={cx(cardStyles.rowTitle, styles.link)}
          href={safeHref}
          rel={'noopener noreferrer'}
          target={'_blank'}
          title={title}
        >
          {title}
        </a>
      ) : (
        <span className={cardStyles.rowTitle} title={title}>
          {title}
        </span>
      )}
      {meta ? <span className={cardStyles.rowMeta}>{meta}</span> : null}
    </div>
  );
});

NodeRow.displayName = 'DingtalkDocsNodeRow';

/**
 * 「文件夹」「表格」「AI 表格」… for a node, falling back to its plain file extension (`xlsx`).
 */
export const useNodeKindLabel = () => {
  const { t } = useTranslation('plugin');

  return useCallback(
    (type?: unknown, extension?: unknown): string | undefined => {
      const kind = resolveNodeKind(type, extension);
      if (kind) return t(`builtins.lobe-dingtalk-docs.render.kind.${kind}` as const);

      return toExtensionLabel(extension);
    },
    [t],
  );
};

/** Meta parts joined with 「 · 」, or undefined when none is left. */
export const joinMeta = (...parts: (string | undefined | false | null)[]): string | undefined => {
  const text = parts.filter(Boolean).join(' · ');
  return text || undefined;
};
