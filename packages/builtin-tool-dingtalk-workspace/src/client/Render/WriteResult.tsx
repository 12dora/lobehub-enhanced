'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CheckCircle2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { DingtalkWorkspaceWriteApiName } from '../apiNames';
import ErrorNotice from '../components/ErrorNotice';
import { argHint } from '../Inspector/argHint';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Post-execution state of a todo/calendar write: one success line with the key
 * fact from the call, or the mapped short failure message.
 */
const WriteResult = memo<BuiltinRenderProps<Record<string, unknown>>>(
  ({ apiName, args, pluginError, pluginState }) => {
    const { t } = useTranslation('plugin');

    const stateError = isRecord(pluginState) ? pluginState.error : undefined;
    if (pluginError || stateError) return <ErrorNotice error={pluginError ?? stateError} />;
    if (!apiName) return null;

    const api = apiName as DingtalkWorkspaceWriteApiName;
    // No fact at all is the right outcome for an id-only call: 「已删除待办」 already
    // says what happened, and the todo id it happened to would say nothing.
    const fact = argHint(args);

    return (
      <Flexbox horizontal align={'center'} gap={6} style={{ fontSize: 13 }}>
        <Icon icon={CheckCircle2} size={14} style={{ color: cssVar.colorSuccess }} />
        <span>{t(`builtins.lobe-dingtalk-workspace.ui.written.${api}` as const)}</span>
        {fact && <span style={{ color: cssVar.colorTextTertiary, fontSize: 12 }}>{fact}</span>}
      </Flexbox>
    );
  },
);

WriteResult.displayName = 'DingtalkWorkspaceWriteResult';

export default WriteResult;
