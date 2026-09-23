import type { RuntimeErrorContext, RuntimeSubsystem } from './runtimeErrors';

/**
 * Fire-and-forget runtime-error hook. The recorder pulls in the Redis client,
 * so callers on the success path only pay for this thin module. Import
 * failures are swallowed — a monitoring write must not change the catch.
 */
export const noteRuntimeError = (
  subsystem: RuntimeSubsystem,
  error: unknown,
  context?: RuntimeErrorContext,
): void => {
  void import('./runtimeErrors')
    .then(({ recordRuntimeError }) => recordRuntimeError(subsystem, error, context))
    .catch(() => undefined);
};
