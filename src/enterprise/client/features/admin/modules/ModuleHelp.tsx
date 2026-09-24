'use client';

import { Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleHelp } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  help: css`
    cursor: help;

    display: inline-flex;
    align-items: center;

    margin-inline-start: 4px;
    padding: 0;
    border: none;

    color: ${cssVar.colorTextTertiary};
    vertical-align: middle;

    background: none;

    &:hover,
    &:focus-visible {
      color: ${cssVar.colorTextSecondary};
    }
  `,
}));

export interface ModuleHelpProps {
  /** What the guidance is about — names the button for assistive technology. */
  field: string;
  title: ReactNode;
}

/**
 * The "?" beside a label whose explanation is too long to sit inline. A real button, so the
 * guidance is not pointer-only: Tab reaches it, focus opens the tooltip, blur closes it — the
 * same affordance as the infrastructure field hints.
 */
const ModuleHelp = memo<ModuleHelpProps>(({ field, title }) => {
  const { t } = useTranslation('admin');
  const [open, setOpen] = useState(false);

  return (
    <Tooltip open={open} title={title} onOpenChange={setOpen}>
      <button
        aria-label={t('modules.helpFor', { field })}
        className={styles.help}
        type="button"
        onBlur={() => setOpen(false)}
        onFocus={() => setOpen(true)}
      >
        <Icon icon={CircleHelp} size={14} />
      </button>
    </Tooltip>
  );
});

ModuleHelp.displayName = 'AdminModuleHelp';

export default ModuleHelp;
