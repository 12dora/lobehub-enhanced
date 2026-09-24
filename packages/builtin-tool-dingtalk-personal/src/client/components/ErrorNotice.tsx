'use client';

import { Alert } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { extractDingtalkPatUri, resolveDingtalkAction } from '@/features/DingtalkActionLink';
import DingtalkErrorAction from '@/features/DingtalkActionLink/DingtalkErrorAction';

import { resolveDingtalkPersonalErrorCode } from './errorCode';

interface ErrorNoticeProps {
  error: unknown;
  /** The tool state, when the failure carried one (e.g. DingTalk's permission page for PAT). */
  state?: unknown;
}

/**
 * Short, mapped failure message plus the one-click link to where it is fixed. Only the stable code
 * reaches the copy — upstream text never surfaces in the UI.
 */
const ErrorNotice = memo<ErrorNoticeProps>(({ error, state }) => {
  const { t } = useTranslation('plugin');
  const code = resolveDingtalkPersonalErrorCode(error);
  const action = resolveDingtalkAction(code, {
    patUri:
      code === 'DINGTALK_PERSONAL_PAT_REQUIRED' ? extractDingtalkPatUri(error, state) : undefined,
  });

  return (
    <Alert
      showIcon
      description={action ? <DingtalkErrorAction action={action} /> : undefined}
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
