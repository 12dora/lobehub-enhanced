'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { displayUserLabel } from '../primitives/userLabel';
import UserSearchSelect from '../primitives/UserSearchSelect';

/** Display label for a user row — never the raw email alone. */
export { displayUserLabel as displayStatsUserLabel } from '../primitives/userLabel';

export interface StatsUserFilterSelectProps {
  onChange: (userId: string | undefined, name?: string) => void;
  /** Currently selected user id. */
  value?: string;
  /** Known display name for `value`, so the input is labelled before any search runs. */
  valueLabel?: string;
}

/**
 * User filter for the admin stats page. Clearing the input restores the "all users" default.
 */
const StatsUserFilterSelect = memo<StatsUserFilterSelectProps>(
  ({ onChange, value, valueLabel }) => {
    const { t } = useTranslation('admin');

    return (
      <UserSearchSelect
        allowClear
        placeholder={t('stats.userFilter.allUsers')}
        style={{ maxWidth: 280, minWidth: 220 }}
        userId={value}
        valueLabel={valueLabel}
        onChange={(userId, ref) => {
          if (!userId) {
            onChange(undefined);
            return;
          }
          onChange(userId, ref ? displayUserLabel(ref) : undefined);
        }}
      />
    );
  },
);

StatsUserFilterSelect.displayName = 'StatsUserFilterSelect';

export default StatsUserFilterSelect;
