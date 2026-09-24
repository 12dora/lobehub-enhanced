'use client';

import { FolderTree } from 'lucide-react';
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
import { joinMeta, NodeRow, useNodeKindLabel } from './NodeRow';
import type { WikiNodesState } from './types';

type NodeItem = WikiNodesState['nodes'][number];

/**
 * `listWikiNodes` result: one level of a knowledge base — folders and documents with their kind
 * and whether they hold more below.
 */
const WikiNodeList = memo<{ state: WikiNodesState; title: string }>(({ state, title }) => {
  const { t } = useTranslation('plugin');
  const kindLabel = useNodeKindLabel();
  const nodes = asRows<NodeItem>(state.nodes);

  return (
    <ResultCard
      icon={FolderTree}
      title={title}
      meta={
        nodes.length > 0
          ? t('builtins.lobe-dingtalk-personal.render.count', { count: nodes.length })
          : undefined
      }
    >
      {nodes.length === 0 ? (
        <ResultNote>{t('builtins.lobe-dingtalk-docs.render.wikiNodes.empty')}</ResultNote>
      ) : (
        <ExpandableList
          items={nodes}
          limit={RESULT_VISIBLE_ROW_LIMIT}
          renderItem={(node, index) => (
            <NodeRow
              href={node.url}
              key={asText(node.nodeId) ?? String(index)}
              title={asText(node.name) ?? t('builtins.lobe-dingtalk-docs.render.untitled')}
              meta={joinMeta(
                kindLabel(node.type, node.extension),
                node.hasChildren === true &&
                  t('builtins.lobe-dingtalk-docs.render.wikiNodes.hasChildren'),
              )}
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

WikiNodeList.displayName = 'DingtalkDocsWikiNodeList';

export default WikiNodeList;
