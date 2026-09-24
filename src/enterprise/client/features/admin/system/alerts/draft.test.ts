import { describe, expect, it } from 'vitest';

import type { AdminStatusAlertsView } from '@/enterprise/client/services/adminSystem';

import {
  alertConfigFingerprint,
  alertDraftFingerprint,
  type AlertSettingsDraft,
  deriveCredentialAction,
  draftFromView,
  findInvalidEmail,
  isRobotBodyVisible,
  mergeAlertDraft,
  normalizeEmailRecipients,
  toAlertSettings,
  toAlertsUpdateInput,
  validateAlertDraft,
} from './draft';

const WEBHOOK = 'https://oapi.dingtalk.com/robot/send?access_token=abc123';

/** The server's view: the webhook is write-only (`webhookUrl` always null + a masked hint). */
const buildAlertsView = (overrides: Partial<AdminStatusAlertsView> = {}): AdminStatusAlertsView =>
  ({
    dingtalkRobotSecretSet: false,
    dingtalkRobotWebhook: { hint: null, set: false },
    effectiveDingtalkApiDailyThreshold: 5000,
    envDisabled: false,
    mailConfigured: true,
    notifyAppConfigured: true,
    recipientUsers: [],
    revision: 4,
    settings: {
      channels: {
        dingtalkRobot: { enabled: false, keyword: null, webhookUrl: null },
        email: { enabled: false, recipients: [] },
        workNotice: {
          enabled: true,
          recipientMode: 'roles',
          roles: ['super_admin', 'user_admin', 'ai_admin', 'identity_admin', 'auditor'],
          userIds: [],
        },
      },
      dingtalkApiDailyThreshold: null,
      enabled: true,
      notifyOnRecovery: true,
      repeatIntervalHours: 6,
      rules: {
        capabilities: true,
        dependencies: true,
        dingtalkApiBudget: true,
        runtimeErrors: true,
        workers: true,
      },
    },
    updatedAt: null,
    ...overrides,
  }) as AdminStatusAlertsView;

const withRobot = (
  draft: AlertSettingsDraft,
  robot: Partial<AlertSettingsDraft['robot']>,
): AlertSettingsDraft => ({ ...draft, robot: { ...draft.robot, ...robot } });

describe('alert settings draft', () => {
  it('round-trips the stored settings unchanged', () => {
    const view = buildAlertsView();
    expect(toAlertSettings(draftFromView(view))).toEqual(view.settings);
  });

  it('marks stored ids the server no longer resolves as deleted users', () => {
    const view = buildAlertsView();
    view.settings.channels.workNotice = {
      enabled: true,
      recipientMode: 'users',
      roles: [],
      userIds: ['u1', 'u2', 'u-gone'],
    };
    // `recipientUsers` lists existing users only.
    view.recipientUsers = [
      { avatar: null, banned: false, dingtalkBound: true, id: 'u1', name: '张三' },
      { avatar: null, banned: false, dingtalkBound: false, id: 'u2', name: '李四' },
    ];

    const draft = draftFromView(view);
    expect(draft.workNotice.users).toEqual([
      { dingtalkBound: true, id: 'u1', name: '张三' },
      { dingtalkBound: false, id: 'u2', name: '李四' },
      { dingtalkBound: null, id: 'u-gone', missing: true, name: 'u-gone' },
    ]);
    // A deleted user is never sent back.
    expect(toAlertSettings(draft).channels.workNotice.userIds).toEqual(['u1', 'u2']);
  });

  it('sends only the recipients of the chosen mode', () => {
    const view = buildAlertsView({
      recipientUsers: [
        { avatar: null, banned: false, dingtalkBound: true, id: 'u1', name: '张三' },
      ],
    });
    view.settings.channels.workNotice = {
      enabled: true,
      recipientMode: 'roles',
      roles: ['super_admin'],
      userIds: ['u1'],
    };
    const draft = draftFromView(view);

    expect(toAlertSettings(draft).channels.workNotice).toEqual({
      enabled: true,
      recipientMode: 'roles',
      roles: ['super_admin'],
      userIds: [],
    });
    expect(
      toAlertSettings({
        ...draft,
        workNotice: { ...draft.workNotice, recipientMode: 'users' },
      }).channels.workNotice.userIds,
    ).toEqual(['u1']);
  });

  it('treats the webhook as a write-only credential', () => {
    const view = buildAlertsView({
      dingtalkRobotWebhook: {
        hint: 'https://oapi.dingtalk.com/robot/send?access_token=…abcd',
        set: true,
      },
    });
    const draft = draftFromView(view);
    expect(draft.robot.webhook).toEqual({ cleared: false, stored: true, value: '' });
    expect(draft.robot.webhookHint).toBe('https://oapi.dingtalk.com/robot/send?access_token=…abcd');

    const keep = toAlertsUpdateInput(draft, 4);
    expect(keep.robotWebhook).toEqual({ action: 'keep' });
    // The token never travels inside `settings`.
    expect(keep.settings.channels.dingtalkRobot.webhookUrl).toBeNull();

    const webhook = (patch: Partial<AlertSettingsDraft['robot']['webhook']>) =>
      toAlertsUpdateInput(withRobot(draft, { webhook: { ...draft.robot.webhook, ...patch } }), 4)
        .robotWebhook;
    expect(webhook({ value: ` ${WEBHOOK} ` })).toEqual({ action: 'replace', value: WEBHOOK });
    expect(webhook({ cleared: true })).toEqual({ action: 'clear' });
  });

  it('keeps / replaces / clears the signing secret, trimming and ignoring blanks', () => {
    const draft = draftFromView(buildAlertsView({ dingtalkRobotSecretSet: true }));
    const secret = (patch: Partial<AlertSettingsDraft['robot']['secret']>) =>
      toAlertsUpdateInput(withRobot(draft, { secret: { ...draft.robot.secret, ...patch } }), 4)
        .robotSecret;

    expect(secret({})).toEqual({ action: 'keep' });
    expect(secret({ value: 'SEC123\n' })).toEqual({ action: 'replace', value: 'SEC123' });
    expect(secret({ cleared: true })).toEqual({ action: 'clear' });
    // Whitespace is never sent as a secret.
    expect(secret({ value: '   ' })).toEqual({ action: 'keep' });
    expect(deriveCredentialAction({ cleared: false, stored: false, value: '  ' })).toEqual({
      action: 'keep',
    });
  });

  it('builds the CAS update payload with nulls for empty optional text', () => {
    const draft = draftFromView(buildAlertsView());
    const input = toAlertsUpdateInput(
      {
        ...withRobot(draft, {
          enabled: true,
          keyword: '  ',
          webhook: { cleared: false, stored: false, value: WEBHOOK },
        }),
        email: { enabled: true, recipients: ['ops@example.com'] },
        threshold: 0,
      },
      4,
    );

    expect(input.expectedRevision).toBe(4);
    expect(input.robotWebhook).toEqual({ action: 'replace', value: WEBHOOK });
    expect(input.settings.channels.dingtalkRobot).toEqual({
      enabled: true,
      keyword: null,
      webhookUrl: null,
    });
    expect(input.settings.channels.email).toEqual({
      enabled: true,
      recipients: ['ops@example.com'],
    });
    // 0 is "never alert", distinct from null ("use the default").
    expect(input.settings.dingtalkApiDailyThreshold).toBe(0);
  });

  it('does not send what a switched-off channel hides', () => {
    const draft = draftFromView(buildAlertsView());
    const input = toAlertsUpdateInput(
      {
        ...withRobot(draft, {
          enabled: false,
          webhook: { cleared: false, stored: false, value: 'not-a-webhook' },
        }),
        email: { enabled: false, recipients: ['ops@example.com', 'ops@corp'] },
      },
      4,
    );

    // Robot off with nothing stored: its fields are hidden, so the stale input is not sent.
    expect(input.robotWebhook).toEqual({ action: 'keep' });
    // Email off: only addresses the server accepts survive.
    expect(input.settings.channels.email).toEqual({
      enabled: false,
      recipients: ['ops@example.com'],
    });
  });

  it('ignores display-only fields when deciding whether the form is dirty', () => {
    const draft = draftFromView(buildAlertsView());
    const withUser = {
      ...draft,
      workNotice: {
        ...draft.workNotice,
        users: [{ dingtalkBound: null, id: 'u1', name: 'u1' }],
      },
    };
    const resolved = {
      ...withUser,
      robot: { ...withUser.robot, webhookHint: 'https://…abcd' },
      workNotice: {
        ...withUser.workNotice,
        users: [{ dingtalkBound: true, id: 'u1', name: '张三' }],
      },
    };

    expect(alertDraftFingerprint(withUser)).toBe(alertDraftFingerprint(resolved));
    expect(alertDraftFingerprint(withUser)).not.toBe(alertDraftFingerprint(draft));
  });

  it('keeps disabled users on the list (and in the payload) but marks them', () => {
    const view = buildAlertsView({
      recipientUsers: [
        { avatar: null, banned: true, dingtalkBound: true, id: 'u1', name: '张三' },
        { avatar: null, banned: false, dingtalkBound: true, id: 'u2', name: '李四' },
      ],
    });
    view.settings.channels.workNotice = {
      enabled: true,
      recipientMode: 'users',
      roles: [],
      userIds: ['u1', 'u2'],
    };
    const draft = draftFromView(view);

    expect(draft.workNotice.users[0]).toMatchObject({ banned: true, id: 'u1' });
    expect(draft.workNotice.users[1].banned).toBeUndefined();
    // Disabled accounts may be re-enabled, so the list keeps them.
    expect(toAlertSettings(draft).channels.workNotice.userIds).toEqual(['u1', 'u2']);
  });
});

describe('mergeAlertDraft (revision conflict)', () => {
  const view = () => buildAlertsView();

  it("applies only the operator's edits onto the newer settings", () => {
    const base = draftFromView(view());
    // The operator unticked 后台任务 and nothing else.
    const mine: AlertSettingsDraft = { ...base, rules: { ...base.rules, workers: false } };
    // Meanwhile someone else set a threshold and turned email on with a recipient.
    const theirs = buildAlertsView({ revision: 7 });
    theirs.settings.dingtalkApiDailyThreshold = 20_000;
    theirs.settings.channels.email = { enabled: true, recipients: ['ops@example.com'] };

    const merged = mergeAlertDraft(base, mine, theirs);
    expect(merged.rules.workers).toBe(false);
    expect(merged.threshold).toBe(20_000);
    expect(merged.email).toEqual({ enabled: true, recipients: ['ops@example.com'] });

    // Saving the merge sends both edits — nobody's change is reverted.
    const settings = toAlertsUpdateInput(merged, theirs.revision).settings;
    expect(settings.dingtalkApiDailyThreshold).toBe(20_000);
    expect(settings.rules.workers).toBe(false);
    expect(settings.channels.email.recipients).toEqual(['ops@example.com']);
  });

  it("keeps the operator's value where both sides changed the same field", () => {
    const base = draftFromView(view());
    const mine: AlertSettingsDraft = { ...base, repeatIntervalHours: 12 };
    const theirs = buildAlertsView({ revision: 7 });
    theirs.settings.repeatIntervalHours = 24;

    expect(mergeAlertDraft(base, mine, theirs).repeatIntervalHours).toBe(12);
  });

  it('merges credential intents onto the newer stored state', () => {
    const base = draftFromView(view());
    const mine = withRobot(base, {
      enabled: true,
      webhook: { cleared: false, stored: false, value: WEBHOOK },
    });
    const theirs = buildAlertsView({
      dingtalkRobotSecretSet: true,
      dingtalkRobotWebhook: { hint: 'https://…zz99', set: true },
      revision: 7,
    });

    const merged = mergeAlertDraft(base, mine, theirs);
    // My typed webhook stands; the secret I never touched is theirs (now stored).
    expect(merged.robot.webhook).toEqual({ cleared: false, stored: true, value: WEBHOOK });
    expect(merged.robot.secret).toEqual({ cleared: false, stored: true, value: '' });
    expect(merged.robot.webhookHint).toBe('https://…zz99');
    expect(merged.robot.enabled).toBe(true);
  });

  it('takes the newer recipient list unless the operator changed it', () => {
    const base = draftFromView(view());
    const theirs = buildAlertsView({
      recipientUsers: [
        { avatar: null, banned: false, dingtalkBound: true, id: 'u7', name: '赵六' },
      ],
      revision: 7,
    });
    theirs.settings.channels.workNotice = {
      enabled: true,
      recipientMode: 'users',
      roles: [],
      userIds: ['u7'],
    };

    const untouched = mergeAlertDraft(base, base, theirs);
    expect(untouched.workNotice.recipientMode).toBe('users');
    expect(untouched.workNotice.users.map((user) => user.id)).toEqual(['u7']);

    const mine: AlertSettingsDraft = {
      ...base,
      workNotice: {
        ...base.workNotice,
        users: [{ dingtalkBound: null, id: 'u9', name: '王五' }],
      },
    };
    expect(mergeAlertDraft(base, mine, theirs).workNotice.users.map((user) => user.id)).toEqual([
      'u9',
    ]);
  });

  it('tells a token / watermark-only revision apart from a settings change', () => {
    const current = view();
    expect(alertConfigFingerprint(buildAlertsView({ revision: 9 }))).toBe(
      alertConfigFingerprint(current),
    );
    const edited = buildAlertsView({ revision: 9 });
    edited.settings.repeatIntervalHours = 24;
    expect(alertConfigFingerprint(edited)).not.toBe(alertConfigFingerprint(current));
    expect(
      alertConfigFingerprint(
        buildAlertsView({ dingtalkRobotWebhook: { hint: 'https://…zz99', set: true } }),
      ),
    ).not.toBe(alertConfigFingerprint(current));
  });
});

describe('validateAlertDraft', () => {
  const base = () => draftFromView(buildAlertsView());

  it('accepts the stored defaults', () => {
    expect(validateAlertDraft(base())).toEqual({});
  });

  it('requires a deliverable recipient for an enabled work notice', () => {
    const draft = base();
    expect(
      validateAlertDraft({ ...draft, workNotice: { ...draft.workNotice, roles: [] } }).recipients,
    ).toBe('rolesRequired');
    expect(
      validateAlertDraft({
        ...draft,
        workNotice: { ...draft.workNotice, recipientMode: 'users', users: [] },
      }).recipients,
    ).toBe('usersRequired');
    // Only deleted or disabled users left → nobody to notify.
    expect(
      validateAlertDraft({
        ...draft,
        workNotice: {
          ...draft.workNotice,
          recipientMode: 'users',
          users: [
            { dingtalkBound: null, id: 'u-gone', missing: true, name: 'u-gone' },
            { banned: true, dingtalkBound: true, id: 'u-off', name: '张三' },
          ],
        },
      }).recipients,
    ).toBe('usersRequired');
    expect(
      validateAlertDraft({
        ...draft,
        workNotice: { ...draft.workNotice, enabled: false, roles: [] },
      }).recipients,
    ).toBeUndefined();
  });

  it('requires a stored or typed DingTalk robot webhook while the robot is on', () => {
    const draft = base();
    const webhookError = (
      webhook: Partial<AlertSettingsDraft['robot']['webhook']>,
      enabled = true,
    ) =>
      validateAlertDraft(
        withRobot(draft, { enabled, webhook: { ...draft.robot.webhook, ...webhook } }),
      ).webhook;

    expect(webhookError({ value: WEBHOOK })).toBeUndefined();
    expect(webhookError({ stored: true })).toBeUndefined();
    expect(webhookError({})).toBe('webhookRequired');
    expect(webhookError({ cleared: true, stored: true })).toBe('webhookRequired');
    expect(webhookError({ value: 'https://example.com/hook' })).toBe('webhookUrl');
    expect(webhookError({ value: 'http://oapi.dingtalk.com/robot/send?access_token=abc' })).toBe(
      'webhookUrl',
    );
    // Off and nothing stored: the fields are hidden, so nothing there is validated.
    expect(webhookError({ value: 'not a url' }, false)).toBeUndefined();
    // Off but a webhook is stored: the fields stay visible, so typed input is still checked.
    expect(webhookError({ stored: true, value: 'not a url' }, false)).toBe('webhookUrl');
  });

  it('rejects a blank or overlong signing secret', () => {
    const draft = withRobot(base(), {
      enabled: true,
      webhook: { cleared: false, stored: true, value: '' },
    });
    const secretError = (value: string) =>
      validateAlertDraft(withRobot(draft, { secret: { cleared: false, stored: false, value } }))
        .robotSecret;

    expect(secretError('')).toBeUndefined();
    expect(secretError('SEC123')).toBeUndefined();
    expect(secretError('   ')).toBe('secretInvalid');
    expect(secretError('x'.repeat(201))).toBe('secretInvalid');
  });

  it('validates email recipients like the server, and only while email is on', () => {
    const draft = base();
    const email = (recipients: string[], enabled = true) =>
      validateAlertDraft({ ...draft, email: { enabled, recipients } }).emailRecipients;

    expect(email(['ops@example.com'])).toBeUndefined();
    expect(email([])).toBe('emailRequired');
    expect(email([], false)).toBeUndefined();
    expect(email(['ops@example.com', 'not-an-email'])).toBe('emailInvalid');
    // Stricter than a naive pattern: the server's zod `.email()` rejects these.
    expect(email(['a@b.c'])).toBe('emailInvalid');
    expect(email(['用户@例子.公司'])).toBe('emailInvalid');
    // A switched-off channel never blocks the save.
    expect(email(['ops@corp'], false)).toBeUndefined();
    expect(email(Array.from({ length: 21 }, (_, index) => `ops${index}@example.com`))).toBe(
      'emailTooMany',
    );
    expect(findInvalidEmail(['ops@example.com', 'nope'])).toBe('nope');
  });

  it('bounds the threshold and the repeat interval', () => {
    const draft = base();
    expect(validateAlertDraft({ ...draft, threshold: null }).threshold).toBeUndefined();
    expect(validateAlertDraft({ ...draft, threshold: 0 }).threshold).toBeUndefined();
    expect(validateAlertDraft({ ...draft, threshold: -1 }).threshold).toBe('threshold');
    expect(validateAlertDraft({ ...draft, threshold: 1.5 }).threshold).toBe('threshold');
    expect(validateAlertDraft({ ...draft, threshold: 10_000_001 }).threshold).toBe('threshold');

    expect(validateAlertDraft({ ...draft, repeatIntervalHours: 168 }).repeatIntervalHours).toBe(
      undefined,
    );
    expect(validateAlertDraft({ ...draft, repeatIntervalHours: null }).repeatIntervalHours).toBe(
      'repeatInterval',
    );
    expect(validateAlertDraft({ ...draft, repeatIntervalHours: 0 }).repeatIntervalHours).toBe(
      'repeatInterval',
    );
    expect(validateAlertDraft({ ...draft, repeatIntervalHours: 169 }).repeatIntervalHours).toBe(
      'repeatInterval',
    );
  });

  it('keeps the robot fields on screen while credentials are stored', () => {
    const draft = base();
    expect(isRobotBodyVisible(draft)).toBe(false);
    expect(isRobotBodyVisible(withRobot(draft, { enabled: true }))).toBe(true);
    expect(
      isRobotBodyVisible(withRobot(draft, { secret: { cleared: false, stored: true, value: '' } })),
    ).toBe(true);
  });

  it('normalises typed email recipients', () => {
    expect(
      normalizeEmailRecipients([' Ops@Example.com ', 'ops@example.com', '', 'b@x.io']),
    ).toEqual(['ops@example.com', 'b@x.io']);
  });
});
