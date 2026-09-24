'use client';

import { Block, Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cardStyles } from './styles';

interface ResultCardProps {
  children?: ReactNode;
  danger?: boolean;
  icon?: LucideIcon;
  /** Secondary text on the header line, e.g. a count or a time range. */
  meta?: ReactNode;
  title: ReactNode;
}

/** Outlined result card shared by every lobe-dingtalk-personal render. */
export const ResultCard = memo<ResultCardProps>(({ children, danger, icon, meta, title }) => (
  <Block className={cx(danger && cardStyles.dangerCard)} variant={'outlined'} width={'100%'}>
    <div className={cardStyles.header}>
      {icon && <Icon icon={icon} size={15} />}
      <span className={cardStyles.cardTitle}>{title}</span>
      {meta && <span className={cardStyles.headerMeta}>{meta}</span>}
    </div>
    {children && <div className={cardStyles.body}>{children}</div>}
  </Block>
));

ResultCard.displayName = 'DingtalkPersonalResultCard';

/** Muted label followed by its value; wraps on long values. */
export const ResultField = memo<{ children: ReactNode; label: ReactNode }>(
  ({ children, label }) => (
    <div className={cardStyles.row}>
      <span className={cardStyles.label}>{label}</span>
      <span className={cardStyles.value}>{children}</span>
    </div>
  ),
);

ResultField.displayName = 'DingtalkPersonalResultField';

/** Muted one-line note under a list, e.g. "there is more". */
export const ResultNote = memo<{ children: ReactNode }>(({ children }) => (
  <span className={cardStyles.muted}>{children}</span>
));

ResultNote.displayName = 'DingtalkPersonalResultNote';

/** Only web links leave the card; anything else (e.g. `javascript:`) is dropped. */
export const toSafeHref = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;

  const href = value.trim();
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('/') && !href.startsWith('//')) return href;

  return undefined;
};

/** External link rendered as a small text action, e.g. 「在钉钉中打开」. */
export const ExternalAction = memo<{ children: ReactNode; href?: string }>(({ children, href }) => {
  const safeHref = toSafeHref(href);
  if (!safeHref) return null;

  return (
    <a className={cardStyles.link} href={safeHref} rel={'noopener noreferrer'} target={'_blank'}>
      <Icon icon={ExternalLink} size={12} />
      <span>{children}</span>
    </a>
  );
});

ExternalAction.displayName = 'DingtalkPersonalExternalAction';

interface ExpandableListProps<T> {
  items: T[];
  limit: number;
  renderItem: (item: T, index: number) => ReactNode;
}

/**
 * Shows the first `limit` items and a 「显示全部」 toggle for the rest: a list
 * that only says 「+12」 hides rows the user may have asked the assistant for.
 */
export const ExpandableList = <T,>({ items, limit, renderItem }: ExpandableListProps<T>) => {
  const { t } = useTranslation('plugin');
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, limit);

  return (
    <div className={cardStyles.rows}>
      {visible.map((item, index) => renderItem(item, index))}
      {items.length > limit && (
        <Button
          className={cardStyles.footerButton}
          size={'small'}
          type={'text'}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded
            ? t('builtins.lobe-dingtalk-personal.render.collapse')
            : t('builtins.lobe-dingtalk-personal.render.showAll', { count: items.length })}
        </Button>
      )}
    </div>
  );
};
