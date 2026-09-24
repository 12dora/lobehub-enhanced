'use client';

import { Rows3 } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { asRows, asText, ResultCard, ResultNote } from '../components/shared';
import DataTable from './DataTable';
import { cellText, isRecord } from './format';
import type { AitableRecordsState } from './types';

type FieldItem = AitableRecordsState['fields'][number];
type RecordItem = AitableRecordsState['records'][number];

/**
 * Column names in table order. Without a field list (old history, a failed schema lookup) the
 * columns follow the cells the records actually carry.
 */
const resolveColumns = (fields: FieldItem[], records: RecordItem[]): string[] => {
  const named = fields.map((field) => asText(field.name)).filter((name): name is string => !!name);
  const columns = new Set(named);
  if (columns.size > 0) return [...columns];

  for (const record of records) {
    if (!isRecord(record.cells)) continue;
    for (const name of Object.keys(record.cells)) columns.add(name);
  }

  return [...columns];
};

/**
 * `queryAitableRecords` result: the records as a table with one column per field name, the first
 * rows open and the rest one click away, plus 「共 N 条」.
 */
const AitableRecords = memo<{ state: AitableRecordsState; title: string }>(({ state, title }) => {
  const { t } = useTranslation('plugin');

  const { columns, rowKeys, rows } = useMemo(() => {
    const records = asRows<RecordItem>(state.records);
    const names = resolveColumns(asRows<FieldItem>(state.fields), records);

    return {
      columns: names,
      rowKeys: records.map((record, index) => `${index}-${asText(record.recordId) ?? ''}`),
      rows: records.map((record) =>
        names.map((name) => (isRecord(record.cells) ? cellText(record.cells[name]) : '')),
      ),
    };
  }, [state.fields, state.records]);

  return (
    <ResultCard
      icon={Rows3}
      title={title}
      meta={
        rows.length > 0
          ? t('builtins.lobe-dingtalk-docs.render.aitableRecords.total', { count: rows.length })
          : undefined
      }
    >
      {rows.length === 0 || columns.length === 0 ? (
        <ResultNote>{t('builtins.lobe-dingtalk-docs.render.aitableRecords.empty')}</ResultNote>
      ) : (
        <DataTable columns={columns} rowKeys={rowKeys} rows={rows} />
      )}
      {state.hasMore === true && (
        <ResultNote>{t('builtins.lobe-dingtalk-docs.render.aitableRecords.hasMore')}</ResultNote>
      )}
    </ResultCard>
  );
});

AitableRecords.displayName = 'DingtalkDocsAitableRecords';

export default AitableRecords;
