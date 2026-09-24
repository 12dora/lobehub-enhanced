'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CheckCircle2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { DingtalkApprovalBatchApiName, DingtalkApprovalWriteApiNameType } from '../apiNames';
import { isDingtalkApprovalBatchApiName } from '../apiNames';
import ErrorNotice from '../components/ErrorNotice';
import { argHint } from '../Inspector/argHint';
import { isBatchWriteState } from './batchWrite';
import BatchWriteResult from './BatchWriteResult';
import { toWriteFacts } from './rows';
import { useUnnamedText } from './unnamed';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Post-execution state of a write: one success line with the key facts, or the
 * mapped short failure message. A batch write lists every approval instead, under
 * the mapped message when the batch failed as a whole.
 */
const WriteResult = memo<BuiltinRenderProps<Record<string, unknown>>>(
  ({ apiName, args, pluginError, pluginState }) => {
    const { t } = useTranslation('plugin');
    const unnamed = useUnnamedText();

    if (isBatchWriteState(pluginState)) {
      if (!pluginError) return <BatchWriteResult state={pluginState} />;

      return (
        <Flexbox gap={8}>
          <ErrorNotice error={pluginError} />
          <BatchWriteResult state={pluginState} />
        </Flexbox>
      );
    }

    const stateError = isRecord(pluginState) ? pluginState.error : undefined;
    if (pluginError || stateError) return <ErrorNotice error={pluginError ?? stateError} />;
    // A batch without its item list has nothing honest to claim.
    if (!apiName || isDingtalkApprovalBatchApiName(apiName)) return null;

    const api = apiName as Exclude<DingtalkApprovalWriteApiNameType, DingtalkApprovalBatchApiName>;
    const { meta, title } = toWriteFacts(pluginState, unnamed.mask);
    // No facts at all is the right outcome for an id-only payload: 「已删除模板」
    // already says what happened.
    const facts = [title, meta].filter(Boolean).join(' · ') || argHint(args) || '';

    return (
      <Flexbox horizontal align={'center'} gap={6} style={{ fontSize: 13 }}>
        <Icon icon={CheckCircle2} size={14} style={{ color: cssVar.colorSuccess }} />
        <span>{t(`builtins.lobe-dingtalk-approval.ui.written.${api}` as const)}</span>
        {facts && <span style={{ color: cssVar.colorTextTertiary, fontSize: 12 }}>{facts}</span>}
      </Flexbox>
    );
  },
);

WriteResult.displayName = 'DingtalkApprovalWriteResult';

export default WriteResult;
