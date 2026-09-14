import { PLATFORM_PERMISSIONS } from '@/const/platform/permissions';
import { searchUsers } from '@/database/models/adminUserSearch';
import type { LobeChatDatabase } from '@/database/type';

import type {
  AdminUserSearchInputParsed,
  AdminUserSearchOutput,
} from '../contracts/adminUsers/search';
import { appendAuditAccessLog, buildAuditFilterSummary } from './audit/accessLog';

export class UserSearchService {
  constructor(private readonly db: LobeChatDatabase) {}

  search = async (
    input: AdminUserSearchInputParsed,
    options?: { actorPermissions?: readonly string[]; actorUserId?: string },
  ): Promise<AdminUserSearchOutput> => {
    const writeAuditAccessLog =
      Boolean(options?.actorUserId) &&
      (options?.actorPermissions?.includes(PLATFORM_PERMISSIONS.AUDIT_READ) ?? true);

    const filterSummary = buildAuditFilterSummary({
      hasQ: true,
      limit: input.limit,
    });

    try {
      const items = await searchUsers(this.db, { limit: input.limit, q: input.q });
      if (writeAuditAccessLog && options?.actorUserId) {
        await appendAuditAccessLog(this.db, {
          action: 'admin.audit.users.search',
          actorUserId: options.actorUserId,
          filterSummary,
          result: 'success',
          targetType: 'user',
        });
      }
      return { items };
    } catch (error) {
      if (writeAuditAccessLog && options?.actorUserId) {
        await appendAuditAccessLog(this.db, {
          action: 'admin.audit.users.search',
          actorUserId: options.actorUserId,
          afterDiff: { error: 'failure' },
          filterSummary,
          result: 'failure',
          targetType: 'user',
        });
      }
      throw error;
    }
  };
}
