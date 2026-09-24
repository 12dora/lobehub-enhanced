// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_STATUS_ALERT_SETTINGS } from '@/types/platform/statusAlerts';

import { getTestDB } from '../../core/getTestDB';
import { platformStatusSettings } from '../../schemas/platform';
import type { LobeChatDatabase } from '../../type';
import { PlatformRevisionConflictError } from './errors';
import { PLATFORM_STATUS_SETTINGS_ID, PlatformStatusSettingsModel } from './statusSettings';

const db: LobeChatDatabase = await getTestDB();

const cleanup = async () => {
  await db.delete(platformStatusSettings);
};

beforeEach(cleanup);
afterEach(cleanup);

describe('PlatformStatusSettingsModel', () => {
  it('returns null when the singleton row is absent', async () => {
    const model = new PlatformStatusSettingsModel(db);
    expect(await model.get()).toBeNull();
  });

  it('inserts on the first CAS write and rejects a stale revision', async () => {
    const model = new PlatformStatusSettingsModel(db);
    const next = await model.updateConfig({
      config: DEFAULT_STATUS_ALERT_SETTINGS,
      expectedRevision: 0,
      robotSecret: 'ciphertext-1',
      updatedBy: 'admin-a',
    });
    expect(next.id).toBe(PLATFORM_STATUS_SETTINGS_ID);
    expect(next.revision).toBe(1);
    expect(next.robotSecret).toBe('ciphertext-1');
    expect(next.updatedBy).toBe('admin-a');
    expect(await model.get()).toMatchObject({ revision: 1, robotSecret: 'ciphertext-1' });

    const kept = await model.updateConfig({
      config: { ...DEFAULT_STATUS_ALERT_SETTINGS, enabled: false },
      expectedRevision: 1,
      updatedBy: 'admin-b',
    });
    expect(kept.revision).toBe(2);
    expect(kept.robotSecret).toBe('ciphertext-1');
    expect(kept.config).toMatchObject({ enabled: false });

    await expect(
      model.updateConfig({
        config: DEFAULT_STATUS_ALERT_SETTINGS,
        expectedRevision: 1,
        updatedBy: 'admin-c',
      }),
    ).rejects.toBeInstanceOf(PlatformRevisionConflictError);

    const cleared = await model.updateConfig({
      config: DEFAULT_STATUS_ALERT_SETTINGS,
      expectedRevision: 2,
      robotSecret: null,
      updatedBy: 'admin-b',
    });
    expect(cleared.robotSecret).toBeNull();
    expect(cleared.revision).toBe(3);
  });

  it('keeps the alert revision when the watermark or API token changes', async () => {
    const model = new PlatformStatusSettingsModel(db);
    await model.updateConfig({
      config: { ...DEFAULT_STATUS_ALERT_SETTINGS, repeatIntervalHours: 4 },
      expectedRevision: 0,
      robotWebhook: 'cipher-webhook',
      updatedBy: 'admin-a',
    });
    const started = Date.now();
    const watermark = await model.setJobsClearedAt({ updatedBy: 'admin-a' });
    expect(watermark.revision).toBe(1);
    const firstClearedAt = watermark.jobsClearedAt?.getTime() ?? 0;
    expect(firstClearedAt).toBeGreaterThanOrEqual(started - 5_000);
    expect(firstClearedAt).toBeLessThanOrEqual(Date.now() + 5_000);
    expect(watermark.robotWebhook).toBe('cipher-webhook');
    expect(watermark.config).toMatchObject({ repeatIntervalHours: 4 });

    const future = new Date(Date.now() + 3_600_000);
    await db
      .update(platformStatusSettings)
      .set({ jobsClearedAt: future })
      .where(eq(platformStatusSettings.id, PLATFORM_STATUS_SETTINGS_ID));
    const backward = await model.setJobsClearedAt({ updatedBy: 'admin-b' });
    expect(backward.revision).toBe(1);
    const keptAt = backward.jobsClearedAt;
    if (!keptAt) throw new Error('watermark missing');
    expect(keptAt.getTime()).toBeGreaterThan(Date.now() + 30 * 60 * 1000);
    const keptWatermark = keptAt.toISOString();

    const createdAt = new Date('2026-09-25T01:00:00.000Z');
    const token = await model.setApiToken({
      createdAt,
      hash: 'abc',
      hint: 'sk-status-…a1b2',
      updatedBy: 'admin-a',
    });
    expect(token.revision).toBe(1);
    expect(token.apiTokenHash).toBe('abc');
    expect(token.apiTokenHint).toBe('sk-status-…a1b2');
    expect(token.jobsClearedAt?.toISOString()).toBe(keptWatermark);

    const revoked = await model.setApiToken({ clear: true, updatedBy: 'admin-a' });
    expect(revoked.revision).toBe(1);
    expect(revoked.apiTokenHash).toBeNull();
    expect(revoked.apiTokenHint).toBeNull();
    expect(revoked.apiTokenCreatedAt).toBeNull();
    expect(revoked.config).toMatchObject({ repeatIntervalHours: 4 });

    const saved = await model.updateConfig({
      config: DEFAULT_STATUS_ALERT_SETTINGS,
      expectedRevision: 1,
      updatedBy: 'admin-a',
    });
    expect(saved.revision).toBe(2);
    expect(saved.apiTokenHash).toBeNull();
    expect(saved.jobsClearedAt?.toISOString()).toBe(keptWatermark);
  });
});
