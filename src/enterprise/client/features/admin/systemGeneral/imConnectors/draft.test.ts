import { describe, expect, it } from 'vitest';

import type { AdminImConnectorView } from '@/enterprise/client/services/adminImConnectors';

import {
  fingerprintDingTalkDraft,
  isDingTalkFieldPrefilled,
  isDingTalkNotifyAppConfigured,
  keepHiddenDingTalkGroups,
  readDingTalkFallbacks,
  readDingTalkPersonalSettings,
  readDingTalkPersonalSummary,
  readDingTalkUntouchedFallbacks,
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
  confirmCardTemplateId: null,
  enabled: true,
  fallbacks: { confirmCardTemplateId: null, corpId: null, robotDisplayName: 'AI 助手' },
  hasClientSecret: true,
  idleNewTopicEnabled: true,
  idleNewTopicHours: 24,
  notifyAgentId: null,
  notifyAppKey: null,
  notifyAppSecretSet: false,
  notifyRobotEnabled: true,
  notifyWorkNoticeEnabled: true,
  personal: { authorizedCount: 0, brokerConfigured: true },
  personalChatEnabled: false,
  personalDataEnabled: false,
  personalDocsEnabled: false,
  personalReportEnabled: false,
  personalSheetsEnabled: false,
  personalTodoEnabled: false,
  personalWriteEnabled: false,
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

  it('carries the optional 机器人名称 from the row into the upsert', () => {
    const named = view({ robotDisplayName: 'AIHub 助理' });

    // The view leaves it out for a row written before the field existed; that reads as「未填写」.
    expect(toDingTalkDraft(view()).robotDisplayName).toBe('');
    expect(toDingTalkDraft(named).robotDisplayName).toBe('AIHub 助理');
    expect(toDingTalkUpsertInput(toDingTalkDraft(named)).robotDisplayName).toBe('AIHub 助理');
    // Empty is sent as null, like every other optional label on the row.
    expect(toDingTalkUpsertInput(toDingTalkDraft(view())).robotDisplayName).toBeNull();
  });

  it('caps 机器人名称 at 32 characters and counts it in the draft identity', () => {
    const seed = toDingTalkDraft(view());

    expect(validateDingTalkDraft({ ...seed, robotDisplayName: 'x'.repeat(33) })).toEqual({
      robotDisplayName: 'tooLong',
    });
    expect(
      validateDingTalkDraft({ ...seed, robotDisplayName: 'x'.repeat(32) }).robotDisplayName,
    ).toBeUndefined();
    expect(fingerprintDingTalkDraft({ ...seed, robotDisplayName: 'AIHub 助理' })).not.toBe(
      fingerprintDingTalkDraft(seed),
    );
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

  // Contract §1.2: an input shows the stored value; when that is empty and the server has a
  // fallback, it is pre-filled (and tagged) and is part of the baseline. It is display only: left
  // untouched it is never sent, so the row keeps storing nothing and the fallback stays in force.
  describe('pre-filled fallbacks', () => {
    const withFallbacks = (overrides: Partial<AdminImConnectorView> = {}) =>
      view({
        fallbacks: {
          confirmCardTemplateId: 'env-confirm.schema',
          corpId: 'ding-captured-corp',
          robotDisplayName: 'AI 助手',
        },
        ...overrides,
      });

    it('lets a stored value win over the fallback', () => {
      const stored = withFallbacks({ confirmCardTemplateId: 'tpl-stored', corpId: 'ding-stored' });
      const draft = toDingTalkDraft(stored);

      expect(draft.corpId).toBe('ding-stored');
      expect(draft.confirmCardTemplateId).toBe('tpl-stored');
      expect(isDingTalkFieldPrefilled(stored, draft, 'corpId')).toBe(false);
      expect(isDingTalkFieldPrefilled(stored, draft, 'confirmCardTemplateId')).toBe(false);
    });

    it('pre-fills an empty input from the fallback and marks it as such', () => {
      const source = withFallbacks();
      const draft = toDingTalkDraft(source);

      expect(draft.corpId).toBe('ding-captured-corp');
      expect(draft.confirmCardTemplateId).toBe('env-confirm.schema');
      expect(isDingTalkFieldPrefilled(source, draft, 'corpId')).toBe(true);
      expect(isDingTalkFieldPrefilled(source, draft, 'confirmCardTemplateId')).toBe(true);
    });

    it('treats a blank stored value as empty', () => {
      const source = withFallbacks({ corpId: '   ' });

      expect(toDingTalkDraft(source).corpId).toBe('ding-captured-corp');
    });

    it('stops calling it pre-filled once the admin edits it', () => {
      const source = withFallbacks();
      const draft = { ...toDingTalkDraft(source), corpId: 'ding-typed' };

      expect(isDingTalkFieldPrefilled(source, draft, 'corpId')).toBe(false);
    });

    it('makes the pre-filled value the baseline, so only an edit of it is a change', () => {
      const seed = toDingTalkDraft(withFallbacks());

      // The seed is what the card compares against, so the fallback is part of it: clearing the
      // pre-filled input is the edit, showing it is not.
      expect(fingerprintDingTalkDraft({ ...seed, corpId: '' })).not.toBe(
        fingerprintDingTalkDraft(seed),
      );
    });

    /** What the editor sends: the draft, less the inputs still showing an untouched fallback. */
    const upsert = (draft: ReturnType<typeof toDingTalkDraft>, ...views: AdminImConnectorView[]) =>
      toDingTalkUpsertInput(draft, readDingTalkUntouchedFallbacks(draft, ...views));

    it('leaves an untouched fallback out of the save, so it stays a fallback', () => {
      const source = withFallbacks();
      const seed = toDingTalkDraft(source);
      const input = upsert(seed, source);

      // Omitted — not null, not the fallback: the row keeps storing nothing, and the runtime keeps
      // following the environment id / the captured CorpId when either changes later.
      expect('corpId' in input).toBe(false);
      expect('confirmCardTemplateId' in input).toBe(false);
      expect(readDingTalkUntouchedFallbacks(seed, source)).toEqual(
        new Set(['confirmCardTemplateId', 'corpId']),
      );
    });

    it('sends a pre-filled input once the admin edits it', () => {
      const source = withFallbacks();
      const input = upsert(
        {
          ...toDingTalkDraft(source),
          confirmCardTemplateId: '  tpl-typed  ',
          corpId: 'ding-typed',
        },
        source,
      );

      expect(input.corpId).toBe('ding-typed');
      expect(input.confirmCardTemplateId).toBe('tpl-typed');
    });

    it('sends a clear when the admin empties a pre-filled input', () => {
      const source = withFallbacks();
      const input = upsert(
        { ...toDingTalkDraft(source), confirmCardTemplateId: '', corpId: '   ' },
        source,
      );

      expect('corpId' in input).toBe(true);
      expect(input.corpId).toBeNull();
      expect('confirmCardTemplateId' in input).toBe(true);
      expect(input.confirmCardTemplateId).toBeNull();
    });

    it('always sends a stored value, pre-fill or not', () => {
      const source = withFallbacks({ confirmCardTemplateId: 'tpl-stored', corpId: 'ding-stored' });
      const input = upsert(toDingTalkDraft(source), source);

      expect(input.corpId).toBe('ding-stored');
      expect(input.confirmCardTemplateId).toBe('tpl-stored');
    });

    it('never lets an untouched fallback fail validation', () => {
      // An over-long environment id is shown as it is, but it is not the admin's input to fix.
      const source = withFallbacks({
        fallbacks: {
          confirmCardTemplateId: 'x'.repeat(201),
          corpId: null,
          robotDisplayName: 'AI 助手',
        },
      });
      const seed = toDingTalkDraft(source);

      expect(seed.confirmCardTemplateId).toBe('x'.repeat(201));
      expect(validateDingTalkDraft(seed, readDingTalkUntouchedFallbacks(seed, source))).toEqual({});
      expect('confirmCardTemplateId' in upsert(seed, source)).toBe(false);
      // Once the admin edits it, it is their input and the contract bound applies.
      const edited = { ...seed, confirmCardTemplateId: 'y'.repeat(201) };
      expect(
        validateDingTalkDraft(edited, readDingTalkUntouchedFallbacks(edited, source))
          .confirmCardTemplateId,
      ).toBe('tooLong');
    });

    // N3: the fallback moved on the server while the card had unrelated edits. The value the input
    // was pre-filled with is still untouched — it must not be pinned as if the admin typed it.
    it('judges untouched against the reading the draft was pre-filled from', () => {
      const seededFrom = withFallbacks();
      const newest = withFallbacks({
        fallbacks: {
          confirmCardTemplateId: 'env-next.schema',
          corpId: 'ding-captured-corp',
          robotDisplayName: 'AI 助手',
        },
      });
      const draft = { ...toDingTalkDraft(seededFrom), chatEnabled: false };

      // Against the newest reading alone the old env id looks typed…
      expect(readDingTalkUntouchedFallbacks(draft, newest).has('confirmCardTemplateId')).toBe(
        false,
      );
      // …but it is exactly what this draft was pre-filled with.
      expect('confirmCardTemplateId' in upsert(draft, newest, seededFrom)).toBe(false);
    });

    // N2: clearing a pre-filled input means「use the fallback」; after the save it shows it again.
    it('shows the fallback again once a cleared pre-filled input is saved', () => {
      const source = withFallbacks();
      const cleared = { ...toDingTalkDraft(source), confirmCardTemplateId: '', corpId: '' };
      const settled = settleDingTalkDraft(cleared, source);

      expect(settled.corpId).toBe('ding-captured-corp');
      expect(settled.confirmCardTemplateId).toBe('env-confirm.schema');
      expect(isDingTalkFieldPrefilled(source, settled, 'corpId')).toBe(true);
      // A value the row now stores is kept as typed.
      expect(
        settleDingTalkDraft(
          { ...cleared, corpId: 'ding-typed' },
          withFallbacks({ corpId: 'ding-typed' }),
        ).corpId,
      ).toBe('ding-typed');
    });

    it('leaves the inputs empty when there is neither a stored value nor a fallback', () => {
      const draft = toDingTalkDraft(view());

      expect(draft.corpId).toBe('');
      expect(draft.confirmCardTemplateId).toBe('');
      expect(isDingTalkFieldPrefilled(view(), draft, 'corpId')).toBe(false);
      expect(toDingTalkUpsertInput(draft).confirmCardTemplateId).toBeNull();
    });

    it('never pre-fills the robot name: its fallback is a placeholder only', () => {
      const draft = toDingTalkDraft(withFallbacks());

      expect(draft.robotDisplayName).toBe('');
      expect(upsert(draft, withFallbacks()).robotDisplayName).toBeNull();
      expect(readDingTalkFallbacks(withFallbacks()).robotDisplayName).toBe('AI 助手');
    });

    it('reads a view without fallbacks as having none', () => {
      const legacy = view();
      delete (legacy as Partial<AdminImConnectorView>).fallbacks;

      expect(readDingTalkFallbacks(legacy)).toEqual({
        confirmCardTemplateId: null,
        corpId: null,
        robotDisplayName: '',
      });
      expect(toDingTalkDraft(legacy).corpId).toBe('');
    });
  });

  // N8: a group the card does not render (module off) is neither validated nor edited: the save
  // sends its fields exactly as the server holds them.
  describe('hidden groups', () => {
    const allShown = {
      approval: true,
      chat: true,
      docs: true,
      notify: true,
      personal: true,
      workspace: true,
    };

    it('changes nothing while every group is shown', () => {
      const seed = toDingTalkDraft(view());
      const draft = { ...seed, idleNewTopicHours: 0 };

      expect(keepHiddenDingTalkGroups(draft, seed, allShown)).toBe(draft);
    });

    it('puts a hidden group back to the server values, so its edits neither block nor leak', () => {
      const seed = toDingTalkDraft(view({ notifyAppKey: 'notify-key' }));
      const draft = {
        ...seed,
        clientId: 'ding-next-key',
        idleNewTopicHours: 0,
        notifyAppKey: 'x'.repeat(201),
        personalDataEnabled: true,
      };
      const savable = keepHiddenDingTalkGroups(draft, seed, {
        ...allShown,
        chat: false,
        notify: false,
      });

      // The invalid hours and AppKey were typed into groups that are now hidden: back to stored.
      expect(savable.idleNewTopicHours).toBe(24);
      expect(savable.notifyAppKey).toBe('notify-key');
      expect(validateDingTalkDraft(savable)).toEqual({});
      // Visible groups keep the admin's edits.
      expect(savable.clientId).toBe('ding-next-key');
      expect(savable.personalDataEnabled).toBe(true);
      expect(toDingTalkUpsertInput(savable)).toMatchObject({
        clientId: 'ding-next-key',
        idleNewTopicHours: 24,
        notifyAppKey: 'notify-key',
      });
    });

    it('keeps the docs scopes as stored when only the docs module is off', () => {
      const seed = toDingTalkDraft(view({ personalDataEnabled: true, personalDocsEnabled: true }));
      const savable = keepHiddenDingTalkGroups(
        { ...seed, personalDocsEnabled: false, personalTodoEnabled: true },
        seed,
        { ...allShown, docs: false },
      );

      expect(savable.personalDocsEnabled).toBe(true);
      expect(savable.personalTodoEnabled).toBe(true);
    });
  });

  describe('确认卡片模板 ID', () => {
    it('round-trips the stored id through the upsert payload', () => {
      const seed = toDingTalkDraft(view({ confirmCardTemplateId: 'tpl-confirm.schema' }));

      expect(seed.confirmCardTemplateId).toBe('tpl-confirm.schema');
      expect(toDingTalkUpsertInput(seed).confirmCardTemplateId).toBe('tpl-confirm.schema');
      expect(
        toDingTalkUpsertInput({ ...seed, confirmCardTemplateId: '  tpl-next  ' })
          .confirmCardTemplateId,
      ).toBe('tpl-next');
      // Cleared: sent as null, so the environment's id is in force again.
      expect(
        toDingTalkUpsertInput({ ...seed, confirmCardTemplateId: '   ' }).confirmCardTemplateId,
      ).toBeNull();
    });

    it('caps the id at 200 characters and counts it in the draft identity', () => {
      const seed = toDingTalkDraft(view());

      expect(
        validateDingTalkDraft({ ...seed, confirmCardTemplateId: 'x'.repeat(201) })
          .confirmCardTemplateId,
      ).toBe('tooLong');
      expect(fingerprintDingTalkDraft({ ...seed, confirmCardTemplateId: 'tpl' })).not.toBe(
        fingerprintDingTalkDraft(seed),
      );
    });
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

  describe('钉钉个人数据', () => {
    it('reads a row without the switches as all off', () => {
      const legacy = view();
      for (const key of [
        'personalChatEnabled',
        'personalDataEnabled',
        'personalDocsEnabled',
        'personalReportEnabled',
        'personalSheetsEnabled',
        'personalTodoEnabled',
        'personalWriteEnabled',
      ] as const)
        delete (legacy as Partial<AdminImConnectorView>)[key];

      expect(readDingTalkPersonalSettings(legacy)).toEqual({
        personalChatEnabled: false,
        personalDataEnabled: false,
        personalDocsEnabled: false,
        personalReportEnabled: false,
        personalSheetsEnabled: false,
        personalTodoEnabled: false,
        personalWriteEnabled: false,
      });
    });

    it('seeds the seven switches from the row and sends them back with it', () => {
      const seed = toDingTalkDraft(
        view({
          personalDataEnabled: true,
          personalDocsEnabled: true,
          personalReportEnabled: true,
          personalTodoEnabled: true,
        }),
      );

      expect(seed.personalDataEnabled).toBe(true);
      expect(seed.personalTodoEnabled).toBe(true);
      expect(seed.personalReportEnabled).toBe(true);
      expect(seed.personalDocsEnabled).toBe(true);
      expect(seed.personalChatEnabled).toBe(false);
      expect(seed.personalSheetsEnabled).toBe(false);

      const input = toDingTalkUpsertInput({
        ...seed,
        personalSheetsEnabled: true,
        personalWriteEnabled: true,
      });
      expect(input).toMatchObject({
        personalChatEnabled: false,
        personalDataEnabled: true,
        personalDocsEnabled: true,
        personalReportEnabled: true,
        personalSheetsEnabled: true,
        personalTodoEnabled: true,
        personalWriteEnabled: true,
      });
    });

    it('counts every switch as part of the draft identity', () => {
      const seed = toDingTalkDraft(view());

      for (const change of [
        { personalDataEnabled: true },
        { personalTodoEnabled: true },
        { personalChatEnabled: true },
        { personalReportEnabled: true },
        { personalDocsEnabled: true },
        { personalSheetsEnabled: true },
        { personalWriteEnabled: true },
      ])
        expect(fingerprintDingTalkDraft({ ...seed, ...change })).not.toBe(
          fingerprintDingTalkDraft(seed),
        );
    });

    it('adopts the switches the server holds once a save has landed', () => {
      const draft = {
        ...toDingTalkDraft(view()),
        personalDataEnabled: true,
        personalTodoEnabled: true,
      };
      const settled = settleDingTalkDraft(
        { ...draft, personalSheetsEnabled: true },
        view({
          personalDataEnabled: true,
          personalSheetsEnabled: false,
          personalTodoEnabled: false,
        }),
      );

      expect(settled.personalDataEnabled).toBe(true);
      expect(settled.personalTodoEnabled).toBe(false);
      expect(settled.personalSheetsEnabled).toBe(false);
    });

    it('reads the sidecar summary only when the server sent a well-formed one', () => {
      const withSummary = (personal: unknown) =>
        ({ ...view(), personal }) as unknown as AdminImConnectorView;

      expect(readDingTalkPersonalSummary(view())).toEqual({
        authorizedCount: 0,
        brokerConfigured: true,
      });
      expect(
        readDingTalkPersonalSummary(withSummary({ authorizedCount: 3, brokerConfigured: true })),
      ).toEqual({ authorizedCount: 3, brokerConfigured: true });
      expect(readDingTalkPersonalSummary(withSummary(undefined))).toBeNull();
      expect(readDingTalkPersonalSummary(withSummary({ brokerConfigured: false }))).toEqual({
        authorizedCount: 0,
        brokerConfigured: false,
      });
      expect(readDingTalkPersonalSummary(withSummary({ authorizedCount: 3 }))).toBeNull();
      expect(readDingTalkPersonalSummary(withSummary(null))).toBeNull();
    });
  });
});
