'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { SearchIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SearchDirectoryParams, SearchDirectoryState } from '../../../types';
import { ReminderCard, ReminderField } from '../shared';

/**
 * `searchDirectory` result: the matched people (`姓名 · 最小部门路径`) and
 * departments (`部门 · N 人`). Same-name hits are called out so the model —
 * and the user reading along — resolves the ambiguity before creating.
 */
export const SearchDirectoryRender = memo<
  BuiltinRenderProps<SearchDirectoryParams, SearchDirectoryState>
>(({ pluginState }) => {
  const { t } = useTranslation('plugin');

  if (!pluginState) return null;

  const users = pluginState.hits?.users ?? [];
  const departments = pluginState.hits?.departments ?? [];
  const isEmpty = users.length === 0 && departments.length === 0;

  return (
    <ReminderCard icon={SearchIcon} title={t('builtins.lobe-reminder.render.search.title')}>
      {pluginState.ambiguous && (
        <Text fontSize={12} style={{ color: cssVar.colorWarning }}>
          {t('builtins.lobe-reminder.render.search.ambiguous')}
        </Text>
      )}
      {isEmpty && (
        <Text fontSize={13} style={{ color: cssVar.colorTextTertiary }}>
          {t('builtins.lobe-reminder.render.search.empty')}
        </Text>
      )}
      {users.length > 0 && (
        <ReminderField label={t('builtins.lobe-reminder.render.search.users')}>
          {users.map((user) => (
            <Text fontSize={13} key={user.staffId}>
              {user.deptPath || user.leafDeptName
                ? `${user.name} · ${user.deptPath || user.leafDeptName}`
                : user.name}
            </Text>
          ))}
        </ReminderField>
      )}
      {departments.length > 0 && (
        <ReminderField label={t('builtins.lobe-reminder.render.search.departments')}>
          {departments.map((dept) => (
            <Text fontSize={13} key={dept.deptId}>
              {t('builtins.lobe-reminder.render.department', {
                count: dept.memberCount ?? 0,
                name: dept.pathNames || dept.name,
              })}
            </Text>
          ))}
        </ReminderField>
      )}
    </ReminderCard>
  );
});

SearchDirectoryRender.displayName = 'SearchDirectoryRender';

export default SearchDirectoryRender;
