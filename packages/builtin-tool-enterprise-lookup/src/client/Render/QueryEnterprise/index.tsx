'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';

import type { QueryEnterpriseParams, QueryEnterpriseState } from '../../../types';
import { isEnterpriseLookupProvider } from '../../../types';
import { EnterpriseLookupRenderView } from '../shared';

export const QueryEnterpriseRender = memo<
  BuiltinRenderProps<QueryEnterpriseParams, QueryEnterpriseState>
>(({ args, pluginState }) => {
  const provider = pluginState?.provider ?? args?.provider;
  const capability = pluginState?.capability ?? args?.capability;

  return (
    <EnterpriseLookupRenderView
      capability={capability}
      provider={isEnterpriseLookupProvider(provider) ? provider : undefined}
      result={pluginState?.resultText}
      truncated={pluginState?.truncated}
    />
  );
});

QueryEnterpriseRender.displayName = 'QueryEnterpriseRender';

export default QueryEnterpriseRender;
