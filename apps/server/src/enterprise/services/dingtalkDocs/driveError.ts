import { DingtalkPersonalError } from '@/server/enterprise/services/dingtalkPersonal/errors';

const messageOf = (error: DingtalkPersonalError): string => {
  const message = error.details?.message;
  return typeof message === 'string' ? message : '';
};

const ONLINE_NODE_HINT =
  '该节点是在线表格或在线文档，不能直接下载。在线表格请用 readSheet，在线文档请用 readDoc（DINGTALK_PERSONAL_INVALID_ARGS）。';

/**
 * axls / alidoc nodes fail the download with exit 1. Tell the model which read
 * API to use instead of repeating the upstream getRange wording.
 */
export const rewriteDriveDownloadError = (error: unknown): unknown => {
  if (!(error instanceof DingtalkPersonalError)) return error;
  if (
    error.code !== 'DINGTALK_PERSONAL_UPSTREAM' &&
    error.code !== 'DINGTALK_PERSONAL_INVALID_ARGS'
  ) {
    return error;
  }
  const message = messageOf(error);
  if (
    (/readSheet/.test(message) && /readDoc/.test(message)) ||
    /在线表格或在线文档/.test(message)
  ) {
    return new DingtalkPersonalError('DINGTALK_PERSONAL_INVALID_ARGS', {
      message: ONLINE_NODE_HINT,
    });
  }
  if (/axls|在线表格|钉钉表格/.test(message)) {
    return new DingtalkPersonalError('DINGTALK_PERSONAL_INVALID_ARGS', {
      message:
        '该节点是在线表格，不能直接下载。请改用 readSheet（DINGTALK_PERSONAL_INVALID_ARGS）。',
    });
  }
  if (/alidoc|在线文档|钉钉文档/.test(message)) {
    return new DingtalkPersonalError('DINGTALK_PERSONAL_INVALID_ARGS', {
      message: '该节点是在线文档，不能直接下载。请改用 readDoc（DINGTALK_PERSONAL_INVALID_ARGS）。',
    });
  }
  return error;
};
