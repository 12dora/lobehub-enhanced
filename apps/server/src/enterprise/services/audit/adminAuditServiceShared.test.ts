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
      toEventDetail({ ...event, targetId: 'missing', targetType: 'topic' }, refs, labels)
        .targetLabel,
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
