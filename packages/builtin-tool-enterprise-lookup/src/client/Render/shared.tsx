'use client';

import { Block } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { EnterpriseLookupProvider } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    margin: 0;
    padding: 10px 12px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorText};
    word-break: break-word;
    white-space: pre-wrap;
  `,
  details: css`
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    & > summary {
      cursor: pointer;
      user-select: none;

      padding-block: 8px;
      padding-inline: 12px;

      font-size: 12px;
      color: ${cssVar.colorTextSecondary};

      list-style: none;

      &::-webkit-details-marker {
        display: none;
      }
    }
  `,
  header: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 12px;
  `,
  title: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  truncated: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

const PROVIDER_KEY: Record<EnterpriseLookupProvider, string> = {
  qcc: 'builtins.lobe-enterprise-lookup.render.provider.qcc',
  tianyancha: 'builtins.lobe-enterprise-lookup.render.provider.tianyancha',
};

export interface EnterpriseLookupRenderViewProps {
  capability?: string;
  provider?: EnterpriseLookupProvider;
  resultText?: string;
  truncated?: boolean;
}

export const EnterpriseLookupRenderView = memo<EnterpriseLookupRenderViewProps>(
  ({ capability, provider, resultText, truncated }) => {
    const { t } = useTranslation('plugin');

    if (!provider && !capability && !resultText) return null;

    return (
      <Block variant={'outlined'} width={'100%'}>
        <div className={styles.header}>
          {provider && (
            <Tag size={'small'}>{t(PROVIDER_KEY[provider], { defaultValue: provider })}</Tag>
          )}
          {capability && <Text className={styles.title}>{capability}</Text>}
          {truncated && (
            <span className={styles.truncated}>
              {t('builtins.lobe-enterprise-lookup.render.truncated')}
            </span>
          )}
        </div>
        {resultText && (
          <details className={styles.details}>
            <summary>{t('builtins.lobe-enterprise-lookup.render.result')}</summary>
            <pre className={styles.body}>{resultText}</pre>
          </details>
        )}
      </Block>
    );
  },
);

EnterpriseLookupRenderView.displayName = 'EnterpriseLookupRenderView';
