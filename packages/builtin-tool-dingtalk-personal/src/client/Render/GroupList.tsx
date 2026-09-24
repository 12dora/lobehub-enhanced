'use client';

import { Users } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { GroupsState } from '../../types';
import { RESULT_VISIBLE_ROW_LIMIT } from '../components/constants';
import { ExpandableList, ResultCard, ResultNote } from '../components/ResultCard';
import { cardStyles } from '../components/styles';
import { asRows, asText } from './format';

type GroupView = GroupsState['groups'][number];

/** `searchGroups` / `listMyGroups` result: group names with their member count. */
const GroupList = memo<{ state: GroupsState; title: string }>(({ state, title }) => {
  const { t } = useTranslation('plugin');
  const groups = asRows<GroupView>(state.groups);

  return (
    <ResultCard
      icon={Users}
      title={title}
      meta={
        groups.length > 0
          ? t('builtins.lobe-dingtalk-personal.render.count', { count: groups.length })
          : undefined
      }
    >
      {groups.length === 0 ? (
        <ResultNote>{t('builtins.lobe-dingtalk-personal.render.group.empty')}</ResultNote>
      ) : (
        <ExpandableList
          items={groups}
          limit={RESULT_VISIBLE_ROW_LIMIT}
          renderItem={(group, index) => (
            <div className={cardStyles.row} key={group.conversationId ?? String(index)}>
              <span className={cardStyles.rowTitle}>
                {asText(group.name) ?? t('builtins.lobe-dingtalk-personal.render.unnamed.group')}
              </span>
              {typeof group.memberCount === 'number' && group.memberCount > 0 && (
                <span className={cardStyles.rowMeta}>
                  {t('builtins.lobe-dingtalk-personal.render.group.members', {
                    count: group.memberCount,
                  })}
                </span>
              )}
            </div>
          )}
        />
      )}
      {state.hasMore === true && (
        <ResultNote>{t('builtins.lobe-dingtalk-personal.render.hasMore')}</ResultNote>
      )}
    </ResultCard>
  );
});

GroupList.displayName = 'DingtalkPersonalGroupList';

export default GroupList;
