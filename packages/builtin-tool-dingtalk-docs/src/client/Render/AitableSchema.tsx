'use client';

import { Tag } from '@lobehub/ui/base-ui';
import { Columns3 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  asRows,
  asText,
  cardStyles,
  ExpandableList,
  RESULT_VISIBLE_ROW_LIMIT,
  ResultCard,
  ResultNote,
} from '../components/shared';
import type { AitableSchemaState } from './types';

type FieldItem = AitableSchemaState['fields'][number];

/** Field types with a Chinese name; any other type shows as dws spells it. */
export const AITABLE_FIELD_TYPES = [
  'attachment',
  'checkbox',
  'date',
  'multipleSelect',
  'number',
  'singleSelect',
  'text',
  'url',
  'user',
] as const;

type KnownFieldType = (typeof AITABLE_FIELD_TYPES)[number];

const isKnownFieldType = (value: unknown): value is KnownFieldType =>
  (AITABLE_FIELD_TYPES as readonly unknown[]).includes(value);

/**
 * `getAitableSchema` result: every field of the table with its type, in table order — what the
 * assistant maps names to field ids with before a write.
 */
const AitableSchema = memo<{ state: AitableSchemaState; title: string }>(({ state, title }) => {
  const { t } = useTranslation('plugin');
  const fields = asRows<FieldItem>(state.fields);

  return (
    <ResultCard
      icon={Columns3}
      title={asText(state.tableName) ?? title}
      meta={
        fields.length > 0
          ? t('builtins.lobe-dingtalk-docs.render.aitableSchema.fieldCount', {
              count: fields.length,
            })
          : undefined
      }
    >
      {fields.length === 0 ? (
        <ResultNote>{t('builtins.lobe-dingtalk-docs.render.aitableSchema.empty')}</ResultNote>
      ) : (
        <ExpandableList
          items={fields}
          limit={RESULT_VISIBLE_ROW_LIMIT}
          renderItem={(field, index) => {
            const type = asText(field.type);
            const name = asText(field.name) ?? t('builtins.lobe-dingtalk-docs.render.untitled');

            return (
              <div className={cardStyles.row} key={asText(field.fieldId) ?? String(index)}>
                <span className={cardStyles.rowTitle} title={name}>
                  {name}
                </span>
                {type && (
                  <Tag className={cardStyles.actionTag} size={'small'}>
                    {isKnownFieldType(type)
                      ? t(`builtins.lobe-dingtalk-docs.render.fieldType.${type}` as const)
                      : type}
                  </Tag>
                )}
              </div>
            );
          }}
        />
      )}
    </ResultCard>
  );
});

AitableSchema.displayName = 'DingtalkDocsAitableSchema';

export default AitableSchema;
