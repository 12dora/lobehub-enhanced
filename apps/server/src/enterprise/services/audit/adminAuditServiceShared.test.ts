import { describe, expect, it } from 'vitest';

import type {
  PlatformAuditLegalHoldItem,
  PlatformAuditLogItem,
  PlatformAuditPolicyItem,
} from '@/database/models/platform';

import type { UserPublicRef } from '../../contracts/shared/userPublicRef';
import {
  toEventDetail,
  toEventListItem,
  toLegalHoldPublic,
  toPolicyPublic,
} from './adminAuditServiceShared';

const ref: UserPublicRef = {
  avatar: null,
  email: 'shao@example.com',
  fullName: '邵军军',
  id: 'user-1',
  username: null,
};

const refs = new Map<string, UserPublicRef>([['user-1', ref]]);

const policy = {
  contentAccessMode: 'metadata_only',
  conversationRetentionDays: 180,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  exportArtifactRetentionDays: 7,
  id: 'global',
  maxExportRows: 50_000,
  maxListWindowDays: 90,
  messageBodyInExport: false,
  operationLogRetentionDays: 365,
  redactionProfile: 'strict',
  revision: 1,
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  updatedBy: 'user-1',
} as PlatformAuditPolicyItem;

const event = {
  action: 'admin.settings.publish',
  actorUserId: 'user-1',
  afterDiff: { fingerprint: 'secret', displayName: 'Acme' },
  beforeDiff: { displayName: 'Old' },
  configRevision: 1,
  createdAt: new Date('2026-01-03T00:00:00.000Z'),
  id: 'evt-1',
  ipHash: null,
  reason: null,
  requestId: null,
  result: 'success',
  targetId: 'global',
  targetType: 'settings',
  userAgent: null,
} as PlatformAuditLogItem;

const hold = {
  createdAt: new Date('2026-01-04T00:00:00.000Z'),
  createdBy: 'user-1',
  expiresAt: null,
  id: 'hold-1',
  reason: 'preserve',
  releaseReason: null,
  releasedAt: null,
  releasedBy: null,
  scopeId: 'user-a',
  scopeType: 'user',
  status: 'active',
  updatedAt: new Date('2026-01-04T00:00:00.000Z'),
} as PlatformAuditLegalHoldItem;

describe('admin audit serializers', () => {
  it('attaches updatedByUser and null for unknown ids', () => {
    expect(toPolicyPublic(policy, refs).updatedByUser).toEqual(ref);
    expect(toPolicyPublic({ ...policy, updatedBy: 'missing' }, refs).updatedByUser).toBeNull();
    expect(toPolicyPublic({ ...policy, updatedBy: null }).updatedByUser).toBeNull();
  });

  it('attaches actorUser on list and detail, null for unknown ids', () => {
    expect(toEventListItem(event, refs).actorUser).toEqual(ref);
    expect(toEventListItem({ ...event, actorUserId: 'missing' }, refs).actorUser).toBeNull();
    expect(toEventDetail(event, refs).actorUser).toEqual(ref);
    expect(toEventDetail({ ...event, actorUserId: null }, refs).actorUser).toBeNull();
  });

  it('attaches targetLabel from the batch map and null for sentinels / misses', () => {
    const labels = new Map([
      ['user:user-1', '邵军军'],
      ['topic:t-1', 'Q3 notes'],
    ]);

    expect(
      toEventListItem({ ...event, targetId: 'user-1', targetType: 'user' }, refs, labels)
        .targetLabel,
    ).toBe('邵军军');
    expect(
      toEventDetail({ ...event, targetId: 't-1', targetType: 'topic' }, refs, labels).targetLabel,
    ).toBe('Q3 notes');
    expect(toEventListItem(event, refs, labels).targetLabel).toBeNull();
    expect(
      toEventListItem({ ...event, afterDiff: { title: 'Should not leak' } }, refs, labels)
        .targetLabel,
    ).toBeNull();
    expect(
      toEventDetail({ ...event, targetId: 'missing', targetType: 'topic' }, refs, labels)
        .targetLabel,
    ).toBeNull();
  });

  it('derives DingTalk targetLabel from afterDiff/beforeDiff when the batch map misses', () => {
    const approval = {
      ...event,
      action: 'dingtalk.approval.agree',
      afterDiff: { title: '出差申请' },
      targetId: 'inst-1',
      targetType: 'dingtalk_approval',
    };
    const todo = {
      ...event,
      action: 'dingtalk.todo.create',
      afterDiff: { subject: '提交周报' },
      targetId: 'task-1',
      targetType: 'dingtalk_todo',
    };
    const calendar = {
      ...event,
      action: 'dingtalk.calendar.create',
      afterDiff: { summary: '项目评审' },
      targetId: 'evt-cal-1',
      targetType: 'dingtalk_calendar',
    };
    const fromBefore = {
      ...event,
      action: 'dingtalk.approval.delete_template',
      afterDiff: { title: '   ' },
      beforeDiff: { name: '请假模板' },
      targetId: 'PROC-1',
      targetType: 'dingtalk_approval',
    };
    const ruleExecuted = {
      ...event,
      action: 'dingtalk.approval.rule_executed',
      afterDiff: { ruleName: '自动同意', title: '差旅报销' },
      targetId: 'inst-9',
      targetType: 'user',
    };

    expect(toEventListItem(approval, refs).targetLabel).toBe('出差申请');
    expect(toEventListItem(todo, refs).targetLabel).toBe('提交周报');
    expect(toEventListItem(calendar, refs).targetLabel).toBe('项目评审');
    expect(toEventListItem(fromBefore, refs).targetLabel).toBe('请假模板');
    expect(toEventListItem(ruleExecuted, refs).targetLabel).toBe('差旅报销');
    expect(
      toEventDetail({ ...approval, afterDiff: { processName: '差旅' }, targetId: 'PROC-2' }, refs)
        .targetLabel,
    ).toBe('差旅');
  });

  it('prefers batch map labels, key order, clips to 80, and redacts secrets on DingTalk diffs', () => {
    const labels = new Map([['dingtalk_approval:inst-1', 'From map']]);
    const mapped = {
      ...event,
      action: 'dingtalk.approval.agree',
      afterDiff: { title: 'From diff' },
      targetId: 'inst-1',
      targetType: 'dingtalk_approval',
    };
    expect(toEventListItem(mapped, refs, labels).targetLabel).toBe('From map');

    const keyed = {
      ...event,
      action: 'dingtalk.approval.save_template',
      afterDiff: {
        name: '模板名',
        processName: '流程名',
        ruleName: '规则名',
        subject: '主题',
        summary: '摘要',
        title: '标题',
      },
      targetId: 'PROC-9',
      targetType: 'dingtalk_approval',
    };
    expect(toEventListItem(keyed, refs).targetLabel).toBe('标题');
    expect(
      toEventListItem(
        { ...keyed, afterDiff: { name: '模板名', processName: '流程名', ruleName: '规则名' } },
        refs,
      ).targetLabel,
    ).toBe('模板名');

    const longTitle = '钉'.repeat(90);
    expect(toEventListItem({ ...keyed, afterDiff: { title: longTitle } }, refs).targetLabel).toBe(
      '钉'.repeat(80),
    );

    const secret = 'sk-abcdefghijklmnopqrstuvwxyz012345';
    const redacted = toEventListItem(
      { ...keyed, afterDiff: { title: `Keys ${secret} keep ACME` } },
      refs,
    ).targetLabel;
    expect(redacted).toContain('ACME');
    expect(redacted).not.toContain(secret);
    expect(redacted).toContain('[REDACTED]');

    expect(
      toEventListItem(
        {
          ...event,
          action: 'dingtalk.todo.delete',
          afterDiff: { subject: 12 },
          targetId: 'task-x',
          targetType: 'dingtalk_todo',
        },
        refs,
      ).targetLabel,
    ).toBeNull();
  });

  it('attaches createdByUser / releasedByUser and null for unknown ids', () => {
    const publicHold = toLegalHoldPublic(hold, refs);
    expect(publicHold.createdByUser).toEqual(ref);
    expect(publicHold.releasedByUser).toBeNull();

    const released = toLegalHoldPublic(
      { ...hold, releasedBy: 'missing', status: 'released' },
      refs,
    );
    expect(released.createdByUser).toEqual(ref);
    expect(released.releasedByUser).toBeNull();
  });
});
