'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { FileText } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { DingtalkApprovalApiNameType } from '../apiNames';
import { DingtalkApprovalApiName } from '../apiNames';
import { CONFIRM_VISIBLE_LINE_LIMIT } from '../components/constants';
import { maskIdentifiers } from '../components/displayText';
import ErrorNotice from '../components/ErrorNotice';
import { ResultCard, ResultField, ResultRow } from '../components/ResultCard';
import { pickLabelValuePairs, toWriteFacts } from './rows';
import { useUnnamedText } from './unnamed';

/** Template schema field, per shared contract §4.1 `getTemplateSchema`. */
interface SchemaField {
  componentType?: string;
  label?: string;
  required?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readSchemaFields = (state: unknown): SchemaField[] => {
  if (!isRecord(state) || !Array.isArray(state.fields)) return [];

  // `componentId` is deliberately not read: the form label is what the user sees
  // in DingTalk, the component id is how the API addresses it.
  return state.fields.filter(isRecord).map((field) => ({
    componentType: maskIdentifiers(field.componentType),
    label: maskIdentifiers(field.label),
    required: field.required === true,
  }));
};

/** Detail result for `getApprovalDetail` / `getTemplateSchema`. */
const Detail = memo<BuiltinRenderProps<Record<string, unknown>>>(
  ({ apiName, pluginError, pluginState }) => {
    const { t } = useTranslation('plugin');
    const unnamed = useUnnamedText();

    if (pluginError) return <ErrorNotice error={pluginError} />;
    if (!apiName) return null;

    const api = apiName as DingtalkApprovalApiNameType;
    const { meta, title } = toWriteFacts(pluginState, unnamed.mask);
    // The action label is the honest fallback here: 「审批详情」 describes the card,
    // while the instance id it was fetched by describes nothing.
    const cardTitle = title || t(`builtins.lobe-dingtalk-approval.ui.apiLabel.${api}` as const);

    if (api === DingtalkApprovalApiName.getTemplateSchema) {
      const fields = readSchemaFields(pluginState).slice(0, CONFIRM_VISIBLE_LINE_LIMIT);

      return (
        <ResultCard icon={FileText} meta={meta} title={cardTitle}>
          {fields.length === 0 ? (
            <span style={{ color: cssVar.colorTextTertiary, fontSize: 13 }}>
              {t('builtins.lobe-dingtalk-approval.ui.render.empty')}
            </span>
          ) : (
            <Flexbox gap={6}>
              {fields.map((field, index) => (
                <ResultRow
                  key={`${field.label}-${index}`}
                  meta={field.componentType}
                  title={field.label ?? unnamed.item}
                  tag={t(
                    field.required
                      ? 'builtins.lobe-dingtalk-approval.ui.render.required'
                      : 'builtins.lobe-dingtalk-approval.ui.render.optional',
                  )}
                />
              ))}
            </Flexbox>
          )}
        </ResultCard>
      );
    }

    const pairs = pickLabelValuePairs(pluginState, unnamed.mask, unnamed.item).slice(
      0,
      CONFIRM_VISIBLE_LINE_LIMIT,
    );

    return (
      <ResultCard meta={meta} title={cardTitle}>
        {pairs.length > 0 && (
          <Flexbox gap={6}>
            {pairs.map((pair, index) => (
              <ResultField key={`${pair.label}-${index}`} label={pair.label}>
                {pair.value}
              </ResultField>
            ))}
          </Flexbox>
        )}
      </ResultCard>
    );
  },
);

Detail.displayName = 'DingtalkApprovalDetail';

export default Detail;
