'use client';

import { Tag, Text } from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { displayUserLabel } from '../../primitives/userLabel';
import UserSearchSelect from '../../primitives/UserSearchSelect';
import { moderationStyles as styles } from '../styles';

export interface ExemptUserPickerProps {
  disabled?: boolean;
  /** Whether the current admin may call `admin.users.search`. */
  enabled: boolean;
  onChange: (userIds: string[]) => void;
  value: readonly string[];
}

/**
 * Exempt-user picker backed by `admin.users.search`.
 *
 * A moderation admin does not necessarily hold USER_READ, so when the search is unavailable
 * the control still accepts an explicit pasted user id via `allowRawId`.
 */
const ExemptUserPicker = memo<ExemptUserPickerProps>(({ disabled, enabled, onChange, value }) => {
  const { t } = useTranslation('admin');
  const [labels, setLabels] = useState<Record<string, string>>({});

  const add = (userId: string, label?: string) => {
    const trimmed = userId.trim();
    if (!trimmed || value.includes(trimmed)) return;
    if (label) setLabels((prev) => ({ ...prev, [trimmed]: label }));
    onChange([...value, trimmed]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <UserSearchSelect
        allowRawId
        disabled={disabled}
        enabled={enabled}
        placeholder={t('contentModeration.settings.scope.userSearchPlaceholder')}
        style={{ width: 320 }}
        userId={undefined}
        onChange={(userId, ref) => {
          if (!userId) return;
          add(userId, ref ? displayUserLabel(ref) : userId);
        }}
      />
      {!enabled ? (
        <Text className={styles.hintText}>
          {t('contentModeration.settings.scope.userSearchNoPermission')}
        </Text>
      ) : null}
      <div className={styles.formRow}>
        {value.length === 0 ? (
          <Text className={styles.hintText}>
            {t('contentModeration.settings.scope.noExemptUsers')}
          </Text>
        ) : (
          value.map((userId) => (
            <Tag
              closable={!disabled}
              key={userId}
              onClose={() => onChange(value.filter((item) => item !== userId))}
            >
              {labels[userId] ?? userId}
            </Tag>
          ))
        )}
      </div>
    </div>
  );
});

ExemptUserPicker.displayName = 'ModerationExemptUserPicker';

export default ExemptUserPicker;
