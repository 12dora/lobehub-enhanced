'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CheckCircle2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { DingtalkApprovalWriteApiNameType } from '../apiNames';
import ErrorNotice from '../components/ErrorNotice';
import { argHint } from '../Inspector/argHint';
import { toWriteFacts } from './rows';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Post-execution state of a write: one success line with the key facts, or the
 * mapped short failure message.
 */
const WriteResult = memo<BuiltinRenderProps<Record<string, unknown>>>(
  ({ apiName, args, pluginError, pluginState }) => {
    const { t } = useTranslation('plugin');

    const stateError = isRecord(pluginState) ? pluginState.error : undefined;
    if (pluginError || stateError) return <ErrorNotice error={pluginError ?? stateError} />;
    if (!apiName) return null;

    const api = apiName as DingtalkApprovalWriteApiNameType;
    const { meta, title } = toWriteFacts(pluginState);
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
