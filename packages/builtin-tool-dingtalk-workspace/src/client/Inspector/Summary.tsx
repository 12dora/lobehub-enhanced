'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { DingtalkWorkspaceApiNameType } from '../apiNames';
import { DINGTALK_WORKSPACE_DOMAINS, DingtalkWorkspaceApiName } from '../apiNames';
import { argHint } from './argHint';
import { resolveBatchCall } from './batchCount';

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

const isKnownApiName = (apiName: string): apiName is DingtalkWorkspaceApiNameType =>
  apiName in DingtalkWorkspaceApiName;

/**
 * One-line inspector for every lobe-dingtalk-workspace API, e.g.
 * 「钉钉日程 · 创建日程」, plus a short hint pulled from the arguments.
 * A batch call names its size instead: 「钉钉待办 · 完成 3 项待办」.
 */
const Summary = memo<BuiltinInspectorProps<Record<string, unknown>>>(
  ({ apiName, args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');

    const known = isKnownApiName(apiName);
    const domain = known ? DINGTALK_WORKSPACE_DOMAINS[apiName] : undefined;
    const batch = known ? resolveBatchCall(apiName, args, partialArgs) : undefined;
    const label = batch
      ? t(`builtins.lobe-dingtalk-workspace.ui.batch.action.${batch.apiName}` as const, {
          count: batch.count,
        })
      : known
        ? t(`builtins.lobe-dingtalk-workspace.ui.apiLabel.${apiName}` as const)
        : apiName;
    const title = domain
      ? `${t(`builtins.lobe-dingtalk-workspace.ui.domain.${domain}` as const)} · ${label}`
      : label;
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

Summary.displayName = 'DingtalkWorkspaceSummaryInspector';

export default Summary;
