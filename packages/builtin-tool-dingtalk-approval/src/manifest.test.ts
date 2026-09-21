import { BuiltinToolManifestSchema } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { DingtalkApprovalManifest } from './manifest';
import {
  DINGTALK_APPROVAL_READ_APIS,
  DINGTALK_APPROVAL_WRITE_APIS,
  DingtalkApprovalApiName,
  DingtalkApprovalIdentifier,
} from './types';

describe('DingtalkApprovalManifest', () => {
  it('matches the builtin tool manifest schema', () => {
    const parsed = BuiltinToolManifestSchema.safeParse(DingtalkApprovalManifest);

    expect(parsed.success).toBe(true);
  });

  it('uses the stable lobe-dingtalk-approval identifier and required APIs', () => {
    expect(DingtalkApprovalManifest.identifier).toBe(DingtalkApprovalIdentifier);
    expect(DingtalkApprovalManifest.identifier).toBe('lobe-dingtalk-approval');
    expect(DingtalkApprovalManifest.type).toBe('builtin');
    expect(DingtalkApprovalManifest.api.map((item) => item.name).sort()).toEqual(
      Object.values(DingtalkApprovalApiName).slice().sort(),
    );
  });

  it('sets humanIntervention never on reads and always on writes', () => {
    for (const name of DINGTALK_APPROVAL_READ_APIS) {
      const api = DingtalkApprovalManifest.api.find((item) => item.name === name);
      expect(api?.humanIntervention).toBe('never');
    }
    for (const name of DINGTALK_APPROVAL_WRITE_APIS) {
      const api = DingtalkApprovalManifest.api.find((item) => item.name === name);
      expect(api?.humanIntervention).toBe('always');
    }
  });

  it('describes ApprovalRuleConditions on create and update rule APIs', () => {
    const create = DingtalkApprovalManifest.api.find(
      (item) => item.name === DingtalkApprovalApiName.createApprovalRule,
    );
    const conditions = create?.parameters.properties.conditions;

    expect(create?.parameters.required).toEqual([
      'name',
      'processCode',
      'processName',
      'conditions',
      'action',
    ]);
    expect(conditions.required).toEqual(['match']);
    expect(conditions.properties.match.enum).toEqual(['all']);
    expect(conditions.properties.fields.items.properties.op.enum).toEqual([
      'contains',
      'eq',
      'gt',
      'gte',
      'in',
      'lt',
      'lte',
      'ne',
    ]);
    expect(conditions.properties.fields.items.required).toEqual([
      'componentId',
      'label',
      'op',
      'value',
    ]);
    expect(conditions.additionalProperties).toBe(false);
  });

  it('requires remark on refuseTask and a staff token on transferTask', () => {
    const refuse = DingtalkApprovalManifest.api.find(
      (item) => item.name === DingtalkApprovalApiName.refuseTask,
    );
    const transfer = DingtalkApprovalManifest.api.find(
      (item) => item.name === DingtalkApprovalApiName.transferTask,
    );

    expect(refuse?.parameters.required).toEqual(['processInstanceId', 'taskId', 'remark']);
    expect(transfer?.parameters.required).toEqual(['processInstanceId', 'taskId', 'toStaffToken']);
    expect(transfer?.parameters.additionalProperties).toBe(false);
  });

  it('requires remark on returnTask', () => {
    const api = DingtalkApprovalManifest.api.find(
      (item) => item.name === DingtalkApprovalApiName.returnTask,
    );

    expect(api?.parameters.required).toEqual([
      'processInstanceId',
      'taskId',
      'revertAction',
      'targetActivityId',
      'remark',
    ]);
    expect(api?.parameters.properties.remark.minLength).toBe(1);
  });

  it('constrains listPendingApprovals and listMyApplications limit to integers 1–50', () => {
    for (const name of [
      DingtalkApprovalApiName.listPendingApprovals,
      DingtalkApprovalApiName.listMyApplications,
    ]) {
      const api = DingtalkApprovalManifest.api.find((item) => item.name === name);
      expect(api?.parameters.properties.limit).toEqual({
        description: 'Max rows to return (1–50). Never pass more than 50.',
        maximum: 50,
        minimum: 1,
        type: 'integer',
      });
    }
  });

  it('accepts originator "me" and forbids verifying a successful saveTemplate', () => {
    const create = DingtalkApprovalManifest.api.find(
      (item) => item.name === DingtalkApprovalApiName.createApprovalRule,
    );
    const save = DingtalkApprovalManifest.api.find(
      (item) => item.name === DingtalkApprovalApiName.saveTemplate,
    );
    const pending = DingtalkApprovalManifest.api.find(
      (item) => item.name === DingtalkApprovalApiName.listPendingApprovals,
    );

    expect(create?.parameters.properties.conditions.description).toContain('"me"');
    expect(
      create?.parameters.properties.conditions.properties.originators.properties.staffIds
        .description,
    ).toContain('literal "me"');
    expect(save?.description).toContain('authoritative');
    expect(pending?.description).toContain('only this');
  });

  it('caps submitApproval approver nodes at 20 and CC at 50', () => {
    const api = DingtalkApprovalManifest.api.find(
      (item) => item.name === DingtalkApprovalApiName.submitApproval,
    );

    expect(api?.parameters.properties.approverStaffTokens.maxItems).toBe(20);
    expect(api?.parameters.properties.ccStaffTokens.maxItems).toBe(50);
  });

  it('keeps additionalProperties false on every API', () => {
    for (const api of DingtalkApprovalManifest.api) {
      expect(api.parameters.additionalProperties).toBe(false);
      expect(api.parameters.type).toBe('object');
    }
  });
});
