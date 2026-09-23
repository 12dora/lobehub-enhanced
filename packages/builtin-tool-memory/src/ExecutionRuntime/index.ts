import {
  ActivityMemoryItemSchema,
  AddIdentityActionSchema,
  coerceActivityMemoryInput,
  ContextMemoryItemSchema,
  ExperienceMemoryItemSchema,
  PreferenceMemoryItemSchema,
  RemoveIdentityActionSchema,
  UpdateIdentityActionSchema,
} from '@lobechat/memory-user-memory/schemas';
import { formatMemorySearchResults } from '@lobechat/prompts';
import type {
  AddActivityMemoryResult,
  AddContextMemoryResult,
  AddExperienceMemoryResult,
  AddIdentityMemoryResult,
  AddPreferenceMemoryResult,
  BuiltinServerRuntimeOutput,
  QueryTaxonomyOptionsParams,
  QueryTaxonomyOptionsResult,
  RemoveIdentityMemoryResult,
  SearchMemoryParams,
  SearchMemoryResult,
  UpdateIdentityMemoryResult,
} from '@lobechat/types';
import type { z } from 'zod';

import { formatMemoryToolError } from '../serializeError';

export interface MemoryRuntimeService {
  addActivityMemory: (
    params: z.infer<typeof ActivityMemoryItemSchema>,
  ) => Promise<AddActivityMemoryResult>;
  addContextMemory: (
    params: z.infer<typeof ContextMemoryItemSchema>,
  ) => Promise<AddContextMemoryResult>;
  addExperienceMemory: (
    params: z.infer<typeof ExperienceMemoryItemSchema>,
  ) => Promise<AddExperienceMemoryResult>;
  addIdentityMemory: (
    params: z.infer<typeof AddIdentityActionSchema>,
  ) => Promise<AddIdentityMemoryResult>;
  addPreferenceMemory: (
    params: z.infer<typeof PreferenceMemoryItemSchema>,
  ) => Promise<AddPreferenceMemoryResult>;
  queryTaxonomyOptions: (params: QueryTaxonomyOptionsParams) => Promise<QueryTaxonomyOptionsResult>;
  removeIdentityMemory: (
    params: z.infer<typeof RemoveIdentityActionSchema>,
  ) => Promise<RemoveIdentityMemoryResult>;
  searchMemory: (params: SearchMemoryParams) => Promise<SearchMemoryResult>;
  updateIdentityMemory: (
    params: z.infer<typeof UpdateIdentityActionSchema>,
  ) => Promise<UpdateIdentityMemoryResult>;
}

export type MemoryToolPermission = 'read-only' | 'read-write';

export interface MemoryExecutionRuntimeOptions {
  service: MemoryRuntimeService;
  toolPermission?: MemoryToolPermission;
}

const READ_ONLY_RESULT: BuiltinServerRuntimeOutput = {
  content: 'Memory tool is in read-only mode for this chat',
  success: false,
};

export class MemoryExecutionRuntime {
  private service: MemoryRuntimeService;
  private toolPermission: MemoryToolPermission;

  constructor(options: MemoryExecutionRuntimeOptions) {
    this.service = options.service;
    this.toolPermission = options.toolPermission ?? 'read-write';
  }

  private get isReadOnly() {
    return this.toolPermission === 'read-only';
  }

  async searchUserMemory(params: SearchMemoryParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.searchMemory(params);
      const formattedQuery = params.queries?.join(' | ') || 'facet-only search';

      const { meta: _meta, ...safeResult } = result;
      const rawReason = (result as { reason?: unknown }).reason;
      const reason = typeof rawReason === 'string' ? rawReason : undefined;
      if (reason) {
        return {
          content: reason,
          state: safeResult,
          success: false,
        };
      }

      return {
        content: formatMemorySearchResults({ query: formattedQuery, results: result }),
        state: safeResult,
        success: true,
      };
    } catch (e) {
      return {
        content: formatMemoryToolError('searchUserMemory', e),
        success: false,
      };
    }
  }

  async queryTaxonomyOptions(
    params: QueryTaxonomyOptionsParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.queryTaxonomyOptions(params);

      return {
        content: JSON.stringify(result),
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: formatMemoryToolError('queryTaxonomyOptions', e),
        success: false,
      };
    }
  }

  async addContextMemory(
    params: z.infer<typeof ContextMemoryItemSchema>,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (this.isReadOnly) return READ_ONLY_RESULT;
    try {
      const input = ContextMemoryItemSchema.parse(params);
      const result = await this.service.addContextMemory(input);

      if (!result.success) {
        return { content: result.message, success: false };
      }

      return {
        content: `Context memory "${input.title}" saved with memoryId: "${result.memoryId}" and contextId: "${result.contextId}"`,
        state: { contextId: result.contextId, memoryId: result.memoryId },
        success: true,
      };
    } catch (e) {
      return {
        content: formatMemoryToolError('addContextMemory', e),
        success: false,
      };
    }
  }

  async addActivityMemory(
    params: z.infer<typeof ActivityMemoryItemSchema>,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (this.isReadOnly) return READ_ONLY_RESULT;
    try {
      const input = ActivityMemoryItemSchema.parse(coerceActivityMemoryInput(params));
      const result = await this.service.addActivityMemory(input);

      if (!result.success) {
        return { content: result.message, success: false };
      }

      return {
        content: `Activity memory "${input.title}" saved with memoryId: "${result.memoryId}" and activityId: "${result.activityId}"`,
        state: { activityId: result.activityId, memoryId: result.memoryId },
        success: true,
      };
    } catch (e) {
      return {
        content: formatMemoryToolError('addActivityMemory', e),
        success: false,
      };
    }
  }

  async addExperienceMemory(
    params: z.infer<typeof ExperienceMemoryItemSchema>,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (this.isReadOnly) return READ_ONLY_RESULT;
    try {
      const input = ExperienceMemoryItemSchema.parse(params);
      const result = await this.service.addExperienceMemory(input);

      if (!result.success) {
        return { content: result.message, success: false };
      }

      return {
        content: `Experience memory "${input.title}" saved with memoryId: "${result.memoryId}" and experienceId: "${result.experienceId}"`,
        state: { experienceId: result.experienceId, memoryId: result.memoryId },
        success: true,
      };
    } catch (e) {
      return {
        content: formatMemoryToolError('addExperienceMemory', e),
        success: false,
      };
    }
  }

  async addIdentityMemory(
    params: z.infer<typeof AddIdentityActionSchema>,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (this.isReadOnly) return READ_ONLY_RESULT;
    try {
      const input = AddIdentityActionSchema.parse(params);
      const result = await this.service.addIdentityMemory(input);

      if (!result.success) {
        return { content: result.message, success: false };
      }

      return {
        content: `Identity memory "${input.title}" saved with memoryId: "${result.memoryId}" and identityId: "${result.identityId}"`,
        state: { identityId: result.identityId, memoryId: result.memoryId },
        success: true,
      };
    } catch (e) {
      return {
        content: formatMemoryToolError('addIdentityMemory', e),
        success: false,
      };
    }
  }

  async addPreferenceMemory(
    params: z.infer<typeof PreferenceMemoryItemSchema>,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (this.isReadOnly) return READ_ONLY_RESULT;
    try {
      const input = PreferenceMemoryItemSchema.parse(params);
      const result = await this.service.addPreferenceMemory(input);

      if (!result.success) {
        return { content: result.message, success: false };
      }

      return {
        content: `Preference memory "${input.title}" saved with memoryId: "${result.memoryId}" and preferenceId: "${result.preferenceId}"`,
        state: { memoryId: result.memoryId, preferenceId: result.preferenceId },
        success: true,
      };
    } catch (e) {
      return {
        content: formatMemoryToolError('addPreferenceMemory', e),
        success: false,
      };
    }
  }

  async updateIdentityMemory(
    params: z.infer<typeof UpdateIdentityActionSchema>,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (this.isReadOnly) return READ_ONLY_RESULT;
    try {
      const input = UpdateIdentityActionSchema.parse(params);
      const result = await this.service.updateIdentityMemory(input);

      if (!result.success) {
        return { content: result.message, success: false };
      }

      return {
        content: `Identity memory updated: ${input.id}`,
        state: { identityId: input.id },
        success: true,
      };
    } catch (e) {
      return {
        content: formatMemoryToolError('updateIdentityMemory', e),
        success: false,
      };
    }
  }

  async removeIdentityMemory(
    params: z.infer<typeof RemoveIdentityActionSchema>,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (this.isReadOnly) return READ_ONLY_RESULT;
    try {
      const input = RemoveIdentityActionSchema.parse(params);
      const result = await this.service.removeIdentityMemory(input);

      if (!result.success) {
        return { content: result.message, success: false };
      }

      return {
        content: `Identity memory removed: ${input.id}\nReason: ${input.reason}`,
        state: { identityId: input.id, reason: input.reason },
        success: true,
      };
    } catch (e) {
      return {
        content: formatMemoryToolError('removeIdentityMemory', e),
        success: false,
      };
    }
  }
}
