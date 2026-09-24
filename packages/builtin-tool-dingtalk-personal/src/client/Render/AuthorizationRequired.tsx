'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AuthorizeCard } from '@/features/DingtalkPersonal/AuthorizeCard';

import { ResultNote } from '../components/ResultCard';

/**
 * `authorizationRequired` result: the inline authorize widget. It owns the whole
 * device-code login (including a login the DingTalk bot already started), so the
 * `login` carried by the state is not needed here.
 */
const AuthorizationRequired = memo(() => {
  const { t } = useTranslation('plugin');
  const [authorized, setAuthorized] = useState(false);

  return (
    <Flexbox gap={6} width={'100%'}>
      <AuthorizeCard compact onAuthorized={() => setAuthorized(true)} />
      {authorized && (
        <ResultNote>{t('builtins.lobe-dingtalk-personal.render.auth.askAgain')}</ResultNote>
      )}
    </Flexbox>
  );
});

AuthorizationRequired.displayName = 'DingtalkPersonalAuthorizationRequired';

export default AuthorizationRequired;
