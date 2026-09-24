'use client';

import { Icon } from '@lobehub/ui';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { memo, type ReactNode, useId, useState } from 'react';

import { InfraHelpButton } from '../infra/InfraField';
import { imConnectorStyles as styles } from './styles';

export interface ConnectorSectionProps {
  children?: ReactNode;
  /** Right side of the title row: the group's own action (测试, 检查权限) or a link. */
  extra?: ReactNode;
  /** What the group is for, behind a "?" beside the title — never an inline paragraph. */
  help?: string;
  title: string;
}

/**
 * One titled group of the connector card.
 *
 * Every group has the same header — title, an optional "?", an optional action on the right — so
 * the card reads as a list of short, same-shaped blocks instead of one long form.
 */
export const ConnectorSection = memo<ConnectorSectionProps>(({ children, extra, help, title }) => {
  const titleId = `im-connector-section-${useId()}`;

  return (
    <section aria-labelledby={titleId} className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitleRow}>
          <h3 className={styles.sectionTitle} id={titleId}>
            {title}
          </h3>
          {help ? <InfraHelpButton hint={help} label={title} /> : null}
        </div>
        {extra ? <div className={styles.sectionExtra}>{extra}</div> : null}
      </div>
      {children}
    </section>
  );
});

ConnectorSection.displayName = 'AdminImConnectorSection';

export interface CollapsibleConnectorSectionProps {
  /** Mounted only while open, so a reading nobody asked for is never requested. */
  children: ReactNode;
  help?: string;
  title: string;
}

/**
 * A group whose title folds it (接口调用量). Closed by default: the readings are consulted, not
 * configured, and they should not make the card longer than its settings.
 */
export const CollapsibleConnectorSection = memo<CollapsibleConnectorSectionProps>(
  ({ children, help, title }) => {
    const [open, setOpen] = useState(false);
    const bodyId = `im-connector-collapsible-${useId()}`;

    return (
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitleRow}>
            <h3 className={styles.sectionTitle}>
              <button
                aria-controls={open ? bodyId : undefined}
                aria-expanded={open}
                className={styles.sectionToggle}
                type="button"
                onClick={() => setOpen((current) => !current)}
              >
                <Icon icon={open ? ChevronDown : ChevronRight} size={14} />
                {title}
              </button>
            </h3>
            {help ? <InfraHelpButton hint={help} label={title} /> : null}
          </div>
        </div>
        {open ? <div id={bodyId}>{children}</div> : null}
      </section>
    );
  },
);

CollapsibleConnectorSection.displayName = 'AdminImConnectorCollapsibleSection';
