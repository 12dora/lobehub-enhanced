'use client';

import { Avatar, Block, Flexbox, stopPropagation } from '@lobehub/ui';
import { Tag } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAdminToolScope } from '@/features/AdminToolScope';
import SkillEnabledSwitch from '@/features/SkillEnabledSwitch';
import { usePermission } from '@/hooks/usePermission';
import { useToolStore } from '@/store/tool';
import { builtinToolSelectors } from '@/store/tool/selectors';

import { itemStyles } from '../style';

interface ItemProps {
  avatar?: string;
  description?: string;
  identifier: string;
  onOpenDetail?: () => void;
  title?: string;
}

const Item = memo<ItemProps>(({ avatar, description, identifier, onOpenDetail, title }) => {
  const { t } = useTranslation(['setting', 'plugin', 'common']);
  const styles = itemStyles;
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');

  // Admin org scope: the switch writes org-wide availability instead of the
  // signed-in user's settings.
  const adminScope = useAdminToolScope();

  const [setSkillEnabled, isUserEnabled] = useToolStore((s) => [
    s.setSkillEnabled,
    builtinToolSelectors.isSkillEnabled(identifier, 'builtin')(s),
  ]);

  const enabled = adminScope ? adminScope.isBuiltinSkillEnabled(identifier) : isUserEnabled;
  // Enabling matches install (create), disabling matches uninstall (edit).
  const canToggle = adminScope
    ? adminScope.canSetBuiltinSkillDistribution(identifier)
    : enabled
      ? canEdit
      : canCreate;

  const handleToggle = async (next: boolean) => {
    if (!canToggle) return;
    if (adminScope) {
      await adminScope.toggleBuiltinSkill(identifier, next);
      return;
    }
    await setSkillEnabled({ enabled: next, identifier, kind: 'builtin' });
  };

  return (
    <Block
      horizontal
      align={'center'}
      className={styles.container}
      gap={12}
      paddingBlock={12}
      paddingInline={12}
      style={{ cursor: 'pointer' }}
      variant={'outlined'}
      onClick={onOpenDetail}
    >
      <Avatar avatar={avatar} size={40} style={{ marginInlineEnd: 0 }} />
      <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
        <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
          <span className={styles.title}>{title || identifier}</span>
          {!enabled && <Tag size={'small'}>{t('tools.skillEnabled.off')}</Tag>}
        </Flexbox>
        {description && <span className={styles.description}>{description}</span>}
      </Flexbox>
      <div onClick={stopPropagation}>
        <SkillEnabledSwitch
          checked={enabled}
          disabled={!canToggle}
          identifier={identifier}
          kind={'builtin'}
          onToggle={handleToggle}
        />
      </div>
    </Block>
  );
});

Item.displayName = 'BuiltinListItem';

export default Item;
