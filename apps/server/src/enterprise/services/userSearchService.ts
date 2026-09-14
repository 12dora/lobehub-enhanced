import { searchUsers } from '@/database/models/adminUserSearch';
import type { LobeChatDatabase } from '@/database/type';

import type {
  AdminUserSearchInputParsed,
  AdminUserSearchOutput,
} from '../contracts/adminUsers/search';

export class UserSearchService {
  constructor(private readonly db: LobeChatDatabase) {}

  search = async (input: AdminUserSearchInputParsed): Promise<AdminUserSearchOutput> => {
    const items = await searchUsers(this.db, { limit: input.limit, q: input.q });
    return { items };
  };
}
