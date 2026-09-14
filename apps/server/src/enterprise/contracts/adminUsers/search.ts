import { z } from 'zod';

import { userPublicRefSchema } from '../shared/userPublicRef';

export const ADMIN_USERS_SEARCH_DEFAULT_LIMIT = 20;
export const ADMIN_USERS_SEARCH_MAX_LIMIT = 50;
export const ADMIN_USERS_SEARCH_QUERY_MAX = 100;

export const adminUserSearchInputSchema = z
  .object({
    limit: z.number().int().min(1).max(ADMIN_USERS_SEARCH_MAX_LIMIT).optional(),
    q: z.string().trim().min(1).max(ADMIN_USERS_SEARCH_QUERY_MAX),
  })
  .strict()
  .transform((input) => ({
    ...input,
    limit: input.limit ?? ADMIN_USERS_SEARCH_DEFAULT_LIMIT,
  }));

export type AdminUserSearchInput = z.input<typeof adminUserSearchInputSchema>;
export type AdminUserSearchInputParsed = z.output<typeof adminUserSearchInputSchema>;

export const adminUserSearchOutputSchema = z
  .object({
    items: z.array(userPublicRefSchema),
  })
  .strict();

export type AdminUserSearchOutput = z.infer<typeof adminUserSearchOutputSchema>;
