'use client';

import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { type ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

import TaskNavMenuButton from './TaskNavMenuButton';

interface TaskListMobileHeaderProps {
  /** Toolbar actions (create, grouping, reminder settings, inbox bell). */
  actions?: ReactNode;
}

/**
 * Mobile chrome for `/tasks`. The task workspace is outside `MOBILE_NAV_ROUTES`,
 * so there is no bottom TabBar here — the hamburger is the only way back to
 * Chat / Community / Me. Renders nothing on desktop.
 *
 * The title sits in the `left` slot (and the `center` slot is collapsed) so the
 * toolbar keeps half the 44px bar instead of a centred third, matching the
 * Community list header.
 */
const TaskListMobileHeader = memo<TaskListMobileHeaderProps>(({ actions }) => {
  const isMobile = useIsMobile();
  const { t } = useTranslation('chat');

  if (!isMobile) return null;

  return (
    <ChatHeader
      data-testid={'task-list-mobile-header'}
      right={actions}
      style={mobileHeaderSticky}
      styles={{ center: { display: 'none' }, left: { minWidth: 0 } }}
      left={
        <Flexbox horizontal align={'center'} gap={4} style={{ minWidth: 0 }}>
          <TaskNavMenuButton />
          <Text ellipsis noWrap fontSize={16} weight={600}>
            {t('taskList.all')}
          </Text>
        </Flexbox>
      }
    />
  );
});

TaskListMobileHeader.displayName = 'TaskListMobileHeader';

export default TaskListMobileHeader;
