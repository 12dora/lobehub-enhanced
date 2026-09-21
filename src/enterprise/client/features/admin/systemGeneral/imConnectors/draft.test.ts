import { describe, expect, it } from 'vitest';

import type { AdminImConnectorView } from '@/enterprise/client/services/adminImConnectors';

import {
  fingerprintDingTalkDraft,
  isDingTalkNotifyAppConfigured,
  resolveApprovalTierTightening,
  settleDingTalkDraft,
  toDingTalkDraft,
  toDingTalkNotifyTestInput,
  toDingTalkTestInput,
  toDingTalkUpsertInput,
  validateDingTalkDraft,
} from './draft';

const view = (overrides: Partial<AdminImConnectorView> = {}): AdminImConnectorView => ({
  agentId: null,
  aiCardTemplateId: null,
  // 工作台能力 as the server answers for a row nobody has configured: the contract defaults them.
  approvalAutomationTier: 'moderate',
  chatEnabled: true,
  clientId: 'ding-app-key',
  clientSecretFingerprint: 'a1b2c3',
  configured: true,
  enabled: true,
  hasClientSecret: true,
  idleNewTopicEnabled: true,
  idleNewTopicHours: 24,
  notifyAgentId: null,
  notifyAppKey: null,
  notifyAppSecretSet: false,
  notifyRobotEnabled: true,
  notifyWorkNoticeEnabled: true,
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
  workspaceApprovalEnabled: false,
  workspaceCalendarEnabled: false,
  workspaceTodoEnabled: false,
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

  it('seeds the notification app block, empty when the second app was never provisioned', () => {
    const seed = toDingTalkDraft(view());

    expect(seed.notifyAppKey).toBe('');
    expect(seed.notifyAgentId).toBe('');
    expect(seed.notifyAppSecret).toEqual({ fingerprint: null, stored: false, value: '' });

    const configured = toDingTalkDraft(
      view({ notifyAgentId: '4617854000', notifyAppKey: 'notify-key', notifyAppSecretSet: true }),
    );
    expect(configured.notifyAppKey).toBe('notify-key');
    expect(configured.notifyAgentId).toBe('4617854000');
    expect(configured.notifyAppSecret.stored).toBe(true);
    expect(configured.notifyAppSecret.value).toBe('');
    expect(configured.notifyWorkNoticeEnabled).toBe(true);
    expect(configured.notifyRobotEnabled).toBe(true);
  });

  it('sends the notification app fields, and omits the secret when nothing was typed', () => {
    const seed = toDingTalkDraft(
      view({ notifyAgentId: '4617854000', notifyAppKey: 'notify-key', notifyAppSecretSet: true }),
    );
    const input = toDingTalkUpsertInput(seed);

    expect(input.notifyAppKey).toBe('notify-key');
    expect(input.notifyAgentId).toBe('4617854000');
    expect(input.notifyWorkNoticeEnabled).toBe(true);
    expect(input.notifyRobotEnabled).toBe(true);
    // Absent means "keep what is stored" — the AppKey beside it must be editable on its own.
    expect('notifyAppSecret' in input).toBe(false);

    const typed = toDingTalkUpsertInput({
      ...seed,
      notifyAppSecret: { ...seed.notifyAppSecret, value: '  notify-secret  ' },
    });
    expect(typed.notifyAppSecret).toEqual({ action: 'replace', value: 'notify-secret' });
  });

  it('sends the notify-app channel switches', () => {
    const seed = toDingTalkDraft(view());
    expect(
      toDingTalkUpsertInput({ ...seed, notifyWorkNoticeEnabled: false }).notifyWorkNoticeEnabled,
    ).toBe(false);
    expect(toDingTalkUpsertInput({ ...seed, notifyRobotEnabled: false }).notifyRobotEnabled).toBe(
      false,
    );
  });

  it('probes the notification app with what was typed, and the stored row otherwise', () => {
    const seed = toDingTalkDraft(view({ notifyAppKey: 'notify-key', notifyAppSecretSet: true }));

    expect(toDingTalkNotifyTestInput(seed)).toEqual({ notifyAppKey: 'notify-key' });
    expect(
      toDingTalkNotifyTestInput({
        ...seed,
        notifyAppSecret: { ...seed.notifyAppSecret, value: '  typed-secret  ' },
      }).notifyAppSecret,
    ).toBe('typed-secret');
    // Nothing configured yet: the probe carries nothing and the server answers on the stored row.
    expect(toDingTalkNotifyTestInput(toDingTalkDraft(view()))).toEqual({});
  });

  it('sends the notification app fields as null once they are cleared', () => {
    const seed = toDingTalkDraft(view({ notifyAgentId: '4617854000', notifyAppKey: 'notify-key' }));
    const input = toDingTalkUpsertInput({ ...seed, notifyAgentId: ' ', notifyAppKey: '   ' });

    expect(input.notifyAppKey).toBeNull();
    expect(input.notifyAgentId).toBeNull();
  });

  it('counts the notification app block as part of the draft identity', () => {
    const seed = toDingTalkDraft(view());

    expect(fingerprintDingTalkDraft({ ...seed, notifyAppKey: 'notify-key' })).not.toBe(
      fingerprintDingTalkDraft(seed),
    );
    expect(
      fingerprintDingTalkDraft({
        ...seed,
        notifyAppSecret: { ...seed.notifyAppSecret, value: 'typed' },
      }),
    ).not.toBe(fingerprintDingTalkDraft(seed));
    expect(fingerprintDingTalkDraft({ ...seed, notifyWorkNoticeEnabled: false })).not.toBe(
      fingerprintDingTalkDraft(seed),
    );
    expect(fingerprintDingTalkDraft({ ...seed, notifyRobotEnabled: false })).not.toBe(
      fingerprintDingTalkDraft(seed),
    );
  });

  it('drops the typed notification secret once the save reports one is stored', () => {
    const seed = toDingTalkDraft(view());
    const settled = settleDingTalkDraft(
      { ...seed, notifyAppSecret: { ...seed.notifyAppSecret, value: 'notify-secret' } },
      view({ notifyAppSecretSet: true }),
    );

    expect(settled.notifyAppSecret).toEqual({ fingerprint: null, stored: true, value: '' });
  });

  it('leaves the notification app optional, but bounds what it accepts', () => {
    const seed = toDingTalkDraft(view());

    // Half a block is simply "not configured" server-side, so it must not block a save.
    expect(validateDingTalkDraft({ ...seed, notifyAppKey: 'only-the-key' })).toEqual({});
    expect(validateDingTalkDraft({ ...seed, notifyAppKey: 'x'.repeat(201) }).notifyAppKey).toBe(
      'tooLong',
    );
    expect(validateDingTalkDraft({ ...seed, notifyAgentId: 'x'.repeat(65) }).notifyAgentId).toBe(
      'tooLong',
    );
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

  describe('工作台能力', () => {
    it('reads an unconfigured row as all off, 适中', () => {
      const seed = toDingTalkDraft(view());

      expect(seed.workspaceApprovalEnabled).toBe(false);
      expect(seed.workspaceTodoEnabled).toBe(false);
      expect(seed.workspaceCalendarEnabled).toBe(false);
      // The contract's own default: a tier is always in force once approval is switched on.
      expect(seed.approvalAutomationTier).toBe('moderate');
    });

    it('seeds the four fields from the row the server returned', () => {
      const seed = toDingTalkDraft(
        view({
          approvalAutomationTier: 'strict',
          workspaceApprovalEnabled: true,
          workspaceCalendarEnabled: false,
          workspaceTodoEnabled: true,
        }),
      );

      expect(seed.approvalAutomationTier).toBe('strict');
      expect(seed.workspaceApprovalEnabled).toBe(true);
      expect(seed.workspaceTodoEnabled).toBe(true);
      expect(seed.workspaceCalendarEnabled).toBe(false);
    });

    it('sends the four fields with the rest of the row', () => {
      const seed = toDingTalkDraft(view());
      const input = toDingTalkUpsertInput({
        ...seed,
        approvalAutomationTier: 'relaxed',
        workspaceApprovalEnabled: true,
        workspaceTodoEnabled: true,
      });

      expect(input.approvalAutomationTier).toBe('relaxed');
      expect(input.workspaceApprovalEnabled).toBe(true);
      expect(input.workspaceTodoEnabled).toBe(true);
      expect(input.workspaceCalendarEnabled).toBe(false);
    });

    it('counts them as part of the draft identity', () => {
      const seed = toDingTalkDraft(view());

      for (const change of [
        { approvalAutomationTier: 'strict' as const },
        { workspaceApprovalEnabled: true },
        { workspaceTodoEnabled: true },
        { workspaceCalendarEnabled: true },
      ])
        expect(fingerprintDingTalkDraft({ ...seed, ...change })).not.toBe(
          fingerprintDingTalkDraft(seed),
        );
    });

    it('treats the notification app as configured once a key and a secret exist', () => {
      const unconfigured = toDingTalkDraft(view());
      expect(isDingTalkNotifyAppConfigured(unconfigured)).toBe(false);

      // An AppKey on its own is not enough: the token the capabilities run on needs both halves.
      expect(isDingTalkNotifyAppConfigured({ ...unconfigured, notifyAppKey: 'notify-key' })).toBe(
        false,
      );
      expect(
        isDingTalkNotifyAppConfigured(
          toDingTalkDraft(view({ notifyAppKey: 'notify-key', notifyAppSecretSet: true })),
        ),
      ).toBe(true);
      // A secret typed but not yet saved counts too — the section is usable before the first 保存.
      expect(
        isDingTalkNotifyAppConfigured({
          ...unconfigured,
          notifyAppKey: 'notify-key',
          notifyAppSecret: { fingerprint: null, stored: false, value: 'typed' },
        }),
      ).toBe(true);
    });

    it('only calls tightening what takes something away from existing rules', () => {
      expect(resolveApprovalTierTightening('moderate', 'strict')).toBe('strict');
      expect(resolveApprovalTierTightening('relaxed', 'off')).toBe('off');
      expect(resolveApprovalTierTightening('strict', 'off')).toBe('off');

      // Loosening, or a tier that is already in force, costs nothing and saves silently.
      expect(resolveApprovalTierTightening('strict', 'moderate')).toBeNull();
      expect(resolveApprovalTierTightening('off', 'strict')).toBeNull();
      expect(resolveApprovalTierTightening('strict', 'strict')).toBeNull();
      expect(resolveApprovalTierTightening('moderate', 'relaxed')).toBeNull();
    });
  });
});
