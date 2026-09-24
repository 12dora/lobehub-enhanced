'use client';

import { Flexbox } from '@lobehub/ui';
import { NotebookText } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReportDetailState } from '../../types';
import { ExternalAction, ResultCard, ResultField, ResultNote } from '../components/ResultCard';
import { asRows, asText, formatDateTime } from './format';

type ReportContent = ReportDetailState['report']['contents'][number];

/** `getReport` result: the report's fields as label / value rows. */
const ReportDetail = memo<{ state: ReportDetailState }>(({ state }) => {
  const { t } = useTranslation('plugin');

  const report = state.report && typeof state.report === 'object' ? state.report : undefined;
  if (!report) return null;

  const contents = asRows<ReportContent>(report.contents).flatMap((item) => {
    const key = asText(item.key);
    return key ? [{ key, value: typeof item.value === 'string' ? item.value.trim() : '' }] : [];
  });
  const meta = [
    asText(report.creatorName),
    asText(report.deptName),
    formatDateTime(report.createTime),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ResultCard
      icon={NotebookText}
      meta={meta || undefined}
      title={
        asText(report.name) ??
        asText(report.templateName) ??
        t('builtins.lobe-dingtalk-personal.render.unnamed.report')
      }
    >
      {contents.length === 0 ? (
        <ResultNote>{t('builtins.lobe-dingtalk-personal.render.report.noContent')}</ResultNote>
      ) : (
        <Flexbox gap={6}>
          {contents.map((item, index) => (
            <ResultField key={`${item.key}-${index}`} label={item.key}>
              {item.value || '—'}
            </ResultField>
          ))}
        </Flexbox>
      )}
      <ExternalAction href={report.url}>
        {t('builtins.lobe-dingtalk-personal.render.openInDingtalk')}
      </ExternalAction>
    </ResultCard>
  );
});

ReportDetail.displayName = 'DingtalkPersonalReportDetail';

export default ReportDetail;
