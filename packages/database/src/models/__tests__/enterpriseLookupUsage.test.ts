// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';
import { EnterpriseLookupUsageModel } from '../enterpriseLookupUsage';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'elu-model-owner';
const otherUserId = 'elu-model-other';
const model = new EnterpriseLookupUsageModel(serverDB);
const day = '2026-09-21';
const nextDay = '2026-09-22';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('EnterpriseLookupUsageModel', () => {
  describe('getDailyTotal / increment', () => {
    it('returns 0 when the user has no rows for that day', async () => {
      await expect(model.getDailyTotal(userId, day)).resolves.toBe(0);
    });

    it('upserts per provider and returns the user/day total across providers', async () => {
      await expect(model.increment(userId, day, 'qcc')).resolves.toBe(1);
      await expect(model.increment(userId, day, 'qcc')).resolves.toBe(2);
      await expect(model.increment(userId, day, 'tianyancha')).resolves.toBe(3);
      await expect(model.getDailyTotal(userId, day)).resolves.toBe(3);
    });

    it('isolates counts by date and user', async () => {
      await model.increment(userId, day, 'qcc');
      await model.increment(userId, nextDay, 'qcc');
      await model.increment(otherUserId, day, 'qcc');

      await expect(model.getDailyTotal(userId, day)).resolves.toBe(1);
      await expect(model.getDailyTotal(userId, nextDay)).resolves.toBe(1);
      await expect(model.getDailyTotal(otherUserId, day)).resolves.toBe(1);
    });
  });

  describe('reserve / release', () => {
    it('reserves under the cap and rejects when the cross-provider total is full', async () => {
      await expect(model.reserve(userId, day, 'qcc', 2)).resolves.toBe(true);
      await expect(model.reserve(userId, day, 'tianyancha', 2)).resolves.toBe(true);
      await expect(model.reserve(userId, day, 'qcc', 2)).resolves.toBe(false);
      await expect(model.getDailyTotal(userId, day)).resolves.toBe(2);
    });

    it('releases a reservation so a later reserve can succeed', async () => {
      await expect(model.reserve(userId, day, 'qcc', 1)).resolves.toBe(true);
      await expect(model.reserve(userId, day, 'qcc', 1)).resolves.toBe(false);
      await model.release(userId, day, 'qcc');
      await expect(model.getDailyTotal(userId, day)).resolves.toBe(0);
      await expect(model.reserve(userId, day, 'qcc', 1)).resolves.toBe(true);
    });

    it('treats limit 0 as unlimited but still records usage', async () => {
      await expect(model.reserve(userId, day, 'qcc', 0)).resolves.toBe(true);
      await expect(model.reserve(userId, day, 'qcc', 0)).resolves.toBe(true);
      await expect(model.getDailyTotal(userId, day)).resolves.toBe(2);
    });
  });
});
