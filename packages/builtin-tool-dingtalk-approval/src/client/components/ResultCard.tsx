'use client';

import { Block, Icon } from '@lobehub/ui';
import { Tag } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';

import { cardStyles } from './styles';

interface ResultCardProps {
  children?: ReactNode;
  danger?: boolean;
  icon?: LucideIcon;
  /** Secondary text on the header line, e.g. a count or a scope. */
  meta?: ReactNode;
  title: ReactNode;
}

/** Outlined result card shared by every lobe-dingtalk-approval render. */
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

ResultCard.displayName = 'DingtalkApprovalResultCard';

/** Muted label followed by its value; wraps on long values. */
export const ResultField = memo<{ children: ReactNode; label: ReactNode }>(
  ({ children, label }) => (
    <div className={cardStyles.row}>
      <span className={cardStyles.label}>{label}</span>
      <span className={cardStyles.value}>{children}</span>
    </div>
  ),
);

ResultField.displayName = 'DingtalkApprovalResultField';

interface ResultRowProps {
  meta?: string;
  tag?: string;
  title: string;
}

/** Dense list row: primary title plus secondary meta, truncated on one line. */
export const ResultRow = memo<ResultRowProps>(({ meta, tag, title }) => (
  <div className={cardStyles.row}>
    <span className={cardStyles.rowTitle}>{title}</span>
    {meta && <span className={cardStyles.rowMeta}>{meta}</span>}
    {tag && (
      <Tag className={cardStyles.actionTag} size={'small'}>
        {tag}
      </Tag>
    )}
  </div>
));

ResultRow.displayName = 'DingtalkApprovalResultRow';
