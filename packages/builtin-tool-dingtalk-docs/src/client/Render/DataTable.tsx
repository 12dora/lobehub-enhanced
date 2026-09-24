'use client';

import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cardStyles } from '../components/shared';

/** Rows shown before the table collapses the rest behind 「显示全部」. */
export const TABLE_VISIBLE_ROW_LIMIT = 10;

const styles = createStaticStyles(({ css, cssVar }) => ({
  scroll: css`
    overflow: auto;

    max-width: 100%;
    max-height: 360px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  table: css`
    border-spacing: 0;
    border-collapse: separate;

    min-width: 100%;

    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorText};

    th,
    td {
      overflow: hidden;

      max-width: 240px;
      padding-block: 5px;
      padding-inline: 8px;
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};

      text-align: start;
      text-overflow: ellipsis;
      white-space: nowrap;
      vertical-align: top;
    }

    th {
      position: sticky;
      z-index: 1;
      inset-block-start: 0;

      font-weight: 500;
      color: ${cssVar.colorTextSecondary};

      background: ${cssVar.colorBgContainer};
    }

    tr:last-child td {
      border-block-end: none;
    }
  `,
}));

interface DataTableProps {
  columns: string[];
  /** React keys of the rows; the index when absent. */
  rowKeys?: string[];
  rows: string[][];
}

/**
 * Compact read-only table for sheet ranges and AI-table records: a sticky header, cells cut to one
 * line (full text on hover) and a scroll box, so a 30-column range never widens the chat. Long
 * tables start with the first rows and open the rest on demand.
 */
const DataTable = memo<DataTableProps>(({ columns, rowKeys, rows }) => {
  const { t } = useTranslation('plugin');
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, TABLE_VISIBLE_ROW_LIMIT);

  return (
    <>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th key={`${index}-${column}`} scope={'col'} title={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, rowIndex) => (
              <tr key={rowKeys?.[rowIndex] ?? String(rowIndex)}>
                {columns.map((_, cellIndex) => {
                  const cell = row[cellIndex] ?? '';
                  return (
                    <td key={cellIndex} title={cell || undefined}>
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > TABLE_VISIBLE_ROW_LIMIT && (
        <Button
          className={cardStyles.footerButton}
          size={'small'}
          type={'text'}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded
            ? t('builtins.lobe-dingtalk-personal.render.collapse')
            : t('builtins.lobe-dingtalk-docs.render.table.showAll', { count: rows.length })}
        </Button>
      )}
    </>
  );
});

DataTable.displayName = 'DingtalkDocsDataTable';

export default DataTable;
