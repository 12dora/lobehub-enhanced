'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import { describeDocsCall, DINGTALK_DOCS_INSPECTOR_KEYS } from './describe';

/**
 * One-line inspector for every lobe-dingtalk-docs API: a plain sentence of what the call does,
 * e.g. 「搜索文档：周报」, 「读取表格 A1:F20」 or 「向 AI 表格新增 3 条记录」. It fills in while the
 * arguments stream and picks up the resolved name (document title, used range) once the result
 * is back; ids never show.
 */
const Summary = memo<BuiltinInspectorProps<Record<string, unknown>>>(
  ({ apiName, args, partialArgs, pluginState, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');

    const summary = describeDocsCall(apiName, args, partialArgs, pluginState);

    let title: string = apiName;
    if (summary) {
      const sentence = t(summary.key, summary.params);
      title = summary.nextPage
        ? t(DINGTALK_DOCS_INSPECTOR_KEYS.nextPage, { action: sentence })
        : sentence;
    }

    return (
      <div
        style={{ flexWrap: 'wrap', gap: 4 }}
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <span>{title}</span>
      </div>
    );
  },
);

Summary.displayName = 'DingtalkDocsSummaryInspector';

export default Summary;
