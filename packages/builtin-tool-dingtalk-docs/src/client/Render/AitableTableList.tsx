'use client';

import { TableProperties } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  asRows,
  asText,
  ExpandableList,
  RESULT_VISIBLE_ROW_LIMIT,
  ResultCard,
  ResultNote,
} from '../components/shared';
import { NodeRow } from './NodeRow';
import type { AitableTablesState } from './types';

type TableItem = AitableTablesState['tables'][number];

/** `listAitableTables` result: the data tables inside one AI table. */
const AitableTableList = memo<{ state: AitableTablesState; title: string }>(({ state, title }) => {
  const { t } = useTranslation('plugin');
  const tables = asRows<TableItem>(state.tables);

  return (
    <ResultCard
      icon={TableProperties}
      title={title}
      meta={
        tables.length > 0
          ? t('builtins.lobe-dingtalk-personal.render.count', { count: tables.length })
          : undefined
      }
    >
      {tables.length === 0 ? (
        <ResultNote>{t('builtins.lobe-dingtalk-docs.render.aitableTables.empty')}</ResultNote>
      ) : (
        <ExpandableList
          items={tables}
          limit={RESULT_VISIBLE_ROW_LIMIT}
          renderItem={(table, index) => (
            <NodeRow
              key={asText(table.tableId) ?? String(index)}
              title={asText(table.tableName) ?? t('builtins.lobe-dingtalk-docs.render.untitled')}
            />
          )}
        />
      )}
    </ResultCard>
  );
});

AitableTableList.displayName = 'DingtalkDocsAitableTableList';

export default AitableTableList;
