'use client';

import { HardDrive } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  asRows,
  asText,
  ExpandableList,
  formatFileSize,
  RESULT_VISIBLE_ROW_LIMIT,
  ResultCard,
  ResultNote,
} from '../components/shared';
import { resolveNodeKind } from './format';
import { NodeRow, useNodeKindLabel } from './NodeRow';
import type { DriveFilesState } from './types';

type DriveItem = DriveFilesState['files'][number];

/** Extension of a plain file name (`库存.xlsx` → `xlsx`). */
const extensionOf = (name?: string) => {
  const match = name ? /\.([\dA-Z]{1,8})$/i.exec(name) : null;
  return match?.[1];
};

/**
 * `searchDrive` / `listDrive` result: 钉盘 folders and files. A folder or an online document says
 * what it is; a plain file shows its size.
 */
const DriveFileList = memo<{ state: DriveFilesState; title: string }>(({ state, title }) => {
  const { t } = useTranslation('plugin');
  const kindLabel = useNodeKindLabel();
  const files = asRows<DriveItem>(state.files);

  return (
    <ResultCard
      icon={HardDrive}
      title={title}
      meta={
        files.length > 0
          ? t('builtins.lobe-dingtalk-personal.render.count', { count: files.length })
          : undefined
      }
    >
      {files.length === 0 ? (
        <ResultNote>{t('builtins.lobe-dingtalk-docs.render.driveFiles.empty')}</ResultNote>
      ) : (
        <ExpandableList
          items={files}
          limit={RESULT_VISIBLE_ROW_LIMIT}
          renderItem={(file, index) => {
            const name = asText(file.name);
            const meta = resolveNodeKind(file.type)
              ? kindLabel(file.type)
              : formatFileSize(file.fileSize);

            return (
              <NodeRow
                key={asText(file.nodeId) ?? String(index)}
                meta={meta ?? kindLabel(undefined, extensionOf(name))}
                title={name ?? t('builtins.lobe-dingtalk-docs.render.untitled')}
              />
            );
          }}
        />
      )}
      {state.hasMore === true && (
        <ResultNote>{t('builtins.lobe-dingtalk-personal.render.hasMore')}</ResultNote>
      )}
    </ResultCard>
  );
});

DriveFileList.displayName = 'DingtalkDocsDriveFileList';

export default DriveFileList;
