'use client';

import { ActionIcon, Drawer } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { Compass, MenuIcon, MessageSquare, SquareCheckBig, User } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Menu from '@/components/Menu';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

interface NavEntry {
  escape?: boolean;
  icon: typeof MenuIcon;
  key: string;
  label: string;
  to: string;
}

/**
 * The task workspace is not part of `MOBILE_NAV_ROUTES`, so the bottom TabBar
 * never renders there and the mobile shell offers no way back to the rest of the
 * app. This hamburger mirrors the TabBar entries in a left Drawer, matching the
 * Community list pattern (`(mobile)/community/(list)/_layout/Nav.tsx`).
 */
const TaskNavMenuButton = memo(() => {
  const { t } = useTranslation(['common', 'chat']);
  const [open, setOpen] = useState(false);
  const navigate = useWorkspaceAwareNavigate();
  const { showMarket } = useServerConfigStore(featureFlagsSelectors);

  const entries = useMemo<NavEntry[]>(
    () =>
      [
        { icon: MessageSquare, key: 'chat', label: t('tab.chat'), to: '/agent' },
        { icon: SquareCheckBig, key: 'tasks', label: t('tab.tasks'), to: '/tasks' },
        showMarket && {
          icon: Compass,
          key: 'community',
          label: t('tab.community'),
          to: '/community',
        },
        { escape: true, icon: User, key: 'me', label: t('tab.me'), to: '/me' },
      ].filter(Boolean) as NavEntry[],
    [showMarket, t],
  );

  return (
    <>
      <ActionIcon
        icon={MenuIcon}
        size={{ blockSize: 32, size: 18 }}
        title={t('taskList.mobileNav.menu', { ns: 'chat' })}
        onClick={() => setOpen(true)}
      />
      <Drawer
        noHeader
        open={open}
        placement={'left'}
        width={260}
        zIndex={110}
        styles={{
          bodyContent: { padding: 16 },
          panel: { background: cssVar.colorBgLayout },
        }}
        onClose={() => setOpen(false)}
      >
        <Menu
          compact
          selectable
          selectedKeys={['tasks']}
          items={entries.map(({ icon: EntryIcon, key, label }) => ({
            icon: <EntryIcon size={16} />,
            key,
            label,
          }))}
          onClick={({ key }) => {
            const entry = entries.find((item) => item.key === key);
            setOpen(false);
            if (!entry) return;
            navigate(entry.to, entry.escape ? { escape: true } : undefined);
          }}
        />
      </Drawer>
    </>
  );
});

TaskNavMenuButton.displayName = 'TaskNavMenuButton';

export default TaskNavMenuButton;
