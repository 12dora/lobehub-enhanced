import { describe, expect, it } from 'vitest';

import {
  MANAGED_PLATFORM_DOCUMENT_TOOL_MESSAGE,
  mapManagedPlatformDocumentToolError,
} from './managedPlatformError';

describe('mapManagedPlatformDocumentToolError', () => {
  it('turns the platform lock code into a Chinese failure the model cannot read as success', () => {
    expect(mapManagedPlatformDocumentToolError(new Error('MANAGED_RESOURCE_BY_PLATFORM'))).toEqual({
      content: MANAGED_PLATFORM_DOCUMENT_TOOL_MESSAGE,
      success: false,
    });
    expect(
      mapManagedPlatformDocumentToolError({
        message: 'MANAGED_RESOURCE_BY_PLATFORM',
      })?.content,
    ).toBe('文稿未创建：该助手由平台统一管理，不允许修改其配置。');
    expect(
      mapManagedPlatformDocumentToolError({
        shape: { message: 'MANAGED_RESOURCE_BY_PLATFORM' },
      }),
    ).toMatchObject({ success: false });
  });

  it('leaves unrelated failures unmapped', () => {
    expect(mapManagedPlatformDocumentToolError(new Error('Document not found'))).toBeUndefined();
    expect(mapManagedPlatformDocumentToolError('network down')).toBeUndefined();
  });
});
