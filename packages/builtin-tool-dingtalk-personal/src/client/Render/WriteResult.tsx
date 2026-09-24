'use client';

import { LinkedText } from '@lobechat/builtin-tool-dingtalk-workspace/client';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CheckCircle2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { WriteState } from '../../types';
import { asText } from './format';

const WRITE_ACTIONS = new Set(['completeTodo', 'submitReport', 'updateTodo']);

/** Post-execution state of a confirmed write: one success line plus the server summary. */
const WriteResult = memo<{ state: WriteState }>(({ state }) => {
  const { t } = useTranslation('plugin');

  const action = WRITE_ACTIONS.has(state.action) ? state.action : undefined;
  const summary = asText(state.summary);
  if (!action && !summary) return null;

  return (
    <Flexbox horizontal align={'flex-start'} gap={6} style={{ fontSize: 13, lineHeight: 1.6 }}>
      <Icon
        icon={CheckCircle2}
        size={14}
        style={{ color: cssVar.colorSuccess, flexShrink: 0, marginBlockStart: 4 }}
      />
      {action && (
        <span style={{ flexShrink: 0 }}>
          {t(`builtins.lobe-dingtalk-personal.render.written.${action}` as const)}
        </span>
      )}
      {summary && (
        <span style={{ color: cssVar.colorTextTertiary, fontSize: 12, overflowWrap: 'anywhere' }}>
          <LinkedText text={summary} />
        </span>
      )}
    </Flexbox>
  );
});

WriteResult.displayName = 'DingtalkPersonalWriteResult';

export default WriteResult;
