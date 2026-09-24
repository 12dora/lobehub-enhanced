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
    expect(systemPrompt).toContain('successful write result is authoritative');
    expect(systemPrompt).toContain('never call listTemplates, getTemplateSchema');
  });

  it('sends same-action approvals through the batch APIs', () => {
    expect(systemPrompt).toContain('approveTasks');
    expect(systemPrompt).toContain('refuseTasks');
    expect(systemPrompt).toContain('不要并行或逐条多次调用');
    expect(systemPrompt).not.toContain('one call per task');
    expect(systemPrompt).not.toContain('never in parallel');
  });

  it('requires a reason for refuse and return', () => {
    expect(systemPrompt).toContain('refuseTask, refuseTasks, and returnTask need a reason');
    expect(systemPrompt).toContain('one shared remark');
  });

  it('describes compiling rule conditions from the schema', () => {
    expect(systemPrompt).toContain('structured conditions');
    expect(systemPrompt).toContain('getTemplateSchema');
    expect(systemPrompt).toContain('Ask when a condition cannot be expressed structurally');
    expect(systemPrompt).toContain('literal "me"');
    expect(systemPrompt).toContain('Do not call searchDirectory to find the current user');
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
    expect(systemPrompt).toContain('Relay every markdown link from a tool result verbatim');
    expect(systemPrompt).toContain('Do not invent a URL');
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
    expect(systemPrompt).toContain('about 60 seconds');
    expect(systemPrompt).toContain('about 5 minutes');
    expect(systemPrompt).toContain('refresh:true only when the user asks to refresh');
    expect(systemPrompt).toContain('do not repeat it in the same turn');
    expect(systemPrompt).toContain('marked incomplete');
  });

  it('routes 待我审批 to listPendingApprovals only and caps limit at 50', () => {
    expect(systemPrompt).toContain('listPendingApprovals ONLY');
    expect(systemPrompt).toContain(
      'listMyApplications only when the user asks about requests they submitted',
    );
    expect(systemPrompt).toContain('Never pass limit above 50');
  });

  it('retries DINGTALK_INVALID once using the hint or the full problem list', () => {
    expect(systemPrompt).toContain('DINGTALK_INVALID');
    expect(systemPrompt).toContain('if problems are listed, fix every problem in one retry');
    expect(systemPrompt).toContain('retry once');
  });

  it('states form design rules including no serial-number field', () => {
    expect(systemPrompt).toContain('Form design rules');
    expect(systemPrompt).toContain('SeqNumberField');
    expect(systemPrompt).toContain('流水号');
    expect(systemPrompt).toContain('DingTalk generates the serial number');
    expect(systemPrompt).toContain('≥2 options');
    expect(systemPrompt).toContain('TableField');
    expect(systemPrompt).toContain('直接创建');
    expect(systemPrompt).toContain('confirm card is the final gate');
    expect(systemPrompt).toContain('关联立项单号');
    expect(systemPrompt).toContain('formulas are not available via API');
    expect(systemPrompt).toContain('default person and read-only are not supported');
    expect(systemPrompt).toContain('lobe-agent-browser');
    expect(systemPrompt).toContain('发起人范围');
    expect(systemPrompt).not.toContain('≤ 25 fields');
    expect(systemPrompt).not.toContain('more than about 12 fields');
  });
});
