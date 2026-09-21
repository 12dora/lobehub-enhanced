'use client';

import { Alert } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveDingtalkErrorCode } from './previewError';

interface ErrorNoticeProps {
  error: unknown;
}

/**
 * Short, mapped failure message. Only the stable `DINGTALK_*` code reaches the
 * copy — upstream text never surfaces in the UI.
 */
const ErrorNotice = memo<ErrorNoticeProps>(({ error }) => {
  const { t } = useTranslation('plugin');
  const code = resolveDingtalkErrorCode(error);

  return (
    <Alert
      showIcon
      type={'error'}
      variant={'plain'}
      title={
        code
          ? t(`builtins.lobe-dingtalk-approval.ui.error.${code}` as const)
          : t('builtins.lobe-dingtalk-approval.ui.error.unknown')
      }
    />
  );
});

ErrorNotice.displayName = 'DingtalkApprovalErrorNotice';

export default ErrorNotice;
