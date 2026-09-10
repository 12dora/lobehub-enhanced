import { describe, expect, it, vi } from 'vitest';

import { PLATFORM_ERROR_CODES } from '@/const/platform/errorCodes';

import { getRuntimeErrorMessage, isPlatformLocalizedErrorType } from './runtimeErrorMessage';

const t = vi.fn((key: string) => key) as unknown as never;

/**
 * i18next-shaped translator: a missing key falls back to `defaultValue`, which is how the
 * `fallbackMessage` argument reaches the UI.
 */
const createTranslator = (translations: Record<string, string>) =>
  ((key: string, options?: Record<string, unknown>) =>
    translations[key] ?? String(options?.defaultValue ?? key)) as unknown as never;

describe('getRuntimeErrorMessage', () => {
  it('routes a known runtime code to the modelRuntime namespace', () => {
    expect(getRuntimeErrorMessage(t, 'InvalidProviderAPIKey')).toBe(
      'modelRuntime:InvalidProviderAPIKey',
    );
  });

  it('routes anything else — HTTP status, platform codes — to error:response.<X>', () => {
    expect(getRuntimeErrorMessage(t, 429)).toBe('response.429');
    expect(getRuntimeErrorMessage(t, PLATFORM_ERROR_CODES.PLATFORM_AI_PROVIDER_DISABLED)).toBe(
      'response.PLATFORM_AI_PROVIDER_DISABLED',
    );
    expect(getRuntimeErrorMessage(t, PLATFORM_ERROR_CODES.PLATFORM_AI_MODEL_NOT_PUBLISHED)).toBe(
      'response.PLATFORM_AI_MODEL_NOT_PUBLISHED',
    );
  });

  it('prefers the localized runtime message over the raw fallback', () => {
    const translate = createTranslator({
      'modelRuntime:ModelEmptyCompletion': 'Localized empty completion',
    });

    expect(
      getRuntimeErrorMessage(
        translate,
        'ModelEmptyCompletion',
        undefined,
        'raw server message',
      ),
    ).toBe('Localized empty completion');
  });

  it('falls back to the raw message when a registered runtime code has no locale key', () => {
    // `InvalidGithubCopilotToken` is in ERROR_CODE_SPECS but owns no `modelRuntime:` copy, so
    // without a fallback the alert title used to render the bare key.
    const translate = createTranslator({});

    expect(
      getRuntimeErrorMessage(
        translate,
        'InvalidGithubCopilotToken',
        undefined,
        'The GitHub Copilot token is invalid.',
      ),
    ).toBe('The GitHub Copilot token is invalid.');
  });

  it('returns an empty string for an absent code', () => {
    expect(getRuntimeErrorMessage(t, undefined)).toBe('');
    expect(getRuntimeErrorMessage(t, '')).toBe('');
  });
});

describe('isPlatformLocalizedErrorType', () => {
  it.each([
    // A provider hard-deleted mid-conversation ends the next turn with this code; the chat
    // surface must render its message instead of the raw-key / trace-id fallback.
    ['PLATFORM_AI_PROVIDER_DISABLED', PLATFORM_ERROR_CODES.PLATFORM_AI_PROVIDER_DISABLED],
    // Raced chat request against a model the admin just unpublished — answers 403, and without
    // this registration it fell into the trace-report UI.
    ['PLATFORM_AI_MODEL_NOT_PUBLISHED', PLATFORM_ERROR_CODES.PLATFORM_AI_MODEL_NOT_PUBLISHED],
  ])('recognises %s as owning chat-facing copy', (_name, code) => {
    expect(isPlatformLocalizedErrorType(code)).toBe(true);
  });

  it('does not claim localization for unregistered platform codes', () => {
    // Registering a code without its `error:response.<CODE>` copy would render a raw key —
    // unregistered codes must keep falling through to the report UI.
    expect(isPlatformLocalizedErrorType(PLATFORM_ERROR_CODES.PLATFORM_NOT_FOUND)).toBe(false);
    expect(isPlatformLocalizedErrorType('SOMETHING_ELSE')).toBe(false);
  });
});
