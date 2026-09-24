'use client';

import { Button } from '@lobehub/ui/base-ui';
import { FileText } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { FileState } from '../../types';
import { ExternalAction, ResultCard, ResultNote } from '../components/ResultCard';
import { cardStyles } from '../components/styles';
import { asText, formatFileSize } from './format';

/**
 * `downloadMessageFile` result: the downloaded group file with its size and a
 * collapsed preview of the parsed text the model received.
 */
const FileResult = memo<{ state: FileState }>(({ state }) => {
  const { t } = useTranslation('plugin');
  const [showPreview, setShowPreview] = useState(false);
  const preview = asText(state.preview);

  return (
    <ResultCard
      icon={FileText}
      meta={formatFileSize(state.sizeBytes)}
      title={asText(state.name) ?? t('builtins.lobe-dingtalk-personal.render.unnamed.file')}
    >
      {preview ? (
        <>
          <Button
            className={cardStyles.footerButton}
            size={'small'}
            type={'text'}
            onClick={() => setShowPreview((open) => !open)}
          >
            {showPreview
              ? t('builtins.lobe-dingtalk-personal.render.file.hidePreview')
              : t('builtins.lobe-dingtalk-personal.render.file.showPreview')}
          </Button>
          {showPreview && <div className={cardStyles.preview}>{preview}</div>}
        </>
      ) : (
        <ResultNote>{t('builtins.lobe-dingtalk-personal.render.file.noPreview')}</ResultNote>
      )}
      <ExternalAction href={state.url}>
        {t('builtins.lobe-dingtalk-personal.render.file.open')}
      </ExternalAction>
    </ResultCard>
  );
});

FileResult.displayName = 'DingtalkPersonalFileResult';

export default FileResult;
