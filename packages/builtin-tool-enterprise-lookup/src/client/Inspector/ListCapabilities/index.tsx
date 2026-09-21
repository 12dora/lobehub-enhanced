'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ListCapabilitiesParams, ListCapabilitiesState } from '../../../types';
import { buildInspectorCapability, EnterpriseLookupInspectorView } from '../shared';

export const ListCapabilitiesInspector = memo<
  BuiltinInspectorProps<ListCapabilitiesParams, ListCapabilitiesState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');
  const capability = buildInspectorCapability(
    args,
    partialArgs,
    pluginState,
    t('builtins.lobe-enterprise-lookup.inspector.capabilities'),
  );

  return (
    <EnterpriseLookupInspectorView
      capability={capability}
      isArgumentsStreaming={isArgumentsStreaming}
      isLoading={isLoading}
    />
  );
});

ListCapabilitiesInspector.displayName = 'ListCapabilitiesInspector';
