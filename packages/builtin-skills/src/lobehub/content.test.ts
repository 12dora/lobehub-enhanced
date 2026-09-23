import { describe, expect, it } from 'vitest';

import { LobeHubSkill } from './index';
import bot from './references/bot';

describe('lobehub skill channel guidance', () => {
  it('names 钉钉, routes reminders to lobe-reminder, and does not send platform ops through lh', () => {
    expect(LobeHubSkill.description).toContain('钉钉');
    expect(LobeHubSkill.description).toContain('lobe-reminder');
    expect(LobeHubSkill.content).toContain('钉钉');
    expect(LobeHubSkill.content).toContain('lobe-reminder');
    expect(LobeHubSkill.content).toContain('催交');
    expect(LobeHubSkill.content).toContain('does not include `lh`');
    expect(LobeHubSkill.content).toContain('外部终端（桌面端/本地 CLI）参考，沙箱内不可用');

    const inChat = LobeHubSkill.content.split('外部终端（桌面端/本地 CLI）参考，沙箱内不可用')[0];
    expect(inChat).toContain('lobe-knowledge-base');
    expect(inChat).toContain('listKnowledgeBases');
    expect(inChat).toContain('createDocument');
    expect(inChat).toContain('lobe-agent-management');
    expect(inChat).toContain('callAgent');
    expect(inChat).toContain('lobe-image-designer');
    expect(inChat).toContain('text2image');
    expect(inChat).not.toContain('lh kb list');
    expect(inChat).not.toContain('lh kb create-doc');
    expect(inChat).not.toContain('lh gen image');
    expect(inChat).not.toContain('lh agent run');

    expect(bot).toContain('钉钉');
    expect(bot).toContain('lobe-reminder');
    expect(bot).not.toContain('lh bot message read` with');
  });
});
