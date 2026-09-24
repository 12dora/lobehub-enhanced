// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminImConnectorView } from '@/enterprise/client/services/adminImConnectors';

import { type DingTalkPersonalSummary, toDingTalkDraft } from './draft';
import { PersonalDataSection } from './PersonalDataSection';

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

// The "?" help takes Icon and Tooltip from the root package; the guidance is exposed as an
// attribute so a test can tell it lives in a tooltip rather than an inline paragraph.
vi.mock('@lobehub/ui', () => ({
  Icon: () => <span />,
  Tooltip: ({ children, title }: { children?: ReactNode; title?: string }) => (
    <span data-help={title}>{children}</span>
  ),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
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

const view = (overrides: Partial<AdminImConnectorView> = {}): AdminImConnectorView => ({
  agentId: null,
  aiCardTemplateId: null,
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

const onPatch = vi.fn();

const renderSection = ({
  disabled = false,
  draft = toDingTalkDraft(view()),
  showDocs,
  summary = null,
}: Partial<{
  disabled: boolean;
  draft: ReturnType<typeof toDingTalkDraft>;
  showDocs: boolean;
  summary: DingTalkPersonalSummary | null;
}> = {}) =>
  render(
    <PersonalDataSection
      disabled={disabled}
      draft={draft}
      showDocs={showDocs}
      summary={summary}
      onPatch={onPatch}
    />,
  );

const switchOf = (field: string) =>
  screen.getByLabelText(`systemGeneral.imConnectors.personal.fields.${field}`) as HTMLButtonElement;

const SCOPES = ['todo', 'chat', 'report', 'docs', 'sheets', 'write'] as const;

beforeEach(() => {
  onPatch.mockReset();
});

describe('PersonalDataSection', () => {
  it('says what the section grants and what it needs behind "?", not inline', () => {
    const { container } = renderSection();

    expect(screen.getByText('systemGeneral.imConnectors.personal.title')).toBeTruthy();
    expect(
      container.querySelector('[data-help="systemGeneral.imConnectors.personal.description"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-help="systemGeneral.imConnectors.personal.hints.write"]'),
    ).toBeTruthy();
    expect(screen.queryByText('systemGeneral.imConnectors.personal.description')).toBeNull();
    expect(screen.queryByText('systemGeneral.imConnectors.personal.hints.write')).toBeNull();
  });

  it('links the DingTalk CLI setting it needs straight to the developer console', () => {
    renderSection();

    const link = screen.getByRole('link', { name: 'systemGeneral.imConnectors.personal.cliLink' });
    expect(link.getAttribute('href')).toBe(
      'https://open-dev.dingtalk.com/fe/old#/developerSettings',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('holds the six scopes back while the master switch is off', () => {
    renderSection();

    expect(switchOf('enabled').disabled).toBe(false);
    for (const scope of SCOPES) expect(switchOf(scope).disabled).toBe(true);

    fireEvent.click(switchOf('enabled'));
    expect(onPatch).toHaveBeenLastCalledWith({ personalDataEnabled: true });
  });

  it('carries each scope switch into the draft once the master switch is on', () => {
    renderSection({ draft: toDingTalkDraft(view({ personalDataEnabled: true })) });

    fireEvent.click(switchOf('todo'));
    expect(onPatch).toHaveBeenLastCalledWith({ personalTodoEnabled: true });
    fireEvent.click(switchOf('chat'));
    expect(onPatch).toHaveBeenLastCalledWith({ personalChatEnabled: true });
    fireEvent.click(switchOf('report'));
    expect(onPatch).toHaveBeenLastCalledWith({ personalReportEnabled: true });
    fireEvent.click(switchOf('docs'));
    expect(onPatch).toHaveBeenLastCalledWith({ personalDocsEnabled: true });
    fireEvent.click(switchOf('sheets'));
    expect(onPatch).toHaveBeenLastCalledWith({ personalSheetsEnabled: true });
    fireEvent.click(switchOf('write'));
    expect(onPatch).toHaveBeenLastCalledWith({ personalWriteEnabled: true });
  });

  it('shows the docs and sheets switches as stored, off by default', () => {
    const { unmount } = renderSection({
      draft: toDingTalkDraft(view({ personalDataEnabled: true })),
    });
    expect(switchOf('docs').getAttribute('aria-checked')).toBe('false');
    expect(switchOf('sheets').getAttribute('aria-checked')).toBe('false');
    unmount();

    renderSection({
      draft: toDingTalkDraft(
        view({ personalDataEnabled: true, personalDocsEnabled: true, personalSheetsEnabled: true }),
      ),
    });
    expect(switchOf('docs').getAttribute('aria-checked')).toBe('true');
    expect(switchOf('sheets').getAttribute('aria-checked')).toBe('true');
  });

  it('locks every switch while the card is saving or read-only', () => {
    renderSection({
      disabled: true,
      draft: toDingTalkDraft(view({ personalDataEnabled: true })),
    });

    expect(switchOf('enabled').disabled).toBe(true);
    for (const scope of SCOPES) expect(switchOf(scope).disabled).toBe(true);
  });

  it('warns when the sidecar is missing and shows how many members authorized', () => {
    const { container } = renderSection({
      summary: { authorizedCount: 2, brokerConfigured: false },
    });

    expect(screen.getByText('systemGeneral.imConnectors.personal.brokerMissing')).toBeTruthy();
    // The technical names (env variables) only in the tooltip, never in the warning itself.
    expect(
      container.querySelector(
        '[data-help="systemGeneral.imConnectors.personal.brokerMissingHelp"]',
      ),
    ).toBeTruthy();
    expect(screen.getByText('systemGeneral.imConnectors.personal.authorizedCount:2')).toBeTruthy();
  });

  it('says nothing about the sidecar when it is configured or the server did not report it', () => {
    const { unmount } = renderSection({
      summary: { authorizedCount: 0, brokerConfigured: true },
    });
    expect(screen.queryByText('systemGeneral.imConnectors.personal.brokerMissing')).toBeNull();
    expect(screen.getByText('systemGeneral.imConnectors.personal.authorizedCount:0')).toBeTruthy();
    unmount();

    renderSection({ summary: null });
    expect(screen.queryByText('systemGeneral.imConnectors.personal.brokerMissing')).toBeNull();
    expect(screen.queryByText(/systemGeneral\.imConnectors\.personal\.authorizedCount/)).toBeNull();
  });

  // Module `dingtalkDocs` off: the two scopes it serves are not offered; the rest stay.
  it('leaves out the docs and sheets scopes when the docs module is off', () => {
    renderSection({
      draft: toDingTalkDraft(view({ personalDataEnabled: true })),
      showDocs: false,
    });

    expect(screen.queryByLabelText('systemGeneral.imConnectors.personal.fields.docs')).toBeNull();
    expect(screen.queryByLabelText('systemGeneral.imConnectors.personal.fields.sheets')).toBeNull();
    for (const scope of ['todo', 'chat', 'report', 'write']) expect(switchOf(scope)).toBeTruthy();
  });
});
