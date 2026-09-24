// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminImConnectorView } from '@/enterprise/client/services/adminImConnectors';

import { ImConnectorsTab } from './ImConnectorsTab';

const mocks = vi.hoisted(() => ({
  card: undefined as undefined | { canOperate: boolean; onSaved?: () => Promise<void> },
  connectors: {
    data: undefined as undefined | { items: AdminImConnectorView[] },
    error: undefined as unknown,
    isLoading: false,
    mutate: vi.fn(),
  },
  enabled: undefined as boolean | undefined,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: () => '' }),
  cssVar: new Proxy({}, { get: () => '' }),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Alert: ({ action, title }: { action?: ReactNode; title?: ReactNode }) => (
    <div>
      {title}
      {action}
    </div>
  ),
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/enterprise/client/features/admin/pages/AdminStateSurfaces', () => ({
  AdminLoadingSurface: () => <div data-testid="loading" />,
}));

vi.mock('@/enterprise/client/services/adminImConnectors', () => ({
  adminImConnectorsService: { get: vi.fn(), list: vi.fn() },
}));

vi.mock('../hooks', () => ({
  useAdminImConnectors: (enabled: boolean) => {
    mocks.enabled = enabled;
    return mocks.connectors;
  },
}));

vi.mock('./DingTalkConnectorCard', () => ({
  DingTalkConnectorCard: (props: { canOperate: boolean; onSaved?: () => Promise<void> }) => {
    mocks.card = props;
    return <div data-can-operate={String(props.canOperate)} data-testid="card-dingtalk" />;
  },
}));

const view = (overrides: Partial<AdminImConnectorView> = {}): AdminImConnectorView => ({
  aiCardTemplateId: null,
  approvalAutomationTier: 'moderate',
  chatEnabled: true,
  clientId: null,
  clientSecretFingerprint: null,
  configured: false,
  confirmCardTemplateId: null,
  enabled: false,
  fallbacks: { confirmCardTemplateId: null, corpId: null, robotDisplayName: 'AI 助手' },
  hasClientSecret: false,
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
  robotCode: null,
  selectCardTemplateId: null,
  stats: { linkedUsers: 0, messages7d: 0, pushes7d: 0 },
  status: {
    connectedAt: null,
    lastError: null,
    lastErrorAt: null,
    lastEventAt: null,
    state: 'disabled',
  },
  updatedAt: null,
  workspaceApprovalEnabled: false,
  workspaceCalendarEnabled: false,
  workspaceTodoEnabled: false,
  ...overrides,
});

beforeEach(() => {
  mocks.card = undefined;
  mocks.enabled = undefined;
  mocks.connectors.data = undefined;
  mocks.connectors.error = undefined;
  mocks.connectors.isLoading = false;
  mocks.connectors.mutate.mockReset();
});

describe('ImConnectorsTab', () => {
  it('renders a card for every platform the server lists, configured or not', () => {
    mocks.connectors.data = { items: [view()] };
    render(<ImConnectorsTab canOperate enabled />);

    expect(screen.getByTestId('card-dingtalk').dataset.canOperate).toBe('true');
    expect(mocks.enabled).toBe(true);
  });

  it('asks the server for nothing while the tab is not the active one', () => {
    render(<ImConnectorsTab canOperate={false} enabled={false} />);

    expect(mocks.enabled).toBe(false);
  });

  it('offers a retry when the list could not be read', () => {
    mocks.connectors.error = new Error('boom');
    render(<ImConnectorsTab canOperate enabled />);

    expect(screen.getByText('systemGeneral.loadFailed')).toBeTruthy();
    fireEvent.click(screen.getByText('systemGeneral.retry'));
    expect(mocks.connectors.mutate).toHaveBeenCalled();
  });

  it('shows the loading surface until the first answer arrives', () => {
    mocks.connectors.isLoading = true;
    render(<ImConnectorsTab canOperate enabled />);

    expect(screen.getByTestId('loading')).toBeTruthy();
  });

  it('says so when the deployment supports no IM platform', () => {
    mocks.connectors.data = { items: [] };
    render(<ImConnectorsTab canOperate enabled />);

    expect(screen.getByText('systemGeneral.imConnectors.empty')).toBeTruthy();
  });

  it('re-reads the list after a save so the status and counters come from the server', async () => {
    mocks.connectors.data = { items: [view()] };
    render(<ImConnectorsTab canOperate enabled />);

    await mocks.card!.onSaved!();
    await waitFor(() => expect(mocks.connectors.mutate).toHaveBeenCalled());
  });
});
