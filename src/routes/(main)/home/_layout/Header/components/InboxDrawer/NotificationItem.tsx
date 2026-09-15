'use client';

import { ActionIcon, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { Tag } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import {
  ArchiveIcon,
  BellIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  ImageIcon,
  ListChecksIcon,
  MegaphoneIcon,
  VideoIcon,
} from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import {
  TASK_NOTIFICATION_CATEGORY,
  TASK_NOTIFICATION_TYPES,
  type TaskNotificationType,
} from '@/types/user/settings';

import { createNotificationDetailModal } from './NotificationDetailModal';

const ACTION_CLASS_NAME = 'notification-item-actions';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    cursor: pointer;
    user-select: none;

    .${ACTION_CLASS_NAME} {
      opacity: 0;
      transition: opacity 0.2s ${cssVar.motionEaseOut};
    }

    &:hover {
      .${ACTION_CLASS_NAME} {
        opacity: 1;
      }
    }
  `,
  unreadDot: css`
    flex-shrink: 0;

    width: 8px;
    height: 8px;
    border-radius: 50%;

    background: ${cssVar.colorPrimary};
  `,
}));

const TYPE_ICON_MAP: Record<string, typeof BellIcon> = {
  image_generation_completed: ImageIcon,
  system_announcement: MegaphoneIcon,
  task_completed: ListChecksIcon,
  task_run_completed: CircleCheckIcon,
  task_run_failed: CircleAlertIcon,
  task_waiting_for_user: CircleHelpIcon,
  video_generation_completed: VideoIcon,
};

const TASK_TYPES = new Set<string>(TASK_NOTIFICATION_TYPES);

/**
 * Task rows all carry the task name as their title, so the event kind has to be a
 * chip — without it "每日晨报" reads the same whether the run finished or failed.
 */
const isTaskNotificationType = (
  category: string | undefined,
  type: string,
): type is TaskNotificationType => category === TASK_NOTIFICATION_CATEGORY && TASK_TYPES.has(type);

const TASK_TAG_COLOR: Record<TaskNotificationType, 'success' | 'error' | 'warning' | undefined> = {
  task_completed: 'success',
  task_run_completed: undefined,
  task_run_failed: 'error',
  task_waiting_for_user: 'warning',
};

interface NotificationItemProps {
  actionUrl?: string | null;
  category?: string;
  content: string;
  createdAt: Date | string;
  id: string;
  isRead: boolean;
  onArchive: (id: string) => void;
  onMarkAsRead: (id: string) => void;
  title: string;
  type: string;
}

const NotificationItem = memo<NotificationItemProps>(
  ({
    id,
    type,
    title,
    content,
    category,
    createdAt,
    isRead,
    actionUrl,
    onMarkAsRead,
    onArchive,
  }) => {
    const navigate = useWorkspaceAwareNavigate();
    const { t } = useTranslation('notification');
    const TypeIcon = TYPE_ICON_MAP[type] || BellIcon;
    const taskType = isTaskNotificationType(category, type) ? type : undefined;

    const handleClick = useCallback(() => {
      if (!isRead) onMarkAsRead(id);
      const onAction = actionUrl
        ? () => {
            if (/^https?:\/\//i.test(actionUrl)) {
              window.open(actionUrl, '_blank', 'noopener,noreferrer');
            } else {
              navigate(actionUrl);
            }
          }
        : undefined;
      createNotificationDetailModal({
        category,
        content,
        createdAt,
        onAction,
        title,
      });
    }, [id, isRead, actionUrl, onMarkAsRead, navigate, category, content, createdAt, title]);

    const handleArchive = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onArchive(id);
      },
      [id, onArchive],
    );

    return (
      <Block
        clickable
        className={styles.container}
        gap={4}
        paddingBlock={8}
        paddingInline={12}
        variant="borderless"
        onClick={handleClick}
      >
        <Flexbox horizontal align="flex-start" gap={8}>
          <Icon
            color={cssVar.colorTextDescription}
            icon={TypeIcon}
            size={18}
            style={{ flexShrink: 0, marginTop: 2 }}
          />
          <Flexbox flex={1} gap={4} style={{ overflow: 'hidden' }}>
            <Flexbox horizontal align="center" gap={4} justify="space-between">
              <Flexbox horizontal align="center" flex={1} gap={6} style={{ overflow: 'hidden' }}>
                {!isRead && <span className={styles.unreadDot} />}
                {taskType && (
                  <Tag color={TASK_TAG_COLOR[taskType]} size={'small'} style={{ flexShrink: 0 }}>
                    {t(`task.event.${taskType}` as never)}
                  </Tag>
                )}
                <Text
                  ellipsis={{ tooltipWhenOverflow: true }}
                  style={{ fontWeight: isRead ? 400 : 600 }}
                >
                  {title}
                </Text>
              </Flexbox>
              <Flexbox horizontal align="center" gap={2} style={{ flexShrink: 0 }}>
                <span className={ACTION_CLASS_NAME}>
                  <ActionIcon
                    icon={ArchiveIcon}
                    size={{ blockSize: 24, size: 14 }}
                    onClick={handleArchive}
                  />
                </span>
                <Text fontSize={12} style={{ flexShrink: 0 }} type="secondary">
                  {dayjs(createdAt).fromNow()}
                </Text>
              </Flexbox>
            </Flexbox>
            <Text ellipsis={{ rows: 3 }} fontSize={12} type="secondary">
              {content}
            </Text>
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

export default NotificationItem;
