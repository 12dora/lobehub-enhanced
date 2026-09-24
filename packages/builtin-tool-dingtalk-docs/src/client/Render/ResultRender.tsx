'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { isDingtalkDocsApiName } from '../apiNames';
import { AuthorizationRequired, ErrorNotice, FileResult } from '../components/shared';
import AitableBaseList from './AitableBaseList';
import AitableRecords from './AitableRecords';
import AitableSchema from './AitableSchema';
import AitableTableList from './AitableTableList';
import DocDetail from './DocDetail';
import DocList from './DocList';
import DriveFileList from './DriveFileList';
import SheetList from './SheetList';
import SheetRange from './SheetRange';
import type { DingtalkDocsRenderState } from './types';
import WikiNodeList from './WikiNodeList';
import WikiSpaceList from './WikiSpaceList';
import WriteResult from './WriteResult';

export type { DingtalkDocsRenderState } from './types';

/**
 * Single render for every lobe-dingtalk-docs API: the server projects each result into a
 * `kind`-tagged state (contract §E.3), so the view follows the state rather than the API name.
 * Unknown or missing states render nothing.
 */
const ResultRender = memo<BuiltinRenderProps<Record<string, unknown>, DingtalkDocsRenderState>>(
  ({ apiName, pluginError, pluginState }) => {
    const { t } = useTranslation('plugin');

    const state = pluginState && typeof pluginState === 'object' ? pluginState : undefined;

    // Checked before the error: an unauthorized call fails, and its state carries the way out —
    // the same inline authorize widget as the personal toolset, on the same authorization.
    if (state?.kind === 'authorizationRequired') return <AuthorizationRequired />;
    if (pluginError) return <ErrorNotice error={pluginError} state={state} />;
    if (!state) return null;

    const title = isDingtalkDocsApiName(apiName)
      ? t(`builtins.lobe-dingtalk-docs.apiName.${apiName}` as const)
      : t('builtins.lobe-dingtalk-docs.title');

    switch (state.kind) {
      case 'docs': {
        return <DocList state={state} title={title} />;
      }
      case 'doc': {
        return <DocDetail state={state} />;
      }
      case 'wikiSpaces': {
        return <WikiSpaceList state={state} title={title} />;
      }
      case 'wikiNodes': {
        return <WikiNodeList state={state} title={title} />;
      }
      case 'driveFiles': {
        return <DriveFileList state={state} title={title} />;
      }
      case 'file': {
        return <FileResult state={state} />;
      }
      case 'sheets': {
        return <SheetList state={state} title={title} />;
      }
      case 'sheetRange': {
        return <SheetRange state={state} title={title} />;
      }
      case 'aitableBases': {
        return <AitableBaseList state={state} title={title} />;
      }
      case 'aitableTables': {
        return <AitableTableList state={state} title={title} />;
      }
      case 'aitableSchema': {
        return <AitableSchema state={state} title={title} />;
      }
      case 'aitableRecords': {
        return <AitableRecords state={state} title={title} />;
      }
      case 'write': {
        return <WriteResult state={state} />;
      }
      default: {
        return null;
      }
    }
  },
);

ResultRender.displayName = 'DingtalkDocsResultRender';

export default ResultRender;
