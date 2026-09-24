import { describe, expect, it } from 'vitest';

import {
  blockedConnectorToolMessage,
  desktopDeviceRequiredMessage,
  managedSkillRunFailedMessage,
  managedSkillUnavailableMessage,
} from './appLinks';

describe('manual action links', () => {
  it('points a user-disabled tool at connector settings', () => {
    const text = blockedConnectorToolMessage('search', { governed: false });
    expect(text).toContain('[连接器设置](');
    expect(text).toContain('/settings/connector');
    expect(text).not.toContain('/admin/ai/connectors');
  });

  it('points an org-disabled tool at the admin connectors page', () => {
    const text = blockedConnectorToolMessage('search', { governed: true, platform: 'dingtalk' });
    expect(text).toContain('请联系管理员');
    expect(text).toContain('[连接器管理](');
    expect(text).toContain('/dingtalk/sso?redirect=');
    expect(text).toContain(encodeURIComponent('/admin/ai/connectors'));
  });

  it('links a desktop-only integration to devices and downloads', () => {
    const text = desktopDeviceRequiredMessage();
    expect(text).toContain('[设备页](');
    expect(text).toContain('/settings/devices');
    expect(text).toContain('[下载桌面端](');
    expect(text).toContain('/downloads');
  });

  it('tells the user to ask an admin and links the skills admin page', () => {
    expect(managedSkillRunFailedMessage()).toContain('[技能管理](');
    expect(managedSkillUnavailableMessage()).toContain('/admin/skills');
    expect(managedSkillRunFailedMessage()).toContain('请联系管理员');
  });
});
