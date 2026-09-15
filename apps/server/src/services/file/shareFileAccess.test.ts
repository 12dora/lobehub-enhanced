// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { files, messages, messagesFiles, topicShares } from '@/database/schemas';

import { resolveShareFileAccess } from './shareFileAccess';

const createDb = (rows: unknown[] = []) => {
  const limit = vi.fn(async () => rows);
  const where = vi.fn(() => ({ limit }));
  const innerJoin = vi.fn();
  innerJoin.mockImplementation(() => ({ innerJoin, where }));
  const from = vi.fn(() => ({ innerJoin }));
  const select = vi.fn(() => ({ from }));

  return {
    db: { select } as unknown as LobeChatDatabase,
    from,
    innerJoin,
    limit,
    select,
    where,
  };
};

describe('resolveShareFileAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when the joined query finds a row', async () => {
    const { db, from, innerJoin, limit, select, where } = createDb([{ id: 'share-1' }]);

    await expect(
      resolveShareFileAccess({ db, fileId: 'file-1', shareId: 'share-1' }),
    ).resolves.toBe(true);

    expect(select).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledWith(topicShares);
    expect(innerJoin).toHaveBeenNthCalledWith(1, messages, expect.anything());
    expect(innerJoin).toHaveBeenNthCalledWith(2, messagesFiles, expect.anything());
    expect(innerJoin).toHaveBeenNthCalledWith(3, files, expect.anything());
    expect(where).toHaveBeenCalledOnce();
    expect(limit).toHaveBeenCalledWith(1);
  });

  it('returns false when the joined query is empty', async () => {
    const { db } = createDb([]);

    await expect(
      resolveShareFileAccess({ db, fileId: 'file-1', shareId: 'missing' }),
    ).resolves.toBe(false);
  });
});
