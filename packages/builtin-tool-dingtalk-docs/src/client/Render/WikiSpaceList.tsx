'use client';

import { Library } from 'lucide-react';
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
import type { WikiSpacesState } from './types';

type SpaceItem = WikiSpacesState['spaces'][number];

/** `listWikiSpaces` result: the knowledge bases, each with its description and DingTalk link. */
const WikiSpaceList = memo<{ state: WikiSpacesState; title: string }>(({ state, title }) => {
  const { t } = useTranslation('plugin');
  const spaces = asRows<SpaceItem>(state.spaces);

  return (
    <ResultCard
      icon={Library}
      title={title}
      meta={
        spaces.length > 0
          ? t('builtins.lobe-dingtalk-personal.render.count', { count: spaces.length })
          : undefined
      }
    >
      {spaces.length === 0 ? (
        <ResultNote>{t('builtins.lobe-dingtalk-docs.render.wikiSpaces.empty')}</ResultNote>
      ) : (
        <ExpandableList
          items={spaces}
          limit={RESULT_VISIBLE_ROW_LIMIT}
          renderItem={(space, index) => (
            <NodeRow
              href={space.url}
              key={asText(space.workspaceId) ?? String(index)}
              meta={asText(space.description)}
              title={asText(space.name) ?? t('builtins.lobe-dingtalk-docs.render.untitled')}
            />
          )}
        />
      )}
    </ResultCard>
  );
});

WikiSpaceList.displayName = 'DingtalkDocsWikiSpaceList';

export default WikiSpaceList;
