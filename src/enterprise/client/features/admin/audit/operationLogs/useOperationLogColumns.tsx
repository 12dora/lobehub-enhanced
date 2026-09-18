import { Tooltip } from '@lobehub/ui/base-ui';
import { type TableColumnsType } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { UserIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AdminAuditEventListItem } from '@/enterprise/client/services/adminAudit';

import { enumColumnFilter, searchColumnFilter } from '../../primitives/columnFilters';
import UserNameCell from '../../primitives/UserNameCell';
import AuditStatusTag from '../shared/AuditStatusTag';
import {
  auditActionLabel,
  auditReasonLabel,
  auditTargetDisplay,
  formatAdminDateTime,
  truncateText,
} from '../shared/format';
import { ActorFilterDropdown } from './ActorFilterDropdown';
import type { ListFilters } from './listFilters';
import { TargetFilterDropdown } from './TargetFilterDropdown';

const styles = createStaticStyles(({ css }) => ({
  filterIcon: css`
    display: inline-flex;
    color: ${cssVar.colorTextTertiary};
  `,
  filterIconActive: css`
    display: inline-flex;
    color: ${cssVar.colorPrimary};
  `,
  targetCell: css`
    overflow: hidden;
    display: block;

    width: 100%;
    min-width: 0;

    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  targetTooltip: css`
    word-break: break-all;
    white-space: pre-line;
  `,
}));

export const useOperationLogColumns = ({
  actionOptions,
  applyFilters,
  canRead,
  filters,
  resultOptions,
}: {
  actionOptions: { label: string; value: string }[];
  applyFilters: (patch: Partial<ListFilters>) => void;
  canRead: boolean;
  filters: ListFilters;
  resultOptions: { label: string; value: string }[];
}): TableColumnsType<AdminAuditEventListItem> => {
  const { t } = useTranslation('admin');

  return useMemo(
    () => [
      {
        dataIndex: 'createdAt',
        key: 'createdAt',
        title: t('audit.logs.columns.time'),
        width: 170,
        render: (value: Date) => formatAdminDateTime(value),
      },
      {
        dataIndex: 'action',
        key: 'action',
        ellipsis: true,
        title: t('audit.logs.columns.action'),
        ...enumColumnFilter({
          multiple: true,
          options: actionOptions,
          value: filters.actions,
        }),
        render: (value: string) => auditActionLabel(t, value),
      },
      {
        dataIndex: 'actorUserId',
        key: 'actorUserId',
        title: t('audit.logs.columns.actor'),
        width: 140,
        filterDropdown: (dropdownProps) => (
          <ActorFilterDropdown
            {...dropdownProps}
            enabled={canRead}
            value={filters.actorUserId}
            onChange={(userId) => applyFilters({ actorUserId: userId })}
          />
        ),
        filterIcon: (filtered) => (
          <span
            className={
              filtered || filters.actorUserId ? styles.filterIconActive : styles.filterIcon
            }
          >
            <UserIcon size={14} />
          </span>
        ),
        filterOnClose: false,
        filteredValue: filters.actorUserId ? [filters.actorUserId] : null,
        render: (_value: string | null, row: AdminAuditEventListItem) => (
          <UserNameCell fallbackId={row.actorUserId} user={row.actorUser} />
        ),
      },
      {
        dataIndex: 'result',
        key: 'result',
        title: t('audit.logs.columns.result'),
        width: 110,
        ...enumColumnFilter({
          multiple: true,
          options: resultOptions,
          value: filters.results,
        }),
        render: (value: string) => <AuditStatusTag kind="result" value={value} />,
      },
      {
        key: 'target',
        // The cell renders its own tooltip (full text + raw id); suppress antd's `title`.
        ellipsis: { showTitle: false },
        title: t('audit.logs.columns.target'),
        width: 280,
        filterDropdown: (dropdownProps) => (
          <TargetFilterDropdown
            {...dropdownProps}
            targetId={filters.targetId}
            targetType={filters.targetType}
            onApply={(next) => applyFilters(next)}
          />
        ),
        filterOnClose: false,
        filteredValue:
          filters.targetType || filters.targetId
            ? [filters.targetType ?? '', filters.targetId ?? '']
            : null,
        render: (_, row) => {
          const target = auditTargetDisplay(t, row);
          return (
            <Tooltip
              placement="topLeft"
              title={<span className={styles.targetTooltip}>{target.tooltip}</span>}
            >
              <span className={styles.targetCell} data-testid="audit-target-cell">
                {target.text}
              </span>
            </Tooltip>
          );
        },
      },
      {
        dataIndex: 'requestId',
        key: 'requestId',
        title: t('audit.logs.columns.requestId'),
        width: 160,
        ellipsis: true,
        ...searchColumnFilter({
          placeholder: t('audit.logs.filters.requestId'),
          value: filters.requestId,
          onSearch: (value) => applyFilters({ requestId: value || undefined }),
        }),
        render: (value: string | null) => truncateText(value, 24),
      },
      {
        dataIndex: 'reason',
        key: 'reason',
        title: t('audit.logs.columns.reason'),
        render: (value: string | null) => truncateText(auditReasonLabel(t, value), 48),
      },
    ],
    [
      actionOptions,
      applyFilters,
      canRead,
      filters.actions,
      filters.actorUserId,
      filters.requestId,
      filters.results,
      filters.targetId,
      filters.targetType,
      resultOptions,
      t,
    ],
  );
};
