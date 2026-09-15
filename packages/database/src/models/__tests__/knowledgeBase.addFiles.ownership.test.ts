// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KnowledgeBaseModel } from '../knowledgeBase';

const findByIds = vi.fn();

vi.mock('../file', () => ({
  FileModel: vi.fn(function FileModel() {
    return { findByIds };
  }),
}));

const createDb = () => {
  const inserted: Array<{ fileId: string; knowledgeBaseId: string; userId: string }> = [];

  const db = {
    query: {
      knowledgeBases: {
        findFirst: vi.fn(async () => ({ id: 'kb-1' })),
      },
    },
    insert: vi.fn(() => ({
      values: (rows: Array<{ fileId: string; knowledgeBaseId: string; userId: string }>) => {
        inserted.push(...rows);
        return {
          returning: async () => rows,
        };
      },
    })),
  };

  return { db, inserted };
};

describe('KnowledgeBaseModel.addFilesToKnowledgeBase ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('silently skips file ids the caller cannot see and returns only inserted rows', async () => {
    const { db, inserted } = createDb();
    findByIds.mockImplementation(async (ids: string[]) =>
      ids.filter((id) => id !== 'file_foreign').map((id) => ({ id })),
    );

    const model = new KnowledgeBaseModel(db as never, 'caller-user');
    const result = await model.addFilesToKnowledgeBase('kb-1', [
      'file_owned_a',
      'file_foreign',
      'file_owned_b',
    ]);

    expect(findByIds).toHaveBeenCalledWith(['file_owned_a', 'file_foreign', 'file_owned_b']);
    expect(result).toEqual([
      expect.objectContaining({ fileId: 'file_owned_a', knowledgeBaseId: 'kb-1' }),
      expect.objectContaining({ fileId: 'file_owned_b', knowledgeBaseId: 'kb-1' }),
    ]);
    expect(inserted.map((row) => row.fileId)).toEqual(['file_owned_a', 'file_owned_b']);
  });

  it('returns an empty array when every supplied file id is foreign', async () => {
    const { db, inserted } = createDb();
    findByIds.mockResolvedValue([]);

    const model = new KnowledgeBaseModel(db as never, 'caller-user');
    const result = await model.addFilesToKnowledgeBase('kb-1', ['file_foreign']);

    expect(result).toEqual([]);
    expect(inserted).toEqual([]);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
