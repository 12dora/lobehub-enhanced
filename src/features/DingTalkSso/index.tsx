'use client';

import { Center } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo, useEffect, useState } from 'react';

import { useBranding } from '@/enterprise/client/providers/RuntimeBrandingProvider';

import {
  DINGTALK_SSO_TIMEOUT_MS,
  type DingTalkSsoStage,
  readDingTalkPlatform,
  readRedirectParam,
  runDingTalkSso,
  sendDingTalkSsoDiag,
} from './bridge';

/**
 * `/dingtalk/sso` — the bridge a DingTalk deep link lands on.
 *
 * It is a transit page, not a destination: it either exchanges the DingTalk auth code for a
 * session and continues to the requested path, or it gives up and sends the browser to the same
 * path so the normal login flow can run. Copy is Chinese-only on purpose — the page is only ever
 * reached from inside the DingTalk client.
 *
 * When it gives up, the stage that failed is both beaconed to the server and shown to the user:
 * a screenshot from a phone is often the only report we get.
 */
const DingTalkSsoPage = memo(() => {
  const { name: appName } = useBranding();
  const [failedStage, setFailedStage] = useState<DingTalkSsoStage | null>(null);

  useEffect(() => {
    // One-way latch: whichever of the exchange and the timeout finishes first decides, and the
    // other becomes a no-op rather than navigating a second time.
    let done = false;
    const redirect = readRedirectParam(window.location.search);

    const go = (target: string, stage: DingTalkSsoStage) => {
      if (done) return;
      done = true;
      if (stage !== 'success') setFailedStage(stage);
      window.location.replace(target);
    };

    // A DingTalk client that never answers the JSAPI would otherwise hang this page forever; the
    // login page is always a working way out. The bridge reports its own stages, so this beacon
    // only covers the case where it never came back at all.
    const timer = setTimeout(() => {
      sendDingTalkSsoDiag({ platform: readDingTalkPlatform(), stage: 'timeout' });
      go(redirect, 'timeout');
    }, DINGTALK_SSO_TIMEOUT_MS);

    void runDingTalkSso({ redirect })
      .then((outcome) => go(outcome.redirect, outcome.stage))
      .catch((error: unknown) => {
        // The bridge is written never to throw; if it does, that is itself worth a log line.
        sendDingTalkSsoDiag({
          message: error instanceof Error ? error.message : 'bridge_threw',
          platform: readDingTalkPlatform(),
          stage: 'page_error',
        });
        go(redirect, 'page_error');
      });

    return () => {
      done = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <Center padding={16} style={{ minHeight: '100dvh' }} width={'100%'}>
      <Text type="secondary">
        {failedStage
          ? `钉钉免登不可用（${failedStage}），正在转到登录页`
          : `正在通过钉钉登录 ${appName}…`}
      </Text>
    </Center>
  );
});

DingTalkSsoPage.displayName = 'DingTalkSsoPage';

export default DingTalkSsoPage;
