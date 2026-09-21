'use client';

import { Avatar, Flexbox, stopPropagation } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAdminToolScope } from '@/features/AdminToolScope';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkillEnabledSwitch from '@/features/SkillEnabledSwitch';
import { createBuiltinSkillDetailModal } from '@/features/SkillStore/SkillDetail';
import { usePermission } from '@/hooks/usePermission';
import { useToolStore } from '@/store/tool';
import { builtinToolSelectors } from '@/store/tool/selectors';

import { isPlatformManagedBuiltinTool } from './builtinToolVisibility';
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
    const adminScope = useAdminToolScope();

    // Administrator-governed tools ignore the per-user list at runtime: the tools
    // engine keys them on the deployment capability flag, so while they are
    // listed here they are genuinely active. Showing them as "off" with a switch
    // would contradict what happens in chat.
    const platformManaged = isPlatformManagedBuiltinTool(identifier);
    const storeEnabled = useToolStore(builtinToolSelectors.isSkillEnabled(identifier, 'builtin'));
    const isEnabled = platformManaged || storeEnabled;

    // Disabled rows stay selectable so the tool can be found and switched back
    // on; a subtle tag is the only signal.
    const renderStatus = () => {
      if (platformManaged)
        return (
          <span className={styles.managedNote}>{t('tools.skillEnabled.platformManaged')}</span>
        );
      return isEnabled ? null : (
        <span className={styles.disconnected}>{t('tools.skillEnabled.off')}</span>
      );
    };

    // Every builtin tool is listed, installed or not, so the row itself has to
    // carry the enable control — otherwise a tool that defaults to uninstalled
    // could be found but never switched on. Always visible (not hover-only) so
    // the on/off state of a long list is readable at a glance.
    // Admin org scope: this switch writes the signed-in user's own setting, so
    // the org catalog row shows no personal control.
    const renderNavExtra = () => {
      if (adminScope) return null;
      // Nothing for the user to operate — say who owns the decision instead.
      if (platformManaged)
        return (
          <span className={styles.managedNote}>{t('tools.skillEnabled.platformManaged')}</span>
        );
      return (
        <SkillEnabledSwitch
          disabled={isEnabled ? !canEdit : !canCreate}
          identifier={identifier}
          kind="builtin"
          label={title}
        />
      );
    };

    if (onSelect) {
      return (
        <NavItem
          active={isSelected}
          extra={renderNavExtra()}
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
        {!onSelect && !platformManaged && (
          <Flexbox horizontal align="center" gap={8} onClick={stopPropagation}>
            <SkillEnabledSwitch
              disabled={isEnabled ? !canEdit : !canCreate}
              identifier={identifier}
              kind="builtin"
              label={title}
            />
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

BuiltinSkillItem.displayName = 'BuiltinSkillItem';

export default BuiltinSkillItem;
