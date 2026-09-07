/**
 * Lobe Skills Executor
 *
 * Creates and exports the SkillsExecutor instance for registration.
 * Injects agentSkillService as dependency.
 */
import { builtinSkills } from '@lobechat/builtin-skills';
import { SkillsExecutionRuntime } from '@lobechat/builtin-tool-skills/executionRuntime';
import { SkillsExecutor } from '@lobechat/builtin-tool-skills/executor';
import type { BuiltinToolContext } from '@lobechat/types';

import { filterBuiltinSkills, withDisabledSkillGuard } from '@/helpers/skillFilters';
import { cloudSandboxService } from '@/services/cloudSandbox';
import { createClientSkillRuntimeService } from '@/services/platformSkillRuntime';
import { useChatStore } from '@/store/chat';
import { getToolStoreState } from '@/store/tool';
import { builtinToolSelectors } from '@/store/tool/selectors';

// Create runtime with client-side service
const createRuntime = (ctx: BuiltinToolContext) => {
  // Skills the user disabled must be invisible to the activate pool AND to the
  // by-name lookup, so a model that already knows the name cannot activate them.
  const disabledSkillIds = builtinToolSelectors.userDisabledSkillIds(
    getToolStoreState(),
    ctx.platformSkillSnapshot?.mandatorySkillIds,
  );

  return new SkillsExecutionRuntime({
    builtinSkills: ctx.platformSkillSnapshot
      ? []
      : filterBuiltinSkills(builtinSkills).filter(
          (skill) => !disabledSkillIds.has(skill.identifier),
        ),
    service: {
      ...withDisabledSkillGuard(
        createClientSkillRuntimeService(ctx.platformSkillSnapshot),
        disabledSkillIds,
      ),
      execScript: async (command, options) => {
        const { activatedSkills, description } = options;

        // Cloud: execute via Cloud Sandbox with execScript tool
        // Server will resolve zipUrls for all activatedSkills
        const chatState = useChatStore.getState();
        const topicId = chatState.activeTopicId || 'default';

        try {
          // Call cloud sandbox execScript tool
          const result = await cloudSandboxService.callTool(
            'execScript',
            {
              activatedSkills,
              command,
              description,
              platformSkillSnapshot: ctx.platformSkillSnapshot
                ? {
                    ...(ctx.platformSkillSnapshot.agentId
                      ? { agentId: ctx.platformSkillSnapshot.agentId }
                      : {}),
                    mandatorySkillIds: ctx.platformSkillSnapshot.mandatorySkillIds,
                    ...(ctx.platformSkillSnapshot.operationId
                      ? { operationId: ctx.platformSkillSnapshot.operationId }
                      : {}),
                    ...(ctx.platformSkillSnapshot.proof
                      ? { proof: ctx.platformSkillSnapshot.proof }
                      : {}),
                    refs: ctx.platformSkillSnapshot.refs,
                    revision: ctx.platformSkillSnapshot.revision,
                  }
                : undefined,
              operationId: ctx.operationId,
            },
            { agentId: ctx.agentId, operationId: ctx.operationId, topicId },
          );

          if (!result.success) {
            return {
              exitCode: 1,
              output: '',
              stderr: result.error?.message || 'Command execution failed',
              success: false,
            };
          }

          const sandboxResult = result.result || {};

          return {
            exitCode: sandboxResult.exitCode ?? (result.success ? 0 : 1),
            output: sandboxResult.stdout || sandboxResult.output || '',
            stderr: sandboxResult.stderr || '',
            success:
              result.success &&
              (sandboxResult.exitCode === 0 || sandboxResult.exitCode === undefined),
          };
        } catch (error) {
          return {
            exitCode: 1,
            output: '',
            stderr: (error as Error).message || 'Command execution failed',
            success: false,
          };
        }
      },
      exportFile: async (path, filename) => {
        // Get current session context
        const chatState = useChatStore.getState();
        const topicId = chatState.activeTopicId || 'default';

        try {
          // Call cloud sandbox exportAndUploadFile
          const result = await cloudSandboxService.exportAndUploadFile(path, filename, topicId);

          return {
            fileId: result.fileId,
            filename: result.filename,
            mimeType: result.mimeType,
            size: result.size,
            success: result.success,
            url: result.url,
          };
        } catch {
          return {
            filename,
            success: false,
          };
        }
      },
      runCommand: async ({ command, timeout }) => {
        // Cloud: execute via Cloud Sandbox
        // Get current session context for sandbox isolation
        const chatState = useChatStore.getState();
        const topicId = chatState.activeTopicId || 'default';

        try {
          // Call cloud sandbox via TRPC
          // Note: userId is automatically set by server from authenticated context
          const result = await cloudSandboxService.callTool(
            'runCommand',
            {
              command,
              description: `Execute skill command: ${command.slice(0, 100)}${command.length > 100 ? '...' : ''}`,
              timeout,
            },
            { topicId },
          );

          if (!result.success) {
            return {
              exitCode: 1,
              output: '',
              stderr: result.error?.message || 'Command execution failed',
              success: false,
            };
          }

          // Parse cloud sandbox result
          const sandboxResult = result.result || {};

          return {
            exitCode: sandboxResult.exitCode ?? (result.success ? 0 : 1),
            output: sandboxResult.stdout || sandboxResult.output || '',
            stderr: sandboxResult.stderr || '',
            success:
              result.success &&
              (sandboxResult.exitCode === 0 || sandboxResult.exitCode === undefined),
          };
        } catch (error) {
          return {
            exitCode: 1,
            output: '',
            stderr: (error as Error).message || 'Command execution failed',
            success: false,
          };
        }
      },
    },
  });
};

// Create executor instance with the runtime
export const skillsExecutor = new SkillsExecutor(createRuntime);
