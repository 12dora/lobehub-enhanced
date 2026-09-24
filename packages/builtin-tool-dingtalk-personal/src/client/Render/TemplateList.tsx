'use client';

import { LayoutTemplate } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TemplatesState } from '../../types';
import { RESULT_VISIBLE_ROW_LIMIT } from '../components/constants';
import { ExpandableList, ResultCard, ResultNote } from '../components/ResultCard';
import { cardStyles } from '../components/styles';
import { asRows, asText } from './format';

type TemplateView = TemplatesState['templates'][number];

/** `listReportTemplates` result: the report templates the user can write. */
const TemplateList = memo<{ state: TemplatesState; title: string }>(({ state, title }) => {
  const { t } = useTranslation('plugin');
  const templates = asRows<TemplateView>(state.templates);

  return (
    <ResultCard
      icon={LayoutTemplate}
      title={title}
      meta={
        templates.length > 0
          ? t('builtins.lobe-dingtalk-personal.render.count', { count: templates.length })
          : undefined
      }
    >
      {templates.length === 0 ? (
        <ResultNote>{t('builtins.lobe-dingtalk-personal.render.template.empty')}</ResultNote>
      ) : (
        <ExpandableList
          items={templates}
          limit={RESULT_VISIBLE_ROW_LIMIT}
          renderItem={(template, index) => (
            <div className={cardStyles.row} key={template.id ?? String(index)}>
              <span className={cardStyles.rowTitle}>
                {asText(template.name) ??
                  t('builtins.lobe-dingtalk-personal.render.unnamed.template')}
              </span>
            </div>
          )}
        />
      )}
    </ResultCard>
  );
});

TemplateList.displayName = 'DingtalkPersonalTemplateList';

export default TemplateList;
