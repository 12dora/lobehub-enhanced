'use client';

import { Database } from 'lucide-react';
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
import type { AitableBasesState } from './types';

type BaseItem = AitableBasesState['bases'][number];

/** `searchAitableBases` result: the AI tables found (or the recent ones without a keyword). */
const AitableBaseList = memo<{ state: AitableBasesState; title: string }>(({ state, title }) => {
  const { t } = useTranslation('plugin');
  const bases = asRows<BaseItem>(state.bases);

  return (
    <ResultCard
      icon={Database}
      title={title}
      meta={
        bases.length > 0
          ? t('builtins.lobe-dingtalk-personal.render.count', { count: bases.length })
          : undefined
      }
    >
      {bases.length === 0 ? (
        <ResultNote>{t('builtins.lobe-dingtalk-docs.render.aitableBases.empty')}</ResultNote>
      ) : (
        <ExpandableList
          items={bases}
          limit={RESULT_VISIBLE_ROW_LIMIT}
          renderItem={(base, index) => (
            <NodeRow
              key={asText(base.baseId) ?? String(index)}
              title={asText(base.baseName) ?? t('builtins.lobe-dingtalk-docs.render.untitled')}
            />
          )}
        />
      )}
    </ResultCard>
  );
});

AitableBaseList.displayName = 'DingtalkDocsAitableBaseList';

export default AitableBaseList;
