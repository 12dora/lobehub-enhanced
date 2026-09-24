'use client';

import { Table2 } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { asText, ResultCard, ResultNote } from '../components/shared';
import DataTable from './DataTable';
import { padRows, toTableRows } from './format';
import { joinMeta } from './NodeRow';
import type { SheetRangeState } from './types';

/**
 * `readSheet` result: the cells of the range the model read, the first row as the header. A range
 * the server had to clip says so under the table.
 */
const SheetRange = memo<{ state: SheetRangeState; title: string }>(({ state, title }) => {
  const { t } = useTranslation('plugin');

  const { body, header } = useMemo(() => {
    const rows = toTableRows(state.rows);
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const [head = [], ...rest] = padRows(rows, width);

    return { body: rest, header: head };
  }, [state.rows]);

  const range = asText(state.range);

  return (
    <ResultCard
      icon={Table2}
      title={title}
      meta={joinMeta(
        range,
        header.length > 0 &&
          t('builtins.lobe-dingtalk-docs.render.sheetRange.rows', { count: body.length }),
      )}
    >
      {header.length === 0 ? (
        <ResultNote>{t('builtins.lobe-dingtalk-docs.render.sheetRange.empty')}</ResultNote>
      ) : (
        <DataTable columns={header} rows={body} />
      )}
      {state.truncated === true && (
        <ResultNote>{t('builtins.lobe-dingtalk-docs.render.sheetRange.truncated')}</ResultNote>
      )}
    </ResultCard>
  );
});

SheetRange.displayName = 'DingtalkDocsSheetRange';

export default SheetRange;
