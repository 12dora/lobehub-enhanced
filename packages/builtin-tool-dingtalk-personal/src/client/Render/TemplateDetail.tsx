'use client';

import { LayoutTemplate } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TemplateState } from '../../types';
import { ResultCard, ResultNote } from '../components/ResultCard';
import { cardStyles } from '../components/styles';
import { asRows, asText } from './format';

type TemplateField = TemplateState['template']['fields'][number];

/** `getReportTemplate` result: the fields a report of this template is made of. */
const TemplateDetail = memo<{ state: TemplateState }>(({ state }) => {
  const { t } = useTranslation('plugin');

  const template =
    state.template && typeof state.template === 'object' ? state.template : undefined;
  if (!template) return null;

  const fields = asRows<TemplateField>(template.fields)
    .filter((field) => !!asText(field.name))
    .sort(
      (a, b) =>
        (typeof a.sort === 'number' ? a.sort : Number.MAX_SAFE_INTEGER) -
        (typeof b.sort === 'number' ? b.sort : Number.MAX_SAFE_INTEGER),
    );

  return (
    <ResultCard
      icon={LayoutTemplate}
      title={asText(template.name) ?? t('builtins.lobe-dingtalk-personal.render.unnamed.template')}
      meta={
        fields.length > 0
          ? t('builtins.lobe-dingtalk-personal.render.template.fieldCount', {
              count: fields.length,
            })
          : undefined
      }
    >
      {fields.length === 0 ? (
        <ResultNote>{t('builtins.lobe-dingtalk-personal.render.template.noFields')}</ResultNote>
      ) : (
        <div className={cardStyles.rows}>
          {fields.map((field, index) => (
            <div className={cardStyles.row} key={`${field.name}-${index}`}>
              <span className={cardStyles.label} style={{ minWidth: 20 }}>
                {index + 1}.
              </span>
              <span className={cardStyles.value}>{asText(field.name)}</span>
            </div>
          ))}
        </div>
      )}
    </ResultCard>
  );
});

TemplateDetail.displayName = 'DingtalkPersonalTemplateDetail';

export default TemplateDetail;
