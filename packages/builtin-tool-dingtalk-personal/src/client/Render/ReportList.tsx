'use client';

import { NotebookText } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReportItem, ReportsState } from '../../types';
import { RESULT_VISIBLE_ROW_LIMIT } from '../components/constants';
import { ExpandableList, ResultCard, ResultNote } from '../components/ResultCard';
import { cardStyles } from '../components/styles';
import { asRows, asText, formatDateTime } from './format';

/** `listReports` result: received (inbox) or sent (outbox) work reports. */
const ReportList = memo<{ state: ReportsState; title: string }>(({ state, title }) => {
  const { t } = useTranslation('plugin');
  const reports = asRows<ReportItem>(state.reports);
  const box = state.box === 'inbox' || state.box === 'outbox' ? state.box : undefined;

  return (
    <ResultCard
      icon={NotebookText}
      title={box ? t(`builtins.lobe-dingtalk-personal.render.report.box.${box}` as const) : title}
      meta={
        reports.length > 0
          ? t('builtins.lobe-dingtalk-personal.render.count', { count: reports.length })
          : undefined
      }
    >
      {reports.length === 0 ? (
        <ResultNote>{t('builtins.lobe-dingtalk-personal.render.report.empty')}</ResultNote>
      ) : (
        <ExpandableList
          items={reports}
          limit={RESULT_VISIBLE_ROW_LIMIT}
          renderItem={(report, index) => {
            const meta = [asText(report.creatorName), formatDateTime(report.createTime)]
              .filter(Boolean)
              .join(' · ');

            return (
              <div className={cardStyles.row} key={report.reportId ?? String(index)}>
                <span className={cardStyles.rowTitle}>
                  {asText(report.templateName) ??
                    t('builtins.lobe-dingtalk-personal.render.unnamed.report')}
                </span>
                {meta && <span className={cardStyles.rowMeta}>{meta}</span>}
              </div>
            );
          }}
        />
      )}
      {state.complete === false && (
        <ResultNote>{t('builtins.lobe-dingtalk-personal.render.hasMore')}</ResultNote>
      )}
    </ResultCard>
  );
});

ReportList.displayName = 'DingtalkPersonalReportList';

export default ReportList;
