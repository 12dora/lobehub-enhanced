import { z } from 'zod';

import { reasonSchema } from './common';

const isoTimestampSchema = z.string().datetime();

export const adminSystemStatusApiEndpointsSchema = z
  .object({
    events: z.string().trim().min(1).max(2048),
    health: z.string().trim().min(1).max(2048),
    summary: z.string().trim().min(1).max(2048),
  })
  .strict();

export const adminSystemStatusApiViewSchema = z
  .object({
    createdAt: isoTimestampSchema.nullable(),
    endpoints: adminSystemStatusApiEndpointsSchema,
    envTokenConfigured: z.boolean(),
    tokenHint: z.string().trim().min(1).max(64).nullable(),
    tokenSet: z.boolean(),
  })
  .strict();

const statusApiMutationInputSchema = z
  .object({
    reason: reasonSchema.optional(),
  })
  .strict();

export const adminSystemStatusApiRotateInputSchema = statusApiMutationInputSchema;
export const adminSystemStatusApiRevokeInputSchema = statusApiMutationInputSchema;

export const STATUS_API_TOKEN_PATTERN = /^sk-status-[0-9A-Za-z]{32}$/;

export const adminSystemStatusApiRotateOutputSchema = z
  .object({
    token: z.string().regex(STATUS_API_TOKEN_PATTERN),
    view: adminSystemStatusApiViewSchema,
  })
  .strict();

export const adminSystemStatusApiRevokeOutputSchema = adminSystemStatusApiViewSchema;

export type AdminSystemStatusApiRotateInput = z.input<typeof adminSystemStatusApiRotateInputSchema>;
export type AdminSystemStatusApiRotateOutput = z.infer<
  typeof adminSystemStatusApiRotateOutputSchema
>;
export type AdminSystemStatusApiRevokeInput = z.input<typeof adminSystemStatusApiRevokeInputSchema>;
export type AdminSystemStatusApiView = z.infer<typeof adminSystemStatusApiViewSchema>;
