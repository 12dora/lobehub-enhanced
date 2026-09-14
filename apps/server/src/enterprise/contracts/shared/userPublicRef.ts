import { z } from 'zod';

/**
 * Shared public user reference for admin pickers and resolved actor/target
 * columns. Never includes secrets, tokens, roles, or account-scope payloads.
 */
export const userPublicRefSchema = z
  .object({
    avatar: z.string().nullable(),
    email: z.string().nullable(),
    fullName: z.string().nullable(),
    id: z.string(),
    username: z.string().nullable(),
  })
  .strict();

export type UserPublicRef = z.infer<typeof userPublicRefSchema>;
