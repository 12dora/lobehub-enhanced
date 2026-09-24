'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  AuthRequiredState,
  FileState,
  GroupsState,
  ListMyTodosState,
  MessagesState,
  ReportDetailState,
  ReportsState,
  TemplatesState,
  TemplateState,
  TodoDetailState,
  WriteState,
} from '../../types';
import { isDingtalkPersonalApiName } from '../apiNames';
import ErrorNotice from '../components/ErrorNotice';
import AuthorizationRequired from './AuthorizationRequired';
import FileResult from './FileResult';
import GroupList from './GroupList';
import MessageList from './MessageList';
import ReportDetail from './ReportDetail';
import ReportList from './ReportList';
import TemplateDetail from './TemplateDetail';
import TemplateList from './TemplateList';
import TodoDetail from './TodoDetail';
import TodoList from './TodoList';
import WriteResult from './WriteResult';

/** Every projected state of contract §4; `kind` decides the view. */
export type DingtalkPersonalRenderState =
  | AuthRequiredState
  | FileState
  | GroupsState
  | ListMyTodosState
  | MessagesState
  | ReportDetailState
  | ReportsState
  | TemplatesState
  | TemplateState
  | TodoDetailState
  | WriteState;

/**
 * Single render for every lobe-dingtalk-personal API: the server projects each
 * result into a `kind`-tagged state, so the view follows the state rather than
 * the API name. Unknown or missing states render nothing.
 */
const ResultRender = memo<BuiltinRenderProps<Record<string, unknown>, DingtalkPersonalRenderState>>(
  ({ apiName, pluginError, pluginState }) => {
    const { t } = useTranslation('plugin');

    const state = pluginState && typeof pluginState === 'object' ? pluginState : undefined;

    // Checked before the error: an unauthorized call fails, and its state carries
    // the way out.
    if (state?.kind === 'authorizationRequired') return <AuthorizationRequired />;
    if (pluginError) return <ErrorNotice error={pluginError} />;
    if (!state) return null;

    const title = isDingtalkPersonalApiName(apiName)
      ? t(`builtins.lobe-dingtalk-personal.apiName.${apiName}` as const)
      : t('builtins.lobe-dingtalk-personal.title');

    switch (state.kind) {
      case 'todos': {
        return <TodoList state={state} title={title} />;
      }
      case 'todo': {
        return <TodoDetail state={state} />;
      }
      case 'groups': {
        return <GroupList state={state} title={title} />;
      }
      case 'messages': {
        return <MessageList state={state} title={title} />;
      }
      case 'file': {
        return <FileResult state={state} />;
      }
      case 'reports': {
        return <ReportList state={state} title={title} />;
      }
      case 'report': {
        return <ReportDetail state={state} />;
      }
      case 'templates': {
        return <TemplateList state={state} title={title} />;
      }
      case 'template': {
        return <TemplateDetail state={state} />;
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

ResultRender.displayName = 'DingtalkPersonalResultRender';

export default ResultRender;
