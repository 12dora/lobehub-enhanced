'use client';

import { Block } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { EnterpriseLookupProvider } from '../../types';
import { EnterpriseResultView } from './ResultView';

const styles = createStaticStyles(({ css, cssVar }) => ({
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
  /** Rendered between the header and the result — the matched company, the candidate list. */
  children?: ReactNode;
  provider?: EnterpriseLookupProvider;
  /** The upstream payload as it arrived: MCP content, a JSON string, or markdown text. */
  result?: unknown;
  truncated?: boolean;
}

/**
 * The shared frame of every enterprise-lookup card: which provider answered, which capability was
 * asked, and the answer itself as a readable table rather than a blob of JSON.
 */
export const EnterpriseLookupRenderView = memo<EnterpriseLookupRenderViewProps>(
  ({ capability, children, provider, result, truncated }) => {
    const { t } = useTranslation('plugin');

    if (!provider && !capability && !children && result === undefined) return null;

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
        {children}
        {result !== undefined && <EnterpriseResultView result={result} />}
      </Block>
    );
  },
);

EnterpriseLookupRenderView.displayName = 'EnterpriseLookupRenderView';
