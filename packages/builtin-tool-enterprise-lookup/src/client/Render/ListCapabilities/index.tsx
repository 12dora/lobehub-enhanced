'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ListCapabilitiesParams, ListCapabilitiesState } from '../../../types';
import { isEnterpriseLookupProvider } from '../../../types';
import { EnterpriseLookupRenderView } from '../shared';

export const ListCapabilitiesRender = memo<
  BuiltinRenderProps<ListCapabilitiesParams, ListCapabilitiesState>
>(({ args, pluginState }) => {
  const { t } = useTranslation('plugin');
  const provider = pluginState?.provider ?? args?.provider;
  const capability =
    pluginState?.category ??
    args?.category ??
    t('builtins.lobe-enterprise-lookup.inspector.capabilities');

  return (
    <EnterpriseLookupRenderView
      capability={capability}
      provider={isEnterpriseLookupProvider(provider) ? provider : undefined}
      resultText={pluginState?.resultText}
      truncated={pluginState?.truncated}
    />
  );
});

ListCapabilitiesRender.displayName = 'ListCapabilitiesRender';

export default ListCapabilitiesRender;
