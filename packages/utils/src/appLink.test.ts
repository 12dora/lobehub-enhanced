import { describe, expect, it } from 'vitest';

import {
  adminEntrySuffix,
  APP_LINK_PATHS,
  buildAppUrl,
  buildDingTalkAppUrl,
  cliSettingsMarkdownLink,
  createAppLinkResolver,
  dingtalkIdentityGuidance,
  identitySignInPath,
  imConnectorAdminLink,
  linkedPath,
  markdownLink,
  normalizeAppOrigin,
  oaAdminMarkdownLink,
  resolveAppLink,
} from './appLink';

describe('appLink', () => {
  it('normalizes the origin', () => {
    expect(normalizeAppOrigin(' https://chat.example.com// ')).toBe('https://chat.example.com');
    expect(normalizeAppOrigin(undefined)).toBe('');
  });

  it('joins app paths and keeps them relative without an origin', () => {
    expect(buildAppUrl('https://chat.example.com/', '/settings/connector')).toBe(
      'https://chat.example.com/settings/connector',
    );
    expect(buildAppUrl('', '/settings/connector')).toBe('/settings/connector');
    expect(buildAppUrl('https://chat.example.com', 'https://open-dev.dingtalk.com/')).toBe(
      'https://open-dev.dingtalk.com/',
    );
  });

  it('does not join protocol-relative or backslash paths', () => {
    expect(buildAppUrl('https://chat.example.com', '//evil.example')).toBe('//evil.example');
    expect(buildAppUrl('https://chat.example.com', '/\\evil.example')).toBe('/\\evil.example');
  });

  it('wraps DingTalk links with the SSO bridge once', () => {
    expect(buildDingTalkAppUrl('https://chat.example.com', APP_LINK_PATHS.adminImConnectors)).toBe(
      'https://chat.example.com/dingtalk/sso?redirect=%2Fadmin%2Fsystem%2Fgeneral%3Ftab%3Dim-connectors',
    );
    expect(buildDingTalkAppUrl('https://chat.example.com', '/dingtalk/sso?redirect=%2F')).toBe(
      'https://chat.example.com/dingtalk/sso?redirect=%2F',
    );
    expect(buildDingTalkAppUrl('https://chat.example.com', 'https://oa.dingtalk.com/')).toBe(
      'https://oa.dingtalk.com/',
    );
  });

  it('resolves by platform and builds markdown links', () => {
    expect(resolveAppLink({ origin: 'https://c.example', platform: 'web' }, '/downloads')).toBe(
      'https://c.example/downloads',
    );
    const resolve = createAppLinkResolver({ origin: 'https://c.example', platform: 'dingtalk' });
    expect(resolve('/downloads')).toBe('https://c.example/dingtalk/sso?redirect=%2Fdownloads');
    expect(markdownLink('前往', 'https://c.example/x')).toBe('[前往](https://c.example/x)');
    expect(linkedPath(undefined, '技能页', APP_LINK_PATHS.skills)).toBe(
      '[技能页](/settings/skill)',
    );
    expect(linkedPath((path) => `https://c.example${path}`, '积分', APP_LINK_PATHS.credits)).toBe(
      '[积分](https://c.example/settings/credits)',
    );
  });

  it('keeps the manual-action paths', () => {
    expect(APP_LINK_PATHS.credits).toBe('/settings/credits');
    expect(APP_LINK_PATHS.plans).toBe('/settings/plans');
    expect(APP_LINK_PATHS.devices).toBe('/settings/devices');
    expect(APP_LINK_PATHS.downloads).toBe('/downloads');
    expect(APP_LINK_PATHS.adminSkills).toBe('/admin/skills');
  });

  it('points identity, admin, and DingTalk console links at the right page', () => {
    expect(identitySignInPath(undefined)).toBe(APP_LINK_PATHS.dingtalkBinding);
    expect(identitySignInPath('dingtalk')).toBe('/');
    expect(dingtalkIdentityGuidance(undefined)).toBe(
      `请先用钉钉登录本平台（[用钉钉登录](${APP_LINK_PATHS.dingtalkBinding})），或在钉钉里给机器人发一条消息完成绑定`,
    );
    const dingtalk = createAppLinkResolver({
      origin: 'https://chat.example.com',
      platform: 'dingtalk',
    });
    expect(dingtalkIdentityGuidance(dingtalk, 'dingtalk')).toBe(
      '请先用钉钉登录本平台（[用钉钉登录](https://chat.example.com/dingtalk/sso?redirect=%2F)），或在钉钉里给机器人发一条消息完成绑定',
    );
    expect(imConnectorAdminLink()).toBe(`[IM 连接器设置](${APP_LINK_PATHS.adminImConnectors})`);
    expect(adminEntrySuffix()).toBe(
      `（管理员入口：[IM 连接器设置](${APP_LINK_PATHS.adminImConnectors})）`,
    );
    expect(oaAdminMarkdownLink()).toBe('[钉钉管理后台](https://oa.dingtalk.com/)');
    expect(cliSettingsMarkdownLink()).toBe(
      '[CLI 设置](https://open-dev.dingtalk.com/fe/old#/developerSettings)',
    );
    expect(cliSettingsMarkdownLink()).not.toMatch(/\]\(<http/);
  });
});
