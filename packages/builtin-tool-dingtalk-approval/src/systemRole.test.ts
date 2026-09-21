import { describe, expect, it } from 'vitest';

import { DingtalkApprovalManifest } from './manifest';
import { systemPrompt } from './systemRole';

describe('dingtalk approval systemRole', () => {
  it('is attached to the manifest and written in English', () => {
    expect(DingtalkApprovalManifest.systemRole).toBe(systemPrompt);
    expect(systemPrompt).toMatch(/You can read and act/);
    expect(systemPrompt).not.toMatch(/你可以/);
  });

  it('enforces asking instead of guessing', () => {
    expect(systemPrompt).toContain('ask the user first');
    expect(systemPrompt).toContain('Never guess');
    expect(systemPrompt).toContain('Never fill required form fields with invented values');
  });

  it('tells the model not to restate writes and to call once', () => {
    expect(systemPrompt).toContain('confirm card');
    expect(systemPrompt).toContain('Call the write API once');
  });

  it('forbids parallel batch approvals', () => {
    expect(systemPrompt).toContain('one call per task');
    expect(systemPrompt).toContain('never in parallel');
  });

  it('requires a reason for refuse and return', () => {
    expect(systemPrompt).toContain('refuseTask and returnTask need a reason');
  });

  it('describes compiling rule conditions from the schema', () => {
    expect(systemPrompt).toContain('structured conditions');
    expect(systemPrompt).toContain('getTemplateSchema');
    expect(systemPrompt).toContain('Ask when a condition cannot be expressed structurally');
  });

  it('explains premium-only and unsupported OpenAPI actions', () => {
    expect(systemPrompt).toContain('催办');
    expect(systemPrompt).toContain('no OpenAPI');
    expect(systemPrompt).toContain('OA premium');
    expect(systemPrompt).toContain('returnTask');
    expect(systemPrompt).toContain('addApprover');
  });

  it('tells the user to sign in with DingTalk on identity errors', () => {
    expect(systemPrompt).toContain('sign in with DingTalk');
    expect(systemPrompt).toContain('DingTalk robot');
    expect(systemPrompt).toContain('Admins cannot bind on their behalf');
  });

  it('uses staff tokens copied verbatim', () => {
    expect(systemPrompt).toContain('staff:<id>');
    expect(systemPrompt).toContain('verbatim');
    expect(systemPrompt).toContain('DINGTALK_AMBIGUOUS');
    expect(systemPrompt).toContain('姓名 · 部门');
    expect(systemPrompt).toContain('staffToken');
    expect(systemPrompt).toContain('Never pass a raw DingTalk userId');
  });

  it('tells the model that standard-edition list scans are slow and may be incomplete', () => {
    expect(systemPrompt).toContain('Without DingTalk OA Premium');
    expect(systemPrompt).toContain('listPendingApprovals and listMyApplications');
    expect(systemPrompt).toContain('15-25 seconds');
    expect(systemPrompt).toContain('do not repeat them in the same turn');
    expect(systemPrompt).toContain('marked incomplete');
  });
});
