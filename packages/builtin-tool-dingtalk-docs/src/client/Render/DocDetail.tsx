'use client';

import { Button } from '@lobehub/ui/base-ui';
import { FileText } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { asText, cardStyles, ExternalAction, ResultCard, ResultNote } from '../components/shared';
import { asCount } from './format';
import type { DocState } from './types';

/**
 * `readDoc` result: the document title, its length and a collapsed preview of the opening the
 * model read, plus the link back to DingTalk.
 */
const DocDetail = memo<{ state: DocState }>(({ state }) => {
  const { t } = useTranslation('plugin');
  const [showPreview, setShowPreview] = useState(false);

  const preview = asText(state.preview);
  const length = asCount(state.length);
  // The card keeps only the opening; say so rather than let it pass for the whole document.
  const clipped = !!preview && length !== undefined && length > preview.length;

  return (
    <ResultCard
      icon={FileText}
      title={asText(state.title) ?? t('builtins.lobe-dingtalk-docs.render.untitled')}
      meta={
        length === undefined
          ? undefined
          : t('builtins.lobe-dingtalk-docs.render.doc.length', { count: length })
      }
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
          {showPreview && clipped && (
            <ResultNote>
              {t('builtins.lobe-dingtalk-docs.render.doc.previewClipped', {
                count: preview.length,
              })}
            </ResultNote>
          )}
        </>
      ) : (
        <ResultNote>{t('builtins.lobe-dingtalk-docs.render.doc.empty')}</ResultNote>
      )}
      <ExternalAction href={state.url}>
        {t('builtins.lobe-dingtalk-personal.render.openInDingtalk')}
      </ExternalAction>
    </ResultCard>
  );
});

DocDetail.displayName = 'DingtalkDocsDocDetail';

export default DocDetail;
