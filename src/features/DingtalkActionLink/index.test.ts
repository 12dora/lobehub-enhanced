import { APP_LINK_PATHS, DINGTALK_CONSOLE_LINKS } from '@lobechat/utils/appLink';
import { describe, expect, it } from 'vitest';

import zhPlugin from '../../../locales/zh-CN/plugin.json';
import {
  DINGTALK_ACTION_PLUGIN_LABEL_KEY,
  extractDingtalkPatUri,
  resolveDingtalkAction,
  resolveDingtalkActionKind,
} from './index';

const PAT_URI = 'https://login.dingtalk.com/oauth2/pat/confirm?code=abc';

describe('resolveDingtalkAction', () => {
  it('sends an unbound or unverified member to the DingTalk binding page', () => {
    for (const code of ['DINGTALK_IDENTITY_UNBOUND', 'DINGTALK_IDENTITY_UNVERIFIED'])
      expect(resolveDingtalkAction(code)).toEqual({
        href: APP_LINK_PATHS.dingtalkBinding,
        kind: 'binding',
      });
  });

  it('points switches, CorpId and 服务号 problems at the admin IM connector tab', () => {
    for (const code of [
      'DINGTALK_PERSONAL_DISABLED',
      'DINGTALK_PERSONAL_FEATURE_DISABLED',
      'DINGTALK_PERSONAL_CORP_ID_MISSING',
      'DINGTALK_FEATURE_DISABLED',
      'DINGTALK_NOT_CONFIGURED',
      'DINGTALK_AUTOMATION_OFF',
    ])
      expect(resolveDingtalkAction(code)).toEqual({
        href: APP_LINK_PATHS.adminImConnectors,
        kind: 'adminImConnectors',
      });
  });

  it('points the org CLI policy at the DingTalk developer console', () => {
    for (const code of ['DINGTALK_PERSONAL_ORG_POLICY_DENIED', 'ORG_CLI_DISABLED'])
      expect(resolveDingtalkAction(code)).toEqual({
        href: DINGTALK_CONSOLE_LINKS.cliSettings,
        kind: 'cliSettings',
      });
  });

  it('re-opens the authorization for an expired or missing one', () => {
    expect(resolveDingtalkAction('DINGTALK_PERSONAL_EXPIRED')?.href).toBe(
      APP_LINK_PATHS.dingtalkPersonalAuthorize,
    );
    expect(resolveDingtalkAction('DINGTALK_PERSONAL_UNAUTHORIZED')?.kind).toBe('personalAuthorize');
  });

  it('sends a member at the rule limit to their approval rules', () => {
    expect(resolveDingtalkAction('DINGTALK_RULE_LIMIT')?.href).toBe(APP_LINK_PATHS.approvalRules);
  });

  it('offers DingTalk’s own permission page only when one came back over https', () => {
    expect(resolveDingtalkAction('DINGTALK_PERSONAL_PAT_REQUIRED', { patUri: PAT_URI })).toEqual({
      href: PAT_URI,
      kind: 'patConfirm',
    });
    expect(resolveDingtalkAction('DINGTALK_PERSONAL_PAT_REQUIRED')).toBeUndefined();
    expect(
      resolveDingtalkAction('DINGTALK_PERSONAL_PAT_REQUIRED', { patUri: 'http://x.example.com' }),
    ).toBeUndefined();
  });

  it('offers nothing where no page can fix it', () => {
    for (const code of [
      undefined,
      '',
      'DINGTALK_IDENTITY_INACTIVE',
      'DINGTALK_PREMIUM_REQUIRED',
      'DINGTALK_NOT_APPROVAL_ADMIN',
      'DINGTALK_RATE_LIMITED',
    ])
      expect(resolveDingtalkAction(code)).toBeUndefined();
    expect(resolveDingtalkActionKind('toString')).toBeUndefined();
  });

  it('has zh-CN copy for every label', () => {
    for (const key of Object.values(DINGTALK_ACTION_PLUGIN_LABEL_KEY))
      expect((zhPlugin as Record<string, string>)[key]).toBeTruthy();
  });
});

describe('extractDingtalkPatUri', () => {
  it('reads a structured uri from the error or the state', () => {
    expect(extractDingtalkPatUri({ body: { details: { uri: PAT_URI } } })).toBe(PAT_URI);
    expect(extractDingtalkPatUri(undefined, { uri: PAT_URI })).toBe(PAT_URI);
  });

  it('reads the https URL the tool wrote into its message', () => {
    expect(
      extractDingtalkPatUri({
        message: `该操作需要你在钉钉自己的权限页面上确认。这是钉钉自己的权限页面：${PAT_URI}（DINGTALK_PERSONAL_PAT_REQUIRED）`,
      }),
    ).toBe(PAT_URI);
    expect(extractDingtalkPatUri(`请确认：[去确认](${PAT_URI})`)).toBe(PAT_URI);
  });

  describe('tRPC client errors', () => {
    const OPEN_PAT_URI = 'https://open.dingtalk.com/pat/confirm?ticket=abc';

    /** What `TRPCClientError` carries: the lambda formatter puts `cause.data` under `errorData`. */
    const trpcError = (details: Record<string, unknown>) =>
      Object.assign(new Error('DINGTALK_PERSONAL_PAT_REQUIRED'), {
        data: {
          code: 'BAD_REQUEST',
          errorData: { code: 'DINGTALK_PERSONAL_PAT_REQUIRED', details },
          httpStatus: 400,
        },
      });

    it('reads the uri from data.errorData.details', () => {
      expect(
        extractDingtalkPatUri({
          data: {
            code: 'BAD_REQUEST',
            errorData: { code: 'DINGTALK_PERSONAL_PAT_REQUIRED', details: { uri: OPEN_PAT_URI } },
          },
          message: 'DINGTALK_PERSONAL_PAT_REQUIRED',
        }),
      ).toBe(OPEN_PAT_URI);
      expect(extractDingtalkPatUri(trpcError({ uri: OPEN_PAT_URI }))).toBe(OPEN_PAT_URI);
    });

    it('reads the https URL written into data.errorData.details.message', () => {
      expect(
        extractDingtalkPatUri(
          trpcError({ message: `这是钉钉自己的权限页面：[打开权限页面](${OPEN_PAT_URI})` }),
        ),
      ).toBe(OPEN_PAT_URI);
    });

    it('still finds it when the error is wrapped once more', () => {
      expect(extractDingtalkPatUri({ error: trpcError({ uri: OPEN_PAT_URI }) })).toBe(OPEN_PAT_URI);
    });

    it('ignores non-https links under data.errorData', () => {
      expect(
        extractDingtalkPatUri(trpcError({ uri: 'http://open.dingtalk.com/pat' })),
      ).toBeUndefined();
      expect(extractDingtalkPatUri(trpcError({ uri: 'javascript:alert(1)' }))).toBeUndefined();
      expect(
        extractDingtalkPatUri(trpcError({ message: '权限页面：http://open.dingtalk.com/pat' })),
      ).toBeUndefined();
    });
  });

  it('ignores non-https links', () => {
    expect(extractDingtalkPatUri({ uri: 'javascript:alert(1)' })).toBeUndefined();
    expect(extractDingtalkPatUri({ message: 'see http://x.example.com/a' })).toBeUndefined();
    expect(extractDingtalkPatUri(undefined, null, 42)).toBeUndefined();
  });
});
