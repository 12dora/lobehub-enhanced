'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import { DINGTALK_PERSONAL_DOMAINS, isDingtalkPersonalApiName } from '../apiNames';
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

/**
 * One-line inspector for every lobe-dingtalk-personal API, e.g.
 * 「我的钉钉待办 · 查看我的待办」, plus a short hint pulled from the arguments.
 */
const Summary = memo<BuiltinInspectorProps<Record<string, unknown>>>(
  ({ apiName, args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');

    let title: string = apiName;
    if (isDingtalkPersonalApiName(apiName)) {
      const domain = DINGTALK_PERSONAL_DOMAINS[apiName];
      title = [
        t(`builtins.lobe-dingtalk-personal.render.domain.${domain}` as const),
        t(`builtins.lobe-dingtalk-personal.apiName.${apiName}` as const),
      ].join(' · ');
    }
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

Summary.displayName = 'DingtalkPersonalSummaryInspector';

export default Summary;
