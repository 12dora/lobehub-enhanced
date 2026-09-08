// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { webOnboardingRuntime } from './webOnboarding';

const mocks = vi.hoisted(() => ({
  finishOnboarding: vi.fn(),
  getDocumentByFilename: vi.fn(),
  getInboxAgentId: vi.fn(async () => 'inbox-1'),
  getLatestPersonaDocument: vi.fn(),
  isManagedInbox: vi.fn(async () => false),
  saveUserQuestion: vi.fn(),
  upsertDocumentByFilename: vi.fn(),
  upsertPersona: vi.fn(),
}));

vi.mock('@/server/services/onboarding', () => ({
  OnboardingService: vi.fn(function OnboardingService() {
    return {
      finishOnboarding: mocks.finishOnboarding,
      getInboxAgentId: mocks.getInboxAgentId,
      isManagedInbox: mocks.isManagedInbox,
      saveUserQuestion: mocks.saveUserQuestion,
    };
  }),
}));

vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: vi.fn(function AgentDocumentsService() {
    return {
      getDocumentByFilename: mocks.getDocumentByFilename,
      upsertDocumentByFilename: mocks.upsertDocumentByFilename,
    };
  }),
}));

vi.mock('@/database/models/userMemory/persona', () => ({
  UserPersonaModel: vi.fn(function UserPersonaModel() {
    return {
      getLatestPersonaDocument: mocks.getLatestPersonaDocument,
      upsertPersona: mocks.upsertPersona,
    };
  }),
}));

const createRuntime = () =>
  webOnboardingRuntime.factory({
    serverDB: {} as never,
    toolManifestMap: {},
    userId: 'user-1',
  });

describe('webOnboardingRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getInboxAgentId.mockResolvedValue('inbox-1');
    mocks.isManagedInbox.mockResolvedValue(false);
  });

  it('soft-skips SOUL.md writes when the inbox is managed', async () => {
    mocks.isManagedInbox.mockResolvedValue(true);
    const runtime = createRuntime();

    const written = await runtime.writeDocument({ content: '# SOUL', type: 'soul' });
    const updated = await runtime.updateDocument({
      hunks: [{ replace: 'x', search: 'y' }],
      type: 'soul',
    });

    expect(written).toMatchObject({
      content: expect.stringContaining('managed by your organization'),
      success: false,
      state: { skipped: 'managed', type: 'soul' },
    });
    expect(updated).toMatchObject({
      content: expect.stringContaining('Continue with the user persona'),
      success: false,
      state: { skipped: 'managed', type: 'soul' },
    });
    expect(mocks.upsertDocumentByFilename).not.toHaveBeenCalled();
    expect(mocks.getDocumentByFilename).not.toHaveBeenCalled();
  });

  it('still persists the user persona when the inbox is managed', async () => {
    mocks.isManagedInbox.mockResolvedValue(true);
    mocks.upsertPersona.mockResolvedValue({ document: { id: 'persona-1' } });
    const runtime = createRuntime();

    const result = await runtime.writeDocument({
      content: 'Ada is a mathematician.',
      type: 'persona',
    });

    expect(result).toMatchObject({ success: true, state: { id: 'persona-1', type: 'persona' } });
    expect(mocks.upsertPersona).toHaveBeenCalledWith({
      editedBy: 'agent_tool',
      persona: 'Ada is a mathematician.',
      profile: 'default',
    });
  });

  it('writes SOUL.md when the inbox is not managed', async () => {
    mocks.upsertDocumentByFilename.mockResolvedValue({ id: 'soul-1' });
    const runtime = createRuntime();

    const result = await runtime.writeDocument({ content: '# SOUL', type: 'soul' });

    expect(result).toMatchObject({ success: true, state: { id: 'soul-1', type: 'soul' } });
    expect(mocks.upsertDocumentByFilename).toHaveBeenCalledWith({
      agentId: 'inbox-1',
      content: '# SOUL',
      filename: 'SOUL.md',
    });
  });
});
