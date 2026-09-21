'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { DingtalkApprovalApiNameType } from '../apiNames';
import { DingtalkApprovalApiName } from '../apiNames';
import { argHint } from './argHint';

const styles = createStaticStyles(({ css, cssVar }) => ({
  hint: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    align-items: center;

    min-width: 0;
    max-width: 240px;
    margin-inline-start: 6px;
    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
}));

const isKnownApiName = (apiName: string): apiName is DingtalkApprovalApiNameType =>
  apiName in DingtalkApprovalApiName;

/**
 * One-line inspector for every lobe-dingtalk-approval API, e.g.
 * 「钉钉审批 · 同意」 plus a short hint pulled from the arguments.
 */
const Summary = memo<BuiltinInspectorProps<Record<string, unknown>>>(
  ({ apiName, args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');

    const label = isKnownApiName(apiName)
      ? t(`builtins.lobe-dingtalk-approval.ui.apiLabel.${apiName}` as const)
      : apiName;
    const title = `${t('builtins.lobe-dingtalk-approval.title')} · ${label}`;
    const hint = argHint(args ?? partialArgs);

    return (
      <div
        style={{ flexWrap: 'wrap', gap: 4 }}
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <span>{title}</span>
        {hint && <span className={styles.hint}>{hint}</span>}
      </div>
    );
  },
);

Summary.displayName = 'DingtalkApprovalSummaryInspector';

export default Summary;
