'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';

import { InfraHelpButton } from '@/enterprise/client/features/admin/systemGeneral/infra/InfraField';

const styles = createStaticStyles(({ css }) => ({
  header: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    min-width: 0;
  `,
  title: css`
    margin: 0;
    font-size: ${cssVar.fontSizeLG};
    font-weight: ${cssVar.fontWeightStrong};
  `,
}));

export interface SectionHeaderProps {
  /** Right-aligned section actions (e.g. 清除). */
  actions?: ReactNode;
  /**
   * Short guidance shown in a "?" tooltip next to the title — replaces the secondary paragraphs
   * that used to sit under every section heading.
   */
  help?: ReactNode;
  icon?: LucideIcon;
  title: string;
}

/** One heading row for every 状态监控 section: icon, title, optional "?" tip, actions. */
export const SectionHeader = memo<SectionHeaderProps>(({ actions, help, icon, title }) => (
  <div className={styles.header}>
    <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
      {icon ? <Icon icon={icon} size={18} /> : null}
      <Text as="h2" className={styles.title}>
        {title}
      </Text>
      {help ? <InfraHelpButton hint={help} label={title} /> : null}
    </Flexbox>
    {actions ? (
      <Flexbox horizontal align="center" gap={8}>
        {actions}
      </Flexbox>
    ) : null}
  </div>
));

SectionHeader.displayName = 'AdminSystemSectionHeader';
