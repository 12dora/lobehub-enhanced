import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import { createdAt, timestamptz, updatedAt } from '../_helpers';

/** Singleton row identity — there is exactly one platform status-settings document. */
export const PLATFORM_STATUS_SETTINGS_ID = 'global';

/**
 * Platform status-alert settings, job-list watermark, and status-API token.
 * `id` is always `'global'`. `config` may be partial; readers apply defaults.
 * `robot_secret` and `robot_webhook` are KeyVaultsGateKeeper ciphertext and are never returned by the admin API.
 * `revision` is the alert-config CAS token only. Job watermark and API-token writes do not change it.
 * A missing row is revision 0.
 */
export const platformStatusSettings = pgTable(
  'platform_status_settings',
  {
    id: text('id').primaryKey().notNull().default(PLATFORM_STATUS_SETTINGS_ID),

    config: jsonb('config')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** AES-GCM ciphertext of the DingTalk group-robot secret. Null when unset. */
    robotSecret: text('robot_secret'),
    /** AES-GCM ciphertext of the DingTalk group-robot webhook. Null when unset. */
    robotWebhook: text('robot_webhook'),
    jobsClearedAt: timestamptz('jobs_cleared_at'),
    apiTokenHash: text('api_token_hash'),
    apiTokenHint: text('api_token_hint'),
    apiTokenCreatedAt: timestamptz('api_token_created_at'),
    revision: integer('revision').notNull().default(1),

    updatedBy: text('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('platform_status_settings_id_singleton', sql`${t.id} = 'global'`),
    check('platform_status_settings_revision_check', sql`${t.revision} >= 1`),
  ],
);

export type PlatformStatusSettingsRow = typeof platformStatusSettings.$inferSelect;
export type NewPlatformStatusSettings = typeof platformStatusSettings.$inferInsert;
