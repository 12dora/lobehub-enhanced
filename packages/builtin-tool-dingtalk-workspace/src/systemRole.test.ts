import { describe, expect, it } from 'vitest';

import { DingtalkWorkspaceManifest } from './manifest';
import { systemPrompt } from './systemRole';

describe('dingtalk workspace systemRole', () => {
  it('is attached to the manifest and is English', () => {
    expect(DingtalkWorkspaceManifest.systemRole).toBe(systemPrompt);
    expect(systemPrompt).toContain('You have DingTalk todo and calendar tools');
    expect(systemPrompt).not.toMatch(/你可以|请将返回/);
  });

  it('resolves relative dates against serverNow in Asia/Shanghai', () => {
    expect(systemPrompt).toContain('Asia/Shanghai');
    expect(systemPrompt).toContain('serverNow');
    expect(systemPrompt).toContain('下周三');
  });

  it('never guesses same-name colleagues and copies staff tokens verbatim', () => {
    expect(systemPrompt).toContain('姓名 · 部门');
    expect(systemPrompt).toContain('staff:<id>');
    expect(systemPrompt).toContain('verbatim');
    expect(systemPrompt).toContain('Never guess');
  });

  it('says only AIHub-created todos are listable and that writes confirm once', () => {
    expect(systemPrompt).toContain('only todos created through this AIHub tool');
    expect(systemPrompt).toContain('confirm card');
    expect(systemPrompt).toContain('never parallelize');
  });

  it('covers identity errors and disabled features', () => {
    expect(systemPrompt).toContain('DINGTALK_FEATURE_DISABLED');
    expect(systemPrompt).toContain('sign in with DingTalk');
    expect(systemPrompt).toContain('admins cannot bind');
  });

  it('keeps free/busy titles stripped and organizer-only updates', () => {
    expect(systemPrompt).toContain('busy/free blocks only');
    expect(systemPrompt).toContain('organizer only');
    expect(systemPrompt).toContain('queryFreeBusy');
    expect(systemPrompt).toContain('listMeetingRooms');
    expect(systemPrompt).toContain('dueTime=null');
    expect(systemPrompt).toContain('roomIds replaces');
  });
});
