'use client';

import { LinkedText } from '@lobechat/builtin-tool-dingtalk-workspace/client';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CheckCircle2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { isDingtalkDocsWriteApiName } from '../apiNames';
import { asText, ExternalAction } from '../components/shared';
import type { WriteState } from './types';

/**
 * Post-execution state of a confirmed write: one success line, the server summary (「已向「9月」追加
 * 3 行」) and the link to the document or table when the server sent one.
 */
const WriteResult = memo<{ state: WriteState }>(({ state }) => {
  const { t } = useTranslation('plugin');

  const action = isDingtalkDocsWriteApiName(state.action) ? state.action : undefined;
  const summary = asText(state.summary);
  if (!action && !summary) return null;

  return (
    <Flexbox gap={4}>
      <Flexbox horizontal align={'flex-start'} gap={6} style={{ fontSize: 13, lineHeight: 1.6 }}>
        <Icon
          icon={CheckCircle2}
          size={14}
          style={{ color: cssVar.colorSuccess, flexShrink: 0, marginBlockStart: 4 }}
        />
        {action && (
          <span style={{ flexShrink: 0 }}>
            {t(`builtins.lobe-dingtalk-docs.render.written.${action}` as const)}
          </span>
        )}
        {summary && (
          <span style={{ color: cssVar.colorTextTertiary, fontSize: 12, overflowWrap: 'anywhere' }}>
            <LinkedText text={summary} />
          </span>
        )}
      </Flexbox>
      <ExternalAction href={state.url}>
        {t('builtins.lobe-dingtalk-personal.render.openInDingtalk')}
      </ExternalAction>
    </Flexbox>
  );
});

WriteResult.displayName = 'DingtalkDocsWriteResult';

export default WriteResult;
