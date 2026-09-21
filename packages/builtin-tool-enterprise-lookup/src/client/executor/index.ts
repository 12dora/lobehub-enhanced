import type { BuiltinServerRuntimeOutput, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';
import debug from 'debug';

import { enterpriseLookupService } from '@/services/enterpriseLookup';

import type { IEnterpriseLookupService } from '../../ExecutionRuntime';
import { EnterpriseLookupExecutionRuntime } from '../../ExecutionRuntime';
import { EnterpriseLookupIdentifier } from '../../manifest';
import type {
  CompanyProfileParams,
  ListCapabilitiesParams,
  QueryEnterpriseParams,
} from '../../types';
import { EnterpriseLookupApiName } from '../../types';

const log = debug('lobe-enterprise-lookup:executor');

const loadEnterpriseLookupService = async (): Promise<IEnterpriseLookupService> => {
  // Static app import like the reminder tool: the desktop (vite/rolldown) bundle
  // cannot resolve a dynamic `@/` import from inside a workspace package.
  return {
    companyProfile: (params) => enterpriseLookupService.companyProfile(params),
    listCapabilities: async (params) => {
      const result = await enterpriseLookupService.listCapabilities(params);
      if (!result) {
        throw new Error('ENTERPRISE_LOOKUP_INTERNAL');
      }
      return result;
    },
    query: (params) => enterpriseLookupService.query(params),
  };
};

class EnterpriseLookupExecutor extends BaseExecutor<typeof EnterpriseLookupApiName> {
  readonly identifier = EnterpriseLookupIdentifier;
  protected readonly apiEnum = EnterpriseLookupApiName;
  private runtimePromise?: Promise<EnterpriseLookupExecutionRuntime>;

  private getRuntime() {
    this.runtimePromise ??= loadEnterpriseLookupService().then(
      (service) => new EnterpriseLookupExecutionRuntime(service),
    );
    return this.runtimePromise;
  }

  companyProfile = async (params: CompanyProfileParams): Promise<BuiltinToolResult> => {
    try {
      log('companyProfile name=%s provider=%s', params.name, params.provider);
      const runtime = await this.getRuntime();
      return this.toResult(await runtime.companyProfile(params));
    } catch (error) {
      return this.errorResult(error, 'CompanyProfileFailed');
    }
  };

  listCapabilities = async (params: ListCapabilitiesParams = {}): Promise<BuiltinToolResult> => {
    try {
      log('listCapabilities provider=%s category=%s', params.provider, params.category);
      const runtime = await this.getRuntime();
      return this.toResult(await runtime.listCapabilities(params));
    } catch (error) {
      return this.errorResult(error, 'ListCapabilitiesFailed');
    }
  };

  queryEnterprise = async (params: QueryEnterpriseParams): Promise<BuiltinToolResult> => {
    try {
      log('queryEnterprise capability=%s provider=%s', params.capability, params.provider);
      const runtime = await this.getRuntime();
      return this.toResult(await runtime.queryEnterprise(params));
    } catch (error) {
      return this.errorResult(error, 'QueryEnterpriseFailed');
    }
  };

  private toResult(output: BuiltinServerRuntimeOutput): BuiltinToolResult {
    const errMsg = typeof output.error?.message === 'string' ? output.error.message : undefined;
    const safe = output.content || errMsg || 'Tool execution failed';
    if (!output.success) {
      return {
        content: safe,
        error: output.error
          ? { body: output.error, message: errMsg ?? safe, type: 'PluginServerError' }
          : undefined,
        state: output.state,
        success: false,
      };
    }
    return { content: safe, state: output.state, success: true };
  }

  private errorResult(err: unknown, type: string): BuiltinToolResult {
    const message = err instanceof Error ? err.message : String(err) || 'Unknown error';
    return { content: `Failed: ${message}`, error: { message, type }, success: false };
  }
}

export const enterpriseLookupExecutor = new EnterpriseLookupExecutor();
