'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { FileText, Inbox, Send, Users, Zap } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { DingtalkApprovalApiNameType } from '../apiNames';
import { DingtalkApprovalApiName } from '../apiNames';
import { RESULT_VISIBLE_ROW_LIMIT } from '../components/constants';
import ErrorNotice from '../components/ErrorNotice';
import { ResultCard, ResultRow } from '../components/ResultCard';
import { toResultRowList } from './rows';
import { useUnnamedText } from './unnamed';

const ICONS: Partial<Record<DingtalkApprovalApiNameType, LucideIcon>> = {
  [DingtalkApprovalApiName.listApprovalRules]: Zap,
  [DingtalkApprovalApiName.listMyApplications]: Send,
  [DingtalkApprovalApiName.listPendingApprovals]: Inbox,
  [DingtalkApprovalApiName.listTemplates]: FileText,
  [DingtalkApprovalApiName.searchDirectory]: Users,
};

/** Compact list result: dense rows with a title plus secondary meta. */
const ListResult = memo<BuiltinRenderProps<Record<string, unknown>>>(
  ({ apiName, pluginError, pluginState }) => {
    const { t } = useTranslation('plugin');
    const unnamed = useUnnamedText();

    if (pluginError) return <ErrorNotice error={pluginError} />;
    if (!apiName) return null;

    const api = apiName as DingtalkApprovalApiNameType;
    const { rows, total, truncated } = toResultRowList(pluginState, unnamed.mask);
    const visible = rows.slice(0, RESULT_VISIBLE_ROW_LIMIT);
    const overflow = Math.max(total - visible.length, 0);

    return (
      <ResultCard
        icon={ICONS[api]}
        title={t(`builtins.lobe-dingtalk-approval.ui.apiLabel.${api}` as const)}
        meta={
          total > 0
            ? t('builtins.lobe-dingtalk-approval.ui.render.count', { count: total })
            : undefined
        }
      >
        {visible.length === 0 ? (
          <span style={{ color: cssVar.colorTextTertiary, fontSize: 13 }}>
            {total > 0
              ? t('builtins.lobe-dingtalk-approval.ui.render.countOnly', { count: total })
              : t('builtins.lobe-dingtalk-approval.ui.render.empty')}
          </span>
        ) : (
          <Flexbox gap={6}>
            {visible.map((row) => (
              <ResultRow
                key={row.key}
                meta={row.meta}
                title={row.title ?? unnamed.item}
                tag={
                  row.tag
                    ? t(`builtins.lobe-dingtalk-approval.ui.render.tag.${row.tag}` as const)
                    : undefined
                }
              />
            ))}
            {overflow > 0 && (
              <span style={{ color: cssVar.colorTextTertiary, fontSize: 12 }}>
                {t('builtins.lobe-dingtalk-approval.ui.render.more', { count: overflow })}
              </span>
            )}
            {truncated && (
              <span style={{ color: cssVar.colorTextTertiary, fontSize: 12 }}>
                {t('builtins.lobe-dingtalk-approval.ui.render.truncated')}
              </span>
            )}
          </Flexbox>
        )}
      </ResultCard>
    );
  },
);

ListResult.displayName = 'DingtalkApprovalListResult';

export default ListResult;
