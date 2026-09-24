import { DEFAULT_SECURITY_BLACKLIST, InterventionChecker } from '@lobechat/agent-runtime';
import { safeParseJSON } from '@lobechat/utils';

/**
 * The security-blacklist verdict an intervention card shows for these args. The
 * runtime treats a blacklisted call as always needing a human decision, even in
 * auto-run (`InterventionChecker.shouldIntervene`).
 */
export const checkInterventionSecurityBlacklist = (args: Record<string, any>) =>
  InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, args);

/** Same verdict for a call's raw request args, parsed the way the card parses them. */
export const isInterventionArgsBlacklisted = (requestArgs: string): boolean =>
  checkInterventionSecurityBlacklist(safeParseJSON<Record<string, any>>(requestArgs || '') ?? {})
    .blocked;
