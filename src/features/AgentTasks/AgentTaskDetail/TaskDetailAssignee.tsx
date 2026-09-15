import type { TaskStatus } from '@lobechat/types';
import { Block, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { cssVar, useThemeMode } from 'antd-style';
import { UserCircle2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import HeterogeneousTag from '@/features/HeterogeneousTag';
import { useScopedDefaultInboxDisplayName } from '@/hooks/useDefaultInboxDisplayName';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import AssigneeAgentSelector from '../features/AssigneeAgentSelector';
import AssigneeAvatar from '../features/AssigneeAvatar';
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';

const LABEL_STYLE = { minWidth: 0, whiteSpace: 'nowrap' } as const;

const TaskDetailAssignee = memo(() => {
  const { t } = useTranslation('chat');
  const inboxName = useScopedDefaultInboxDisplayName();
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const status = useTaskStore(taskDetailSelectors.activeTaskStatus) as TaskStatus | undefined;
  const assigneeAgentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const assigneeMeta = useAgentDisplayMeta(assigneeAgentId);
  // Same source as the home list so the runtime tag stays consistent.
  const assigneeHeterogeneousType = useHomeStore(
    (s) => homeAgentListSelectors.getAgentById(assigneeAgentId ?? '')(s)?.heterogeneousType,
  );
  const { isDarkMode } = useThemeMode();

  if (!taskId) return null;

  return (
    <AssigneeAgentSelector
      currentAgentId={assigneeAgentId}
      disabled={status === 'running'}
      taskIdentifier={taskId}
    >
      <Tooltip
        title={assigneeAgentId ? undefined : t('taskList.unassignedHint', { name: inboxName })}
      >
        <Block
          clickable
          horizontal
          align="center"
          gap={8}
          paddingBlock={4}
          paddingInline={11}
          style={{ maxWidth: '100%', minHeight: 32, minWidth: 0 }}
          variant={isDarkMode ? 'filled' : 'outlined'}
        >
          {assigneeAgentId ? (
            <>
              <Flexbox flex={'none'}>
                <AssigneeAvatar agentId={assigneeAgentId} size={20} />
              </Flexbox>
              {/* Narrow viewports (DingTalk in-app browser, ~390px) squeeze this
                  chip hardest, and CJK labels have no break opportunity — pin the
                  label to one line and ellipsis it instead of wrapping per glyph. */}
              <Text ellipsis style={LABEL_STYLE} weight={500}>
                {assigneeMeta?.title}
              </Text>
              <HeterogeneousTag type={assigneeHeterogeneousType} />
            </>
          ) : (
            <>
              <Icon color={cssVar.colorTextDescription} icon={UserCircle2} size={18} />
              <Text
                ellipsis
                style={{ ...LABEL_STYLE, color: cssVar.colorTextDescription }}
                weight={500}
              >
                {t('taskList.unassigned')}
              </Text>
            </>
          )}
        </Block>
      </Tooltip>
    </AssigneeAgentSelector>
  );
});

export default TaskDetailAssignee;
