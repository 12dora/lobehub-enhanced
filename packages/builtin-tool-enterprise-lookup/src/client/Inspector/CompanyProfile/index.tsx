'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { memo } from 'react';

import type { CompanyProfileParams } from '../../../types';
import type { CompanyProfileRenderState } from '../../Render/CompanyProfile';
import { EnterpriseLookupInspectorView } from '../shared';

/**
 * 企业查询 · <公司名>.
 *
 * The company being looked up is the only thing worth naming in the collapsed row, and it is known
 * from the arguments while they stream, so the line does not change shape once the answer lands.
 */
export const CompanyProfileInspector = memo<
  BuiltinInspectorProps<CompanyProfileParams, CompanyProfileRenderState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const capability =
    pluginState?.company?.name?.trim() || args?.name?.trim() || partialArgs?.name?.trim() || '';

  return (
    <EnterpriseLookupInspectorView
      capability={capability || undefined}
      isArgumentsStreaming={isArgumentsStreaming}
      isLoading={isLoading}
    />
  );
});

CompanyProfileInspector.displayName = 'CompanyProfileInspector';
