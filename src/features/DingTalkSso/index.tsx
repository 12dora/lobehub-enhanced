'use client';

import { Center } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo, useEffect, useState } from 'react';

import { useBranding } from '@/enterprise/client/providers/RuntimeBrandingProvider';

import { DINGTALK_SSO_TIMEOUT_MS, readRedirectParam, runDingTalkSso } from './bridge';

/**
 * `/dingtalk/sso` — the bridge a DingTalk deep link lands on.
 *
 * It is a transit page, not a destination: it either exchanges the DingTalk auth code for a
 * session and continues to the requested path, or it gives up and sends the browser to the same
 * path so the normal login flow can run. Copy is Chinese-only on purpose — the page is only ever
 * reached from inside the DingTalk client.
 */
const DingTalkSsoPage = memo(() => {
  const { name: appName } = useBranding();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // One-way latch: whichever of the exchange and the timeout finishes first decides, and the
    // other becomes a no-op rather than navigating a second time.
    let done = false;
    const redirect = readRedirectParam(window.location.search);

    const go = (target: string, ok: boolean) => {
      if (done) return;
      done = true;
      if (!ok) setFailed(true);
      window.location.replace(target);
    };

    // A DingTalk client that never answers `requestAuthCode` would otherwise hang this page
    // forever; the login page is always a working way out.
    const timer = setTimeout(() => go(redirect, false), DINGTALK_SSO_TIMEOUT_MS);

    void runDingTalkSso({ redirect })
      .then((outcome) => go(outcome.redirect, outcome.status === 'signed-in'))
      .catch(() => go(redirect, false));

    return () => {
      done = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <Center padding={16} style={{ minHeight: '100dvh' }} width={'100%'}>
      <Text type="secondary">
        {failed ? '钉钉免登不可用，正在转到登录页' : `正在通过钉钉登录 ${appName}…`}
      </Text>
    </Center>
  );
});

DingTalkSsoPage.displayName = 'DingTalkSsoPage';

export default DingTalkSsoPage;
