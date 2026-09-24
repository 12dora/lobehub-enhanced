/**
 * The building blocks this toolset shares with `lobe-dingtalk-personal`: it runs on the same
 * member authorization and the same service, so it fails with the same stable codes and shows
 * them with the same notice, cards and authorize widget.
 */
export {
  asDingtalkPersonalRows as asRows,
  asDingtalkPersonalText as asText,
  DingtalkPersonalAuthorizationRequiredRender as AuthorizationRequired,
  dingtalkPersonalCardStyles as cardStyles,
  DINGTALK_PERSONAL_CONFIRM_VISIBLE_LINE_LIMIT as CONFIRM_VISIBLE_LINE_LIMIT,
  DingtalkPersonalErrorNotice as ErrorNotice,
  DingtalkPersonalExpandableList as ExpandableList,
  DingtalkPersonalExternalAction as ExternalAction,
  DingtalkPersonalFileRender as FileResult,
  formatDingtalkPersonalDateTime as formatDateTime,
  formatDingtalkPersonalFileSize as formatFileSize,
  resolveDingtalkPersonalErrorCode,
  resolveDingtalkPersonalPreviewErrorDetail as resolvePreviewErrorDetail,
  DINGTALK_PERSONAL_RESULT_VISIBLE_ROW_LIMIT as RESULT_VISIBLE_ROW_LIMIT,
  DingtalkPersonalResultCard as ResultCard,
  DingtalkPersonalResultNote as ResultNote,
  toDingtalkPersonalSafeHref as toSafeHref,
} from '@lobechat/builtin-tool-dingtalk-personal/client';
