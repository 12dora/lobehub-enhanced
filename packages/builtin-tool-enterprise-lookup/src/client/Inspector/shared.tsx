'use client';

import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

const styles = createStaticStyles(({ css, cssVar }) => ({
  scope: css`
    flex-shrink: 0;
    margin-inline-start: 6px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface EnterpriseLookupInspectorViewProps {
  capability?: string;
  isArgumentsStreaming?: boolean;
  isLoading?: boolean;
}

export const EnterpriseLookupInspectorView = memo<EnterpriseLookupInspectorViewProps>(
  ({ capability, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');

    return (
      <div
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <span>{t('builtins.lobe-enterprise-lookup.title')}</span>
        {capability && <span className={styles.scope}>· {capability}</span>}
      </div>
    );
  },
);

EnterpriseLookupInspectorView.displayName = 'EnterpriseLookupInspectorView';

type InspectorArgs = {
  capability?: string;
  category?: string;
};

type InspectorState = {
  capability?: string;
  category?: string;
};

export const buildInspectorCapability = (
  args: InspectorArgs | undefined,
  partialArgs: InspectorArgs | undefined,
  pluginState: InspectorState | undefined,
  fallback: string,
): string =>
  args?.capability ||
  partialArgs?.capability ||
  pluginState?.capability ||
  args?.category ||
  partialArgs?.category ||
  pluginState?.category ||
  fallback;
