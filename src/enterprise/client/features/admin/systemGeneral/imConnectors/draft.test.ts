import { describe, expect, it } from 'vitest';

import type { AdminImConnectorView } from '@/enterprise/client/services/adminImConnectors';

import {
  fingerprintDingTalkDraft,
  settleDingTalkDraft,
  toDingTalkDraft,
  toDingTalkTestInput,
  toDingTalkUpsertInput,
  validateDingTalkDraft,
} from './draft';

const view = (overrides: Partial<AdminImConnectorView> = {}): AdminImConnectorView => ({
  agentId: null,
  aiCardTemplateId: null,
  chatEnabled: true,
  clientId: 'ding-app-key',
  clientSecretFingerprint: 'a1b2c3',
  configured: true,
  enabled: true,
  hasClientSecret: true,
  idleNewTopicEnabled: true,
  idleNewTopicHours: 24,
  platform: 'dingtalk',
  pushEnabled: true,
  robotCode: 'ding-robot',
  selectCardTemplateId: null,
  stats: { linkedUsers: 3, messages7d: 12, pushes7d: 4 },
  status: {
    connectedAt: '2026-09-15T00:00:00.000Z',
    lastError: null,
    lastErrorAt: null,
    lastEventAt: '2026-09-15T01:00:00.000Z',
    state: 'connected',
  },
  updatedAt: '2026-09-15T00:00:00.000Z',
  ...overrides,
});

describe('DingTalk connector draft', () => {
  it('seeds from the server view without ever holding a secret', () => {
    const draft = toDingTalkDraft(view());

    expect(draft.clientId).toBe('ding-app-key');
    expect(draft.clientSecret).toEqual({ fingerprint: 'a1b2c3', stored: true, value: '' });
    expect(draft.aiCardTemplateId).toBe('');
    expect(draft.idleNewTopicHours).toBe(24);
  });

  it('seeds the optional AgentId, empty when the row never carried one', () => {
    expect(toDingTalkDraft(view()).agentId).toBe('');
    expect(toDingTalkDraft(view({ agentId: '0_123456' })).agentId).toBe('0_123456');
  });

  it('accepts a complete configuration', () => {
    expect(validateDingTalkDraft(toDingTalkDraft(view()))).toEqual({});
  });

  it('requires the credentials the upsert contract requires', () => {
    const draft = toDingTalkDraft(
      view({ clientId: null, hasClientSecret: false, robotCode: null }),
    );

    expect(validateDingTalkDraft(draft)).toEqual({
      clientId: 'required',
      clientSecret: 'required',
      robotCode: 'required',
    });
  });

  it('treats a stored secret as satisfying the requirement', () => {
    const draft = toDingTalkDraft(view({ clientSecretFingerprint: 'a1b2c3' }));

    expect(validateDingTalkDraft(draft).clientSecret).toBeUndefined();
  });

  it('holds the idle hours to the 1–720 range the contract enforces', () => {
    const seed = toDingTalkDraft(view());

    expect(validateDingTalkDraft({ ...seed, idleNewTopicHours: 0 }).idleNewTopicHours).toBe(
      'idleHours',
    );
    expect(validateDingTalkDraft({ ...seed, idleNewTopicHours: 721 }).idleNewTopicHours).toBe(
      'idleHours',
    );
    expect(validateDingTalkDraft({ ...seed, idleNewTopicHours: null }).idleNewTopicHours).toBe(
      'idleHours',
    );
    expect(validateDingTalkDraft({ ...seed, idleNewTopicHours: 1.5 }).idleNewTopicHours).toBe(
      'idleHours',
    );
    expect(validateDingTalkDraft({ ...seed, idleNewTopicHours: 720 }).idleNewTopicHours).toBe(
      undefined,
    );
  });

  it('rejects values longer than the contract allows', () => {
    const seed = toDingTalkDraft(view());

    expect(validateDingTalkDraft({ ...seed, clientId: 'x'.repeat(201) }).clientId).toBe('tooLong');
    expect(
      validateDingTalkDraft({ ...seed, aiCardTemplateId: 'x'.repeat(201) }).aiCardTemplateId,
    ).toBe('tooLong');
    // The AgentId has its own, shorter bound (64) in the contract.
    expect(validateDingTalkDraft({ ...seed, agentId: 'x'.repeat(65) }).agentId).toBe('tooLong');
    expect(validateDingTalkDraft({ ...seed, agentId: 'x'.repeat(64) }).agentId).toBeUndefined();
  });

  it('keeps the stored secret when nothing was typed', () => {
    const input = toDingTalkUpsertInput(toDingTalkDraft(view()));

    expect(input.clientSecret).toEqual({ action: 'keep' });
    expect(input.platform).toBe('dingtalk');
    expect(input.aiCardTemplateId).toBeNull();
  });

  it('replaces the secret with the trimmed value the admin typed', () => {
    const seed = toDingTalkDraft(view());
    const input = toDingTalkUpsertInput({
      ...seed,
      clientSecret: { ...seed.clientSecret, value: '  new-secret  ' },
    });

    expect(input.clientSecret).toEqual({ action: 'replace', value: 'new-secret' });
  });

  it('sends the optional template ids as null rather than an empty string', () => {
    const seed = toDingTalkDraft(
      view({ aiCardTemplateId: 'card-1', selectCardTemplateId: 'sel-1' }),
    );
    const input = toDingTalkUpsertInput({ ...seed, aiCardTemplateId: '   ' });

    expect(input.aiCardTemplateId).toBeNull();
    expect(input.selectCardTemplateId).toBe('sel-1');
  });

  it('sends the trimmed AgentId, and null once the field is cleared', () => {
    const seed = toDingTalkDraft(view({ agentId: '0_123456' }));

    expect(toDingTalkUpsertInput({ ...seed, agentId: '  0_654321  ' }).agentId).toBe('0_654321');
    expect(toDingTalkUpsertInput({ ...seed, agentId: '   ' }).agentId).toBeNull();
    expect(toDingTalkUpsertInput(toDingTalkDraft(view())).agentId).toBeNull();
  });

  it('counts the AgentId as part of the draft identity', () => {
    const seed = toDingTalkDraft(view());

    expect(fingerprintDingTalkDraft({ ...seed, agentId: '0_123456' })).not.toBe(
      fingerprintDingTalkDraft(seed),
    );
  });

  it('falls back to the default idle hours the contract defines', () => {
    const seed = toDingTalkDraft(view());

    expect(toDingTalkUpsertInput({ ...seed, idleNewTopicHours: null }).idleNewTopicHours).toBe(24);
  });

  it('omits untyped fields from the probe so the stored row is used', () => {
    expect(toDingTalkTestInput(toDingTalkDraft(view()))).toEqual({
      clientId: 'ding-app-key',
      platform: 'dingtalk',
      robotCode: 'ding-robot',
    });
  });

  it('probes with the typed secret before it is stored', () => {
    const seed = toDingTalkDraft(view());
    const input = toDingTalkTestInput({
      ...seed,
      clientSecret: { ...seed.clientSecret, value: 'typed-secret' },
    });

    expect(input.clientSecret).toBe('typed-secret');
  });

  it('drops the plaintext and takes the saved row’s secret identity', () => {
    const seed = toDingTalkDraft(view({ clientSecretFingerprint: null, hasClientSecret: false }));
    const settled = settleDingTalkDraft(
      { ...seed, clientSecret: { ...seed.clientSecret, value: 'typed-secret' } },
      view({ clientSecretFingerprint: 'sha256:deadbeef', hasClientSecret: true }),
    );

    // The fingerprint is the only identity the server gives a credential: after a rotation it has
    // to name the secret that is now stored, not the one that was replaced.
    expect(settled.clientSecret).toEqual({
      fingerprint: 'sha256:deadbeef',
      stored: true,
      value: '',
    });
  });

  it('fingerprints the typed secret so an unsaved credential counts as dirty', () => {
    const seed = toDingTalkDraft(view());
    const typed = { ...seed, clientSecret: { ...seed.clientSecret, value: 'typed-secret' } };

    expect(fingerprintDingTalkDraft(typed)).not.toBe(fingerprintDingTalkDraft(seed));
    expect(fingerprintDingTalkDraft({ ...seed })).toBe(fingerprintDingTalkDraft(seed));
  });

  it('fingerprints the stored credential so a rotation elsewhere is adopted', () => {
    const seed = toDingTalkDraft(view());
    const rotated = toDingTalkDraft(view({ clientSecretFingerprint: 'sha256:deadbeef' }));

    expect(fingerprintDingTalkDraft(rotated)).not.toBe(fingerprintDingTalkDraft(seed));
  });
});
