// @vitest-environment node
import { CloudSandboxIdentifier } from '@lobechat/builtin-tool-cloud-sandbox/manifest';
import { KnowledgeBaseIdentifier } from '@lobechat/builtin-tool-knowledge-base';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PLATFORM_ERROR_CODES } from '@/const/platform/errorCodes';

import { getEnterpriseErrorBody, throwEnterpriseError } from './enterpriseErrors';
import { assertToolModuleEnabled, TOOL_MODULE_BY_IDENTIFIER } from './toolModuleGate';

const assertModuleEnabled = vi.fn();

vi.mock('../services/moduleSettings', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    assertModuleEnabled: (...args: unknown[]) => assertModuleEnabled(...args),
  };
});

describe('assertToolModuleEnabled', () => {
  beforeEach(() => {
    assertModuleEnabled.mockReset();
    assertModuleEnabled.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not consult settings for unmapped (core) identifiers', async () => {
    await expect(assertToolModuleEnabled('lobe-notebook')).resolves.toBeUndefined();
    expect(assertModuleEnabled).not.toHaveBeenCalled();
  });

  it('rejects a knowledge-base tool before any runtime work when the module is off', async () => {
    assertModuleEnabled.mockImplementation(async (moduleId: string) => {
      throwEnterpriseError({
        code: PLATFORM_ERROR_CODES.PLATFORM_MODULE_DISABLED,
        details: { moduleId },
        httpCode: 'FORBIDDEN',
      });
    });

    const error = await assertToolModuleEnabled(KnowledgeBaseIdentifier).catch(
      (caught: unknown) => caught,
    );

    expect(assertModuleEnabled).toHaveBeenCalledWith('knowledgeBase');
    expect(getEnterpriseErrorBody(error)).toMatchObject({
      code: PLATFORM_ERROR_CODES.PLATFORM_MODULE_DISABLED,
      details: { moduleId: 'knowledgeBase' },
    });
  });

  it('allows a mapped tool when the module is on', async () => {
    await expect(assertToolModuleEnabled(KnowledgeBaseIdentifier)).resolves.toBeUndefined();
    expect(assertModuleEnabled).toHaveBeenCalledWith('knowledgeBase');
  });

  it('maps the cloud sandbox tool to the sandbox module', async () => {
    await expect(assertToolModuleEnabled(CloudSandboxIdentifier)).resolves.toBeUndefined();
    expect(assertModuleEnabled).toHaveBeenCalledWith('sandbox');
  });

  it('derives DingTalk, reminder, and lookup tools from module toolIdentifiers', () => {
    expect(TOOL_MODULE_BY_IDENTIFIER['lobe-web-browsing']).toBe('webSearch');
    expect(TOOL_MODULE_BY_IDENTIFIER['lobe-user-memory']).toBe('memory');
    expect(TOOL_MODULE_BY_IDENTIFIER['lobe-skill-store']).toBe('market');
    expect(TOOL_MODULE_BY_IDENTIFIER['lobe-remote-device']).toBe('deviceGateway');
    expect(TOOL_MODULE_BY_IDENTIFIER['lobe-knowledge-base']).toBe('knowledgeBase');
    expect(TOOL_MODULE_BY_IDENTIFIER['lobe-cloud-sandbox']).toBe('sandbox');
    expect(TOOL_MODULE_BY_IDENTIFIER['lobe-reminder']).toBe('dingtalkNotify');
    expect(TOOL_MODULE_BY_IDENTIFIER['lobe-dingtalk-workspace']).toBe('dingtalkWorkspace');
    expect(TOOL_MODULE_BY_IDENTIFIER['lobe-dingtalk-approval']).toBe('dingtalkApproval');
    expect(TOOL_MODULE_BY_IDENTIFIER['lobe-dingtalk-personal']).toBe('dingtalkPersonal');
    expect(TOOL_MODULE_BY_IDENTIFIER['lobe-dingtalk-docs']).toBe('dingtalkDocs');
    expect(TOOL_MODULE_BY_IDENTIFIER['lobe-enterprise-lookup']).toBe('enterpriseLookup');
  });

  it('rejects an enterprise-lookup tool when that module is off', async () => {
    assertModuleEnabled.mockImplementation(async (moduleId: string) => {
      throwEnterpriseError({
        code: PLATFORM_ERROR_CODES.PLATFORM_MODULE_DISABLED,
        details: { moduleId },
        httpCode: 'FORBIDDEN',
      });
    });

    const error = await assertToolModuleEnabled('lobe-enterprise-lookup').catch(
      (caught: unknown) => caught,
    );

    expect(assertModuleEnabled).toHaveBeenCalledWith('enterpriseLookup');
    expect(getEnterpriseErrorBody(error)).toMatchObject({
      code: PLATFORM_ERROR_CODES.PLATFORM_MODULE_DISABLED,
      details: { moduleId: 'enterpriseLookup' },
    });
  });
});
