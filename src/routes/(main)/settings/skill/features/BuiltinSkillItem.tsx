'use client';

import { Avatar, Flexbox, stopPropagation } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkillEnabledSwitch from '@/features/SkillEnabledSwitch';
import { createBuiltinSkillDetailModal } from '@/features/SkillStore/SkillDetail';
import { usePermission } from '@/hooks/usePermission';
import { useToolStore } from '@/store/tool';
import { builtinToolSelectors } from '@/store/tool/selectors';

import { styles } from './style';

interface BuiltinSkillItemProps {
  avatar?: string;
  identifier: string;
  isSelected?: boolean;
  onSelect?: () => void;
  title: string;
}

const BuiltinSkillItem = memo<BuiltinSkillItemProps>(
  ({ identifier, title, avatar, isSelected, onSelect }) => {
    const { t } = useTranslation('setting');
    const { allowed: canCreate } = usePermission('create_content');
    const { allowed: canEdit } = usePermission('edit_own_content');

    const isEnabled = useToolStore(builtinToolSelectors.isSkillEnabled(identifier, 'builtin'));

    // Disabled rows stay selectable so the tool can be found and switched back
    // on; a subtle tag is the only signal.
    const renderStatus = () =>
      isEnabled ? null : <span className={styles.disconnected}>{t('tools.skillEnabled.off')}</span>;

    if (onSelect) {
      return (
        <NavItem
          active={isSelected}
          icon={() => <Avatar avatar={avatar} size={18} />}
          title={title}
          titleColor={!isEnabled ? cssVar.colorTextDescription : undefined}
          onClick={onSelect}
        />
      );
    }

    return (
      <Flexbox
        horizontal
        align="center"
        className={styles.container}
        gap={8}
        justify="space-between"
        style={{
          ...(isSelected ? { background: 'var(--ant-color-primary-bg)', borderRadius: 6 } : {}),
          ...(onSelect ? { cursor: 'pointer' } : {}),
        }}
        onClick={onSelect}
      >
        <Flexbox horizontal align="center" gap={8} style={{ flex: 1, overflow: 'hidden' }}>
          <Flexbox
            horizontal
            align="center"
            gap={8}
            style={{ cursor: onSelect ? undefined : 'pointer' }}
            onClick={onSelect ? undefined : () => createBuiltinSkillDetailModal({ identifier })}
          >
            <div className={`${styles.icon} ${!isEnabled ? styles.disconnectedIcon : ''}`}>
              <Avatar avatar={avatar} size={16} />
            </div>
            <span className={`${styles.title} ${!isEnabled ? styles.disconnectedTitle : ''}`}>
              {title}
            </span>
          </Flexbox>
          {renderStatus()}
        </Flexbox>
        {!onSelect && (
          <Flexbox horizontal align="center" gap={8} onClick={stopPropagation}>
            <SkillEnabledSwitch
              disabled={isEnabled ? !canEdit : !canCreate}
              identifier={identifier}
              kind="builtin"
            />
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

BuiltinSkillItem.displayName = 'BuiltinSkillItem';

export default BuiltinSkillItem;
