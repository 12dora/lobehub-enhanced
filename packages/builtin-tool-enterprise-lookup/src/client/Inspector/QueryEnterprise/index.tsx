'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { memo } from 'react';

import type { QueryEnterpriseParams, QueryEnterpriseState } from '../../../types';
import { buildInspectorCapability, EnterpriseLookupInspectorView } from '../shared';

export const QueryEnterpriseInspector = memo<
  BuiltinInspectorProps<QueryEnterpriseParams, QueryEnterpriseState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const capability = buildInspectorCapability(args, partialArgs, pluginState, '');

  return (
    <EnterpriseLookupInspectorView
      capability={capability || undefined}
      isArgumentsStreaming={isArgumentsStreaming}
      isLoading={isLoading}
    />
  );
});

QueryEnterpriseInspector.displayName = 'QueryEnterpriseInspector';
