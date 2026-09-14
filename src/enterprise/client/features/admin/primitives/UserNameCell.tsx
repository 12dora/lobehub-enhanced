'use client';

import { Flexbox, Tooltip } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import {
  displayUserLabel,
  displayUserSecondary,
  type UserLabelSource,
  type UserPublicRef,
} from './userLabel';

const styles = createStaticStyles(({ css }) => ({
  name: css`
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  root: css`
    min-width: 0;
    max-width: 100%;
  `,
  secondary: css`
    overflow: hidden;

    min-width: 0;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

export interface UserNameCellProps {
  /** Raw id shown when `user` is null (unknown / deleted). */
  fallbackId?: string | null;
  user: UserPublicRef | null;
}

/**
 * Compact identity cell: primary label, muted secondary, tooltip with the user id.
 * Falls back to `fallbackId` when the resolved ref is missing.
 */
const UserNameCell = memo<UserNameCellProps>(({ user, fallbackId }) => {
  const source: UserLabelSource | null = user ?? (fallbackId ? { id: fallbackId } : null);
  if (!source) {
    return (
      <Text className={styles.name} type="secondary">
        —
      </Text>
    );
  }

  const primary = displayUserLabel(source);
  const secondary = user ? displayUserSecondary(user) : undefined;
  const id = user?.id || fallbackId || source.id;

  return (
    <Tooltip title={id}>
      <Flexbox className={styles.root}>
        <span className={styles.name}>{primary}</span>
        {secondary ? <span className={styles.secondary}>{secondary}</span> : null}
      </Flexbox>
    </Tooltip>
  );
});

UserNameCell.displayName = 'AdminUserNameCell';

export default UserNameCell;
