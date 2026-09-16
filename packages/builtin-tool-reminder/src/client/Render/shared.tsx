'use client';

import { Block, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    display: flex;
    flex-direction: column;
    gap: 8px;

    padding-block: 10px;
    padding-inline: 12px;
  `,
  header: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  label: css`
    flex-shrink: 0;

    min-width: 48px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  row: css`
    display: flex;
    gap: 8px;
    align-items: flex-start;
    min-width: 0;
  `,
  title: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  value: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
  `,
}));

interface ReminderCardProps {
  children?: ReactNode;
  icon?: LucideIcon;
  iconColor?: string;
  title: ReactNode;
}

/** Outlined result card shared by every lobe-reminder render. */
export const ReminderCard = memo<ReminderCardProps>(({ children, icon, iconColor, title }) => (
  <Block variant={'outlined'} width={'100%'}>
    <div className={styles.header}>
      {icon && <Icon icon={icon} size={15} style={iconColor ? { color: iconColor } : undefined} />}
      <Text className={styles.title}>{title}</Text>
    </div>
    {children && <div className={styles.body}>{children}</div>}
  </Block>
));

ReminderCard.displayName = 'ReminderCard';

/** Muted label followed by its value. */
export const ReminderField = memo<{ children: ReactNode; label: ReactNode }>(
  ({ children, label }) => (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <div className={styles.value}>{children}</div>
    </div>
  ),
);

ReminderField.displayName = 'ReminderField';
