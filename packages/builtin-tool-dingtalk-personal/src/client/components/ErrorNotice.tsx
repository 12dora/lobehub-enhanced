'use client';

import { Alert } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveDingtalkPersonalErrorCode } from './errorCode';

interface ErrorNoticeProps {
  error: unknown;
}

/**
 * Short, mapped failure message. Only the stable code reaches the copy —
 * upstream text never surfaces in the UI.
 */
const ErrorNotice = memo<ErrorNoticeProps>(({ error }) => {
  const { t } = useTranslation('plugin');
  const code = resolveDingtalkPersonalErrorCode(error);

  return (
    <Alert
      showIcon
      type={'error'}
      variant={'plain'}
      title={
        code
          ? t(`builtins.lobe-dingtalk-personal.render.error.${code}` as const)
          : t('builtins.lobe-dingtalk-personal.render.error.unknown')
      }
    />
  );
});

ErrorNotice.displayName = 'DingtalkPersonalErrorNotice';

export default ErrorNotice;
