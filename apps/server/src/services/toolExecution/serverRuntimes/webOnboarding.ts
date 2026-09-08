import { WebOnboardingIdentifier } from '@lobechat/builtin-tool-web-onboarding';
import { WebOnboardingExecutionRuntime } from '@lobechat/builtin-tool-web-onboarding/executionRuntime';

import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { OnboardingService } from '@/server/services/onboarding';

import type { ServerRuntimeRegistration } from './types';

const MANAGED_SOUL_SKIP_MESSAGE =
  'Skipped SOUL.md because the assistant persona is managed by your organization. Continue with the user persona.';

class ManagedInboxWebOnboardingRuntime extends WebOnboardingExecutionRuntime {
  constructor(
    service: ConstructorParameters<typeof WebOnboardingExecutionRuntime>[0],
    private readonly isInboxManaged: () => Promise<boolean>,
  ) {
    super(service);
  }

  private async skipSoulIfManaged(type: 'persona' | 'soul') {
    if (type !== 'soul') return null;
    if (!(await this.isInboxManaged())) return null;

    return {
      content: MANAGED_SOUL_SKIP_MESSAGE,
      success: false,
      state: { skipped: 'managed' as const, type: 'soul' as const },
    };
  }

  override async writeDocument(
    params: Parameters<WebOnboardingExecutionRuntime['writeDocument']>[0],
  ) {
    return (await this.skipSoulIfManaged(params.type)) ?? super.writeDocument(params);
  }

  override async updateDocument(
    params: Parameters<WebOnboardingExecutionRuntime['updateDocument']>[0],
  ) {
    return (await this.skipSoulIfManaged(params.type)) ?? super.updateDocument(params);
  }
}

export const webOnboardingRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Web Onboarding execution');
    }

    const onboardingService = new OnboardingService(context.serverDB, context.userId);
    const docService = new AgentDocumentsService(
      context.serverDB,
      context.userId,
      context.workspaceId,
    );
    const isInboxManaged = () => onboardingService.isManagedInbox();

    return new ManagedInboxWebOnboardingRuntime(
      {
        finishOnboarding: () => onboardingService.finishOnboarding(),

        readDocument: async (type) => {
          if (type === 'soul') {
            const inboxAgentId = await onboardingService.getInboxAgentId();
            const doc = await docService.getDocumentByFilename(inboxAgentId, 'SOUL.md');

            return {
              content: doc?.content ?? null,
              id: doc?.id ?? null,
            };
          }

          const personaModel = new UserPersonaModel(context.serverDB!, context.userId!);
          const persona = await personaModel.getLatestPersonaDocument();

          return {
            content: persona?.persona ?? null,
            id: persona?.id ?? null,
          };
        },

        saveUserQuestion: (input) => onboardingService.saveUserQuestion(input),

        updateDocument: async (type, content) => {
          if (type === 'soul') {
            if (await isInboxManaged()) {
              return { id: null };
            }
            const inboxAgentId = await onboardingService.getInboxAgentId();
            const doc = await docService.upsertDocumentByFilename({
              agentId: inboxAgentId,
              content,
              filename: 'SOUL.md',
            });

            return { id: doc?.id ?? null };
          }

          const personaModel = new UserPersonaModel(context.serverDB!, context.userId!);
          const result = await personaModel.upsertPersona({
            editedBy: 'agent_tool',
            persona: content,
            profile: 'default',
          });

          return { id: result.document.id };
        },
      },
      isInboxManaged,
    );
  },
  identifier: WebOnboardingIdentifier,
};
