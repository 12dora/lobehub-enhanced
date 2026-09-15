'use client';

import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './shared';

/**
 * DingTalk never mints a verify-im link token: the account link is created
 * server-side on the employee's first message to the robot. The generic
 * `/verify-im` route still resolves every messenger platform, so this body
 * exists only to explain that nothing needs confirming here.
 */
const DingTalkBody = memo(() => {
  const { t } = useTranslation('messenger');

  return (
    <Flexbox align="center" className={styles.card} gap={16}>
      <Text strong fontSize={16}>
        {t('messenger.dingtalk.verify.title')}
      </Text>
      <Text align="center" type="secondary">
        {t('messenger.dingtalk.verify.description')}
      </Text>
    </Flexbox>
  );
});

DingTalkBody.displayName = 'MessengerVerifyDingTalkBody';

export default DingTalkBody;
