'use client';

import { Sheet } from 'lucide-react';
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
import type { SheetsState } from './types';

type SheetItem = SheetsState['sheets'][number];

/** `listSheets` result: the worksheets of one online spreadsheet and the range holding data. */
const SheetList = memo<{ state: SheetsState; title: string }>(({ state, title }) => {
  const { t } = useTranslation('plugin');
  const sheets = asRows<SheetItem>(state.sheets);

  return (
    <ResultCard
      icon={Sheet}
      title={title}
      meta={
        sheets.length > 0
          ? t('builtins.lobe-dingtalk-personal.render.count', { count: sheets.length })
          : undefined
      }
    >
      {sheets.length === 0 ? (
        <ResultNote>{t('builtins.lobe-dingtalk-docs.render.sheets.empty')}</ResultNote>
      ) : (
        <ExpandableList
          items={sheets}
          limit={RESULT_VISIBLE_ROW_LIMIT}
          renderItem={(sheet, index) => {
            const usedRange = asText(sheet.usedRange);

            return (
              <NodeRow
                key={asText(sheet.sheetId) ?? String(index)}
                title={asText(sheet.title) ?? t('builtins.lobe-dingtalk-docs.render.untitled')}
                meta={
                  usedRange
                    ? t('builtins.lobe-dingtalk-docs.render.sheets.usedRange', {
                        range: usedRange,
                      })
                    : undefined
                }
              />
            );
          }}
        />
      )}
    </ResultCard>
  );
});

SheetList.displayName = 'DingtalkDocsSheetList';

export default SheetList;
