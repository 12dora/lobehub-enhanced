'use client';

import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { Tag } from '@lobehub/ui/base-ui';
import { TriangleAlert } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { displayUserLabel } from '@/enterprise/client/features/admin/primitives/userLabel';
import UserSearchSelect from '@/enterprise/client/features/admin/primitives/UserSearchSelect';

import { ALERT_LIMITS, type AlertRecipientUser, storedUsers } from './draft';
import { alertSettingsStyles as styles } from './styles';

export interface RecipientUsersFieldProps {
  disabled: boolean;
  labelId: string;
  onChange: (users: AlertRecipientUser[]) => void;
  users: AlertRecipientUser[];
}

/**
 * Picked users as removable tags; the search box adds one user at a time.
 *
 * A stored id the server no longer resolves is shown as 「已删除的用户」 so it can be removed — it is
 * never sent back. A disabled account carries 「已停用」 (kept, but alerts skip it); an account
 * without a bound DingTalk identity carries a warning icon: work notices cannot reach it.
 */
export const RecipientUsersField = memo<RecipientUsersFieldProps>(
  ({ disabled, labelId, onChange, users }) => {
    const { t } = useTranslation('admin');
    // Remount the picker after each pick so its input is empty for the next search.
    const [pickerKey, setPickerKey] = useState(0);
    const atLimit = storedUsers(users).length >= ALERT_LIMITS.USER_IDS_MAX;

    return (
      <Flexbox gap={8}>
        {users.length > 0 ? (
          <div aria-labelledby={labelId} className={styles.userTags} role="list">
            {users.map((user) => (
              <span
                data-banned={user.banned ? 'true' : undefined}
                data-missing={user.missing ? 'true' : undefined}
                data-testid="alert-recipient-user"
                key={user.id}
                role="listitem"
                title={user.missing ? user.id : undefined}
              >
                <Tag
                  closable={!disabled}
                  icon={
                    !user.missing && !user.banned && user.dingtalkBound === false ? (
                      <Tooltip title={t('system.alerts.recipients.unbound')}>
                        <span
                          aria-label={t('system.alerts.recipients.unbound')}
                          className={styles.unbound}
                          data-testid="alert-recipient-unbound"
                          role="img"
                        >
                          <Icon icon={TriangleAlert} size={12} />
                        </span>
                      </Tooltip>
                    ) : undefined
                  }
                  onClose={() => onChange(users.filter((entry) => entry.id !== user.id))}
                >
                  {user.missing ? (
                    <span className={styles.missingUser}>
                      {t('system.alerts.recipients.deleted')}
                    </span>
                  ) : (
                    user.name
                  )}
                  {user.banned && !user.missing ? (
                    <Tooltip title={t('system.alerts.recipients.bannedHelp')}>
                      <span className={styles.bannedBadge} data-testid="alert-recipient-banned">
                        {t('system.alerts.recipients.banned')}
                      </span>
                    </Tooltip>
                  ) : null}
                </Tag>
              </span>
            ))}
          </div>
        ) : null}
        {disabled || atLimit ? null : (
          <UserSearchSelect
            aria-label={t('system.alerts.recipients.addUser')}
            key={pickerKey}
            placeholder={t('system.alerts.recipients.addUser')}
            onChange={(userId, ref) => {
              if (!userId) return;
              if (!users.some((entry) => entry.id === userId && !entry.missing)) {
                const name = ref ? displayUserLabel(ref) : userId;
                onChange([
                  ...users.filter((entry) => entry.id !== userId),
                  { dingtalkBound: null, id: userId, name },
                ]);
              }
              setPickerKey((key) => key + 1);
            }}
          />
        )}
      </Flexbox>
    );
  },
);

RecipientUsersField.displayName = 'AdminSystemAlertRecipientUsers';
