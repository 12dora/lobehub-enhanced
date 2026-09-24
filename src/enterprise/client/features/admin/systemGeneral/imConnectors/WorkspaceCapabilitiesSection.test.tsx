// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminImConnectorView } from '@/enterprise/client/services/adminImConnectors';

import { toDingTalkDraft } from './draft';
import type {
  ImConnectorWorkspaceProbeResult,
  ImConnectorWorkspaceService,
} from './WorkspaceCapabilitiesSection';
import { WorkspaceCapabilitiesSection } from './WorkspaceCapabilitiesSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${Object.values(options).join(',')}` : key,
  }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: () => '' }),
  cssVar: new Proxy({}, { get: () => '' }),
}));

// InfraField takes Icon and Tooltip from the root package.
vi.mock('@lobehub/ui', () => ({
  Icon: () => <span />,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Select: ({
    disabled,
    id,
    onChange,
    options,
    value,
  }: {
    disabled?: boolean;
    id?: string;
    onChange?: (next: string) => void;
    options?: { label: string; value: string }[];
    value?: string;
  }) => (
    <select
      disabled={disabled}
      id={id}
      value={value ?? ''}
      onChange={(event) => onChange?.(event.target.value)}
    >
      {(options ?? []).map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Switch: ({
    checked,
    disabled,
    id,
    onChange,
  }: {
    checked?: boolean;
    disabled?: boolean;
    id?: string;
    onChange?: (next: boolean) => void;
  }) => (
    <button
      aria-checked={checked}
      disabled={disabled}
      id={id}
      role="switch"
      type="button"
      onClick={() => onChange?.(!checked)}
    />
  ),
  Text: ({ children, type }: { children?: ReactNode; type?: string }) => (
    <span data-type={type}>{children}</span>
  ),
}));

// The section only needs the probe; the shared service instance is never reached in a test.
vi.mock('@/enterprise/client/services/adminImConnectors', () => ({
  adminImConnectorsService: {},
}));

const view = (overrides: Partial<AdminImConnectorView> = {}): AdminImConnectorView => ({
  agentId: null,
  aiCardTemplateId: null,
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
  // The capabilities run on the notification app, so it is configured in every case but the one
  // that is about it being missing.
  notifyAppKey: 'notify-key',
  notifyAppSecretSet: true,
  notifyRobotEnabled: true,
  notifyWorkNoticeEnabled: true,
  personal: { authorizedCount: 0, brokerConfigured: true },
  personalChatEnabled: false,
  personalDataEnabled: false,
  personalReportEnabled: false,
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

const probeResult = (
  overrides: Partial<ImConnectorWorkspaceProbeResult> = {},
): ImConnectorWorkspaceProbeResult => ({
  approval: { ok: true },
  calendar: { ok: true },
  todo: { ok: true },
  ...overrides,
});

const workspaceService = (overrides: Partial<ImConnectorWorkspaceService> = {}) =>
  ({
    probeWorkspacePermissions: vi.fn().mockResolvedValue(probeResult()),
    ...overrides,
  }) as unknown as ImConnectorWorkspaceService & {
    probeWorkspacePermissions: ReturnType<typeof vi.fn>;
  };

const onPatch = vi.fn();

const renderSection = ({
  canOperate = true,
  disabled = false,
  draft = toDingTalkDraft(view()),
  service = workspaceService(),
}: Partial<{
  canOperate: boolean;
  disabled: boolean;
  draft: ReturnType<typeof toDingTalkDraft>;
  service: ImConnectorWorkspaceService;
}> = {}) =>
  render(
    <WorkspaceCapabilitiesSection
      canOperate={canOperate}
      disabled={disabled}
      draft={draft}
      service={service}
      onPatch={onPatch}
    />,
  );

beforeEach(() => {
  onPatch.mockReset();
});

describe('WorkspaceCapabilitiesSection', () => {
  it('says what the section grants before offering the switches', () => {
    renderSection();

    expect(screen.getByText('systemGeneral.imConnectors.workspace.title')).toBeTruthy();
    expect(screen.getByText('systemGeneral.imConnectors.workspace.description')).toBeTruthy();
  });

  it('carries each capability switch into the draft', () => {
    renderSection();

    fireEvent.click(screen.getByLabelText('systemGeneral.imConnectors.workspace.fields.approval'));
    expect(onPatch).toHaveBeenLastCalledWith({ workspaceApprovalEnabled: true });

    fireEvent.click(screen.getByLabelText('systemGeneral.imConnectors.workspace.fields.todo'));
    expect(onPatch).toHaveBeenLastCalledWith({ workspaceTodoEnabled: true });

    fireEvent.click(screen.getByLabelText('systemGeneral.imConnectors.workspace.fields.calendar'));
    expect(onPatch).toHaveBeenLastCalledWith({ workspaceCalendarEnabled: true });
  });

  it('holds the tier back until 审批 is on, and says why', () => {
    renderSection();

    const tier = screen.getByLabelText(
      'systemGeneral.imConnectors.workspace.fields.tier',
    ) as HTMLSelectElement;
    expect(tier.disabled).toBe(true);
    expect(
      screen.getByText('systemGeneral.imConnectors.workspace.tier.requiresApproval'),
    ).toBeTruthy();
  });

  it('explains what the chosen tier allows, and offers the four tiers', () => {
    renderSection({
      draft: { ...toDingTalkDraft(view()), workspaceApprovalEnabled: true },
    });

    const tier = screen.getByLabelText(
      'systemGeneral.imConnectors.workspace.fields.tier',
    ) as HTMLSelectElement;
    expect(tier.disabled).toBe(false);
    expect(tier.value).toBe('moderate');
    expect([...tier.querySelectorAll('option')].map((option) => option.value)).toEqual([
      'off',
      'strict',
      'moderate',
      'relaxed',
    ]);
    // The limits a rule will run under are stated under the control, not in a tooltip.
    expect(
      screen.getByText('systemGeneral.imConnectors.workspace.tier.hints.moderate'),
    ).toBeTruthy();

    fireEvent.change(tier, { target: { value: 'strict' } });
    expect(onPatch).toHaveBeenLastCalledWith({ approvalAutomationTier: 'strict' });
  });

  it('locks the whole block while the notification app is missing', () => {
    renderSection({
      draft: toDingTalkDraft(view({ notifyAppKey: null, notifyAppSecretSet: false })),
    });

    expect(screen.getByText('systemGeneral.imConnectors.workspace.notConfigured')).toBeTruthy();
    expect(
      (
        screen.getByLabelText(
          'systemGeneral.imConnectors.workspace.fields.approval',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByLabelText(
          'systemGeneral.imConnectors.workspace.fields.tier',
        ) as HTMLSelectElement
      ).disabled,
    ).toBe(true);
    // The probe would only answer three times 未配置服务号, which the notice already says.
    expect(
      (screen.getByText('systemGeneral.imConnectors.workspace.probe.run') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('follows the rest of the form while the card is saving', () => {
    renderSection({ disabled: true });

    expect(
      (
        screen.getByLabelText(
          'systemGeneral.imConnectors.workspace.fields.todo',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('reports the probe per capability', async () => {
    const service = workspaceService({
      probeWorkspacePermissions: vi.fn().mockResolvedValue(
        probeResult({
          approval: {
            missingScopes: ['qyapi_get_process', 'qyapi_do_task'],
            ok: false,
            reason: 'forbidden',
          },
          calendar: { ok: false, reason: 'unreachable' },
        }),
      ),
    });
    renderSection({ service });

    fireEvent.click(screen.getByText('systemGeneral.imConnectors.workspace.probe.run'));

    // The scopes are named: they are what an admin has to grant in the DingTalk console.
    await waitFor(() =>
      expect(
        screen.getByText(
          'systemGeneral.imConnectors.workspace.probe.row:systemGeneral.imConnectors.workspace.fields.approval,systemGeneral.imConnectors.workspace.probe.missingScopes:qyapi_get_process, qyapi_do_task',
        ),
      ).toBeTruthy(),
    );
    expect(
      screen.getByText(
        'systemGeneral.imConnectors.workspace.probe.row:systemGeneral.imConnectors.workspace.fields.todo,systemGeneral.imConnectors.workspace.probe.ok',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'systemGeneral.imConnectors.workspace.probe.row:systemGeneral.imConnectors.workspace.fields.calendar,systemGeneral.imConnectors.workspace.probe.reason.unreachable',
      ),
    ).toBeTruthy();
  });

  it('falls back to the reason alone when no scope is named', async () => {
    const service = workspaceService({
      probeWorkspacePermissions: vi
        .fn()
        .mockResolvedValue(probeResult({ approval: { ok: false, reason: 'forbidden' } })),
    });
    renderSection({ service });

    fireEvent.click(screen.getByText('systemGeneral.imConnectors.workspace.probe.run'));

    await waitFor(() =>
      expect(
        screen.getByText(
          'systemGeneral.imConnectors.workspace.probe.row:systemGeneral.imConnectors.workspace.fields.approval,systemGeneral.imConnectors.workspace.probe.reason.forbidden',
        ),
      ).toBeTruthy(),
    );
  });

  it('says the check itself failed rather than inventing a verdict', async () => {
    const service = workspaceService({
      probeWorkspacePermissions: vi.fn().mockRejectedValue(new Error('boom')),
    });
    renderSection({ service });

    fireEvent.click(screen.getByText('systemGeneral.imConnectors.workspace.probe.run'));

    await waitFor(() =>
      expect(screen.getByText('systemGeneral.imConnectors.workspace.probe.failed')).toBeTruthy(),
    );
    expect(screen.queryByText(/systemGeneral.imConnectors.workspace.probe.row/)).toBeNull();
  });

  it('leaves a read-only admin the settings without the probe', () => {
    renderSection({ canOperate: false });

    expect(screen.queryByText('systemGeneral.imConnectors.workspace.probe.run')).toBeNull();
    expect(screen.getByLabelText('systemGeneral.imConnectors.workspace.fields.tier')).toBeTruthy();
  });
});
