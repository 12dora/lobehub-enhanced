import { describe, expect, it, vi } from 'vitest';

import { buildBlockedToolResponse } from './connectorPermissionCheck';
import {
  blockedToolMessage,
  orgDisabledToolDescription,
  userDisabledToolDescription,
} from './disabledToolText';

// Only the pure response builder is under test; keep the DB models out.
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/models/connectorTool', () => ({ ConnectorToolModel: vi.fn() }));

const absolute = (path: string) => `https://aihub.example.com${path}`;

describe('disabled tool copy', () => {
  it('links a user-disabled tool to the user connector settings', () => {
    const text = userDisabledToolDescription('gmail_send');

    expect(text).toContain('[TOOL DISABLED]');
    expect(text).toContain('"gmail_send"');
    expect(text).toContain('[设置 → 连接器](/settings/connector)');
  });

  it('links an org-disabled tool to the admin connectors page', () => {
    const text = orgDisabledToolDescription('createTask');

    expect(text).toContain('organization');
    expect(text).toContain('[管理后台 → 连接器](/admin/ai/connectors)');
    expect(text).not.toContain('/settings/connector');
  });

  it('never uses the angle-bracket destination DingTalk markdown cannot render', () => {
    for (const text of [
      userDisabledToolDescription('a', absolute),
      orgDisabledToolDescription('a', absolute),
      blockedToolMessage('a', { resolveLink: absolute }),
      blockedToolMessage('a', { byOrgPolicy: true, resolveLink: absolute }),
    ]) {
      expect(text).not.toContain('](<');
      expect(text).toMatch(/\]\(https:\/\/aihub\.example\.com\/(settings|admin)\//);
    }
  });
});

describe('buildBlockedToolResponse', () => {
  it('points the user at their own connector settings by default', () => {
    const response = buildBlockedToolResponse('deploy');

    expect(response.success).toBe(true);
    expect(response.content).toContain('"deploy" has been disabled by the user');
    expect(response.content).toContain('[设置 → 连接器](/settings/connector)');
    expect(response.state.content[0].text).toBe(response.content);
  });

  it('points at the admin connectors page when the org policy blocked it', () => {
    const response = buildBlockedToolResponse('createTask', {
      byOrgPolicy: true,
      resolveLink: absolute,
    });

    expect(response.content).toContain("organization's connector policy");
    expect(response.content).toContain(
      '[管理后台 → 连接器](https://aihub.example.com/admin/ai/connectors)',
    );
  });
});
