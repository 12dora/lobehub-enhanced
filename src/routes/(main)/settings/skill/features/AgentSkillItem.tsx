'use client';

import { type BuiltinSkill, type SkillListItem } from '@lobechat/types';
import { Avatar, DropdownMenu, Flexbox, Icon, stopPropagation } from '@lobehub/ui';
import { Button, confirmModal, createModal } from '@lobehub/ui/base-ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { Space } from 'antd';
import { cssVar } from 'antd-style';
import { DownloadIcon, MoreHorizontalIcon, Trash2 } from 'lucide-react';
import { lazy, memo, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAdminToolScope } from '@/features/AdminToolScope';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkillEnabledSwitch from '@/features/SkillEnabledSwitch';
import { createBuiltinAgentSkillDetailModal } from '@/features/SkillStore/SkillDetail';
import { usePermission } from '@/hooks/usePermission';
import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';
import { builtinToolSelectors } from '@/store/tool/selectors';
import { downloadFile } from '@/utils/client/downloadFile';

import { styles } from './style';

const AgentSkillDetail = lazy(() => import('@/features/AgentSkillDetail'));
const AgentSkillEdit = lazy(() => import('@/features/AgentSkillEdit'));

const isBuiltinSkill = (skill: BuiltinSkill | SkillListItem): skill is BuiltinSkill =>
  !('id' in skill);

interface AgentSkillItemProps {
  isSelected?: boolean;
  onSelect?: () => void;
  skill: BuiltinSkill | SkillListItem;
}

const AgentSkillItem = memo<AgentSkillItemProps>(({ skill, isSelected, onSelect }) => {
  const { t } = useTranslation('setting');
  const { t: tc } = useTranslation('common');
  const { t: tp } = useTranslation('plugin');
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');

  const isBuiltin = isBuiltinSkill(skill);
  const adminScope = useAdminToolScope();

  const deleteAgentSkill = useToolStore((s) => s.deleteAgentSkill);
  const [storeBuiltinEnabled, storeSkillEnabled] = useToolStore((s) => [
    isBuiltin ? builtinToolSelectors.isSkillEnabled(skill.identifier, 'builtin')(s) : true,
    isBuiltin ? true : builtinToolSelectors.isSkillEnabled(skill.identifier, 'skill')(s),
  ]);
  // Admin org scope: availability reflects the platform catalog and the switch
  // writes the org-wide catalog instead of user settings.
  const isBuiltinEnabled =
    adminScope && isBuiltin
      ? adminScope.isBuiltinSkillEnabled(skill.identifier)
      : storeBuiltinEnabled;
  const isSkillEnabled =
    adminScope && !isBuiltin ? adminScope.isOrgSkillEnabled(skill.identifier) : storeSkillEnabled;
  const isEnabled = isBuiltin ? isBuiltinEnabled : isSkillEnabled;

  const title = isBuiltin
    ? t(`tools.builtins.${skill.identifier}.title`, { defaultValue: skill.name })
    : skill.name;

  const avatar = isBuiltin ? skill.avatar : undefined;

  // ===== Handlers =====

  const handleDownload = async () => {
    if (isBuiltin || !skill.zipFileHash) return;
    setLoading(true);
    try {
      const result = await agentSkillService.getZipUrl(skill.id);
      if (result.url) {
        await downloadFile(result.url, `${result.name || skill.name}.zip`);
      }
    } finally {
      setLoading(false);
    }
  };

  // Bundled builtin skills are never deleted — the switch disables them — so
  // this only ever removes an installed user/market (or org catalog) skill.
  const handleUninstall = () => {
    if (!canEdit || isBuiltin) return;
    confirmModal({
      okButtonProps: { danger: true },
      onOk: async () => {
        setLoading(true);
        try {
          if (adminScope) await adminScope.deleteOrgSkill(skill.id);
          else await deleteAgentSkill(skill.id);
        } finally {
          setLoading(false);
        }
      },
      title: tp('store.actions.confirmUninstall'),
    });
  };

  // ===== Status & Actions =====

  // Disabled rows stay selectable so the skill can be found and switched back
  // on; a subtle tag is the only signal.
  const renderStatus = () =>
    isEnabled ? null : <span className={styles.disconnected}>{t('tools.skillEnabled.off')}</span>;

  const renderEnabledSwitch = () => {
    if (isBuiltin) {
      return (
        <SkillEnabledSwitch
          identifier={skill.identifier}
          kind="builtin"
          label={title}
          disabled={
            adminScope
              ? // Org-wide availability needs catalog rights, not the personal
                // content permissions.
                !adminScope.canSetSkillAvailability(skill.identifier)
              : isBuiltinEnabled
                ? !canEdit
                : !canCreate
          }
          {...(adminScope
            ? {
                checked: isBuiltinEnabled,
                onToggle: (enabled) => adminScope.toggleBuiltinSkill(skill.identifier, enabled),
              }
            : {})}
        />
      );
    }

    // Uploaded org catalog skill: the switch publishes org-wide availability.
    if (adminScope) {
      return (
        <SkillEnabledSwitch
          checked={isSkillEnabled}
          disabled={!adminScope.canSetSkillAvailability(skill.identifier)}
          identifier={skill.identifier}
          kind="skill"
          label={title}
          onToggle={(enabled) => adminScope.setOrgSkillEnabled(skill.identifier, enabled)}
        />
      );
    }

    return (
      <SkillEnabledSwitch
        disabled={!canEdit}
        identifier={skill.identifier}
        kind="skill"
        label={title}
      />
    );
  };

  const renderActions = () => {
    if (isBuiltin) return null;

    return (
      <Space.Compact>
        <Button disabled={!canEdit} onClick={() => setEditOpen(true)}>
          {tp('store.actions.configure')}
        </Button>
        <DropdownMenu
          placement="bottomRight"
          items={[
            ...(skill.zipFileHash
              ? [
                  {
                    icon: <DownloadIcon size={16} />,
                    key: 'download',
                    label: tc('download'),
                    onClick: handleDownload,
                  },
                  { type: 'divider' as const },
                ]
              : []),
            {
              danger: true,
              disabled: !canEdit,
              icon: <Trash2 size={16} />,
              key: 'uninstall',
              label: tp('store.actions.uninstall'),
              onClick: handleUninstall,
            },
          ]}
        >
          <Button disabled={!canEdit} icon={<Icon icon={MoreHorizontalIcon} />} loading={loading} />
        </DropdownMenu>
      </Space.Compact>
    );
  };

  // ===== Detail Modal =====

  const handleOpenDetail = () => {
    if (isBuiltin) {
      createBuiltinAgentSkillDetailModal({ identifier: skill.identifier });
    } else {
      createModal({
        content: (
          <Suspense fallback={<div style={{ height: '100%' }} />}>
            <AgentSkillDetail skillId={skill.id} />
          </Suspense>
        ),
        footer: null,
        styles: { content: { height: 'calc(100dvh - 200px)', overflow: 'hidden', padding: 0 } },
        title: tp('dev.title.skillDetails'),
        width: 960,
      });
    }
  };

  const renderDetailModal = () => {
    if (isBuiltin) return null;
    return (
      <Suspense>
        <AgentSkillEdit open={editOpen} skillId={skill.id} onClose={() => setEditOpen(false)} />
      </Suspense>
    );
  };

  const showDisconnected = !isEnabled;

  if (onSelect) {
    return (
      <NavItem
        active={isSelected}
        title={title}
        titleColor={showDisconnected ? cssVar.colorTextDescription : undefined}
        icon={() =>
          avatar ? <Avatar avatar={avatar} size={18} /> : <Icon icon={SkillsIcon} size={18} />
        }
        onClick={onSelect}
      />
    );
  }

  return (
    <>
      <Flexbox
        horizontal
        align="center"
        className={styles.container}
        gap={16}
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
            onClick={onSelect ? undefined : handleOpenDetail}
          >
            <div className={`${styles.icon} ${showDisconnected ? styles.disconnectedIcon : ''}`}>
              {avatar ? <Avatar avatar={avatar} size={16} /> : <Icon icon={SkillsIcon} size={16} />}
            </div>
            <span className={`${styles.title} ${showDisconnected ? styles.disconnectedTitle : ''}`}>
              {title}
            </span>
          </Flexbox>
          {showDisconnected && renderStatus()}
        </Flexbox>
        {!onSelect && (
          <Flexbox horizontal align="center" gap={8} onClick={stopPropagation}>
            {renderActions()}
            {renderEnabledSwitch()}
          </Flexbox>
        )}
      </Flexbox>
      {!onSelect && renderDetailModal()}
    </>
  );
});

AgentSkillItem.displayName = 'AgentSkillItem';

export default AgentSkillItem;
