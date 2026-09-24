'use client';

import { FileSearch } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  asRows,
  asText,
  ExpandableList,
  formatDateTime,
  RESULT_VISIBLE_ROW_LIMIT,
  ResultCard,
  ResultNote,
} from '../components/shared';
import { joinMeta, NodeRow, useNodeKindLabel } from './NodeRow';
import type { DocsState } from './types';

type DocItem = DocsState['items'][number];

/** `searchDocs` result: matching documents with their kind, last edit and DingTalk link. */
const DocList = memo<{ state: DocsState; title: string }>(({ state, title }) => {
  const { t } = useTranslation('plugin');
  const kindLabel = useNodeKindLabel();
  const items = asRows<DocItem>(state.items);

  return (
    <ResultCard
      icon={FileSearch}
      title={title}
      meta={
        items.length > 0
          ? t('builtins.lobe-dingtalk-personal.render.count', { count: items.length })
          : undefined
      }
    >
      {items.length === 0 ? (
        <ResultNote>{t('builtins.lobe-dingtalk-docs.render.docs.empty')}</ResultNote>
      ) : (
        <ExpandableList
          items={items}
          limit={RESULT_VISIBLE_ROW_LIMIT}
          renderItem={(item, index) => (
            <NodeRow
              href={item.url}
              key={asText(item.nodeId) ?? String(index)}
              meta={joinMeta(kindLabel(undefined, item.docType), formatDateTime(item.modifiedTime))}
              title={asText(item.name) ?? t('builtins.lobe-dingtalk-docs.render.untitled')}
            />
          )}
        />
      )}
      {state.hasMore === true && (
        <ResultNote>{t('builtins.lobe-dingtalk-personal.render.hasMore')}</ResultNote>
      )}
    </ResultCard>
  );
});

DocList.displayName = 'DingtalkDocsDocList';

export default DocList;
