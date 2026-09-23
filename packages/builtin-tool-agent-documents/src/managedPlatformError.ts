import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

/** Code thrown by the platform-agent mutation guard. */
export const MANAGED_PLATFORM_RESOURCE_ERROR_CODE = 'MANAGED_RESOURCE_BY_PLATFORM';

/**
 * Sentence returned to the model when a document tool still hits the platform
 * lock (materialized agent config, or a skill-namespace write). It must not
 * look like a successful save.
 */
export const MANAGED_PLATFORM_DOCUMENT_TOOL_MESSAGE =
  '文稿未创建：该助手由平台统一管理，不允许修改其配置。';

const pushString = (parts: string[], value: unknown) => {
  if (typeof value === 'string' && value.length > 0) parts.push(value);
};

const collectErrorText = (error: unknown): string => {
  const parts: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || value == null) return;
    pushString(parts, value);
    if (typeof value !== 'object') return;
    if (value instanceof Error) {
      pushString(parts, value.message);
      visit(value.cause, depth + 1);
    }
    const record = value as Record<string, unknown>;
    pushString(parts, record.message);
    pushString(parts, record.code);
    visit(record.data, depth + 1);
    visit(record.shape, depth + 1);
    if (!(value instanceof Error)) visit(record.cause, depth + 1);
  };
  visit(error, 0);
  return parts.join('\n');
};

export const mapManagedPlatformDocumentToolError = (
  error: unknown,
): BuiltinServerRuntimeOutput | undefined => {
  if (!collectErrorText(error).includes(MANAGED_PLATFORM_RESOURCE_ERROR_CODE)) return undefined;
  return {
    content: MANAGED_PLATFORM_DOCUMENT_TOOL_MESSAGE,
    success: false,
  };
};

export const isManagedPlatformDocumentToolFailure = (
  value: unknown,
): value is BuiltinServerRuntimeOutput =>
  Boolean(
    value &&
    typeof value === 'object' &&
    (value as { success?: unknown }).success === false &&
    (value as { content?: unknown }).content === MANAGED_PLATFORM_DOCUMENT_TOOL_MESSAGE,
  );
