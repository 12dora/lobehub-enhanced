import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ragEvalRouter } from '../ragEval';

const mocks = vi.hoisted(() => ({
  batchCreate: vi.fn(),
  findByNames: vi.fn(),
  getFileContent: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => ({})),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFileContent: mocks.getFileContent,
  })),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn().mockImplementation(() => ({
    findByNames: mocks.findByNames,
  })),
}));

vi.mock('@/database/models/ragEval', () => ({
  EvalDatasetModel: vi.fn().mockImplementation(() => ({})),
  EvalDatasetRecordModel: vi.fn().mockImplementation(() => ({
    batchCreate: mocks.batchCreate,
  })),
  EvalEvaluationModel: vi.fn().mockImplementation(() => ({})),
  EvaluationRecordModel: vi.fn().mockImplementation(() => ({})),
}));

describe('ragEvalRouter.importDatasetRecords', () => {
  const ctx = {
    serverDB: {} as never,
    userId: 'user-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findByNames.mockResolvedValue([]);
    mocks.batchCreate.mockResolvedValue([{ id: 'rec-1' }]);
    mocks.getFileContent.mockResolvedValue('{"question":"What?","ideal":"Yes"}\n');
  });

  it('reads a validated client-upload key', async () => {
    const caller = ragEvalRouter.createCaller(ctx);

    await caller.importDatasetRecords({
      datasetId: 'ds-1',
      pathname: 'ragEval/hour/dataset.jsonl',
    });

    expect(mocks.getFileContent).toHaveBeenCalledWith('ragEval/hour/dataset.jsonl');
    expect(mocks.batchCreate).toHaveBeenCalled();
  });

  it('rejects an arbitrary object key before reading storage', async () => {
    const caller = ragEvalRouter.createCaller(ctx);

    await expect(
      caller.importDatasetRecords({
        datasetId: 'ds-1',
        pathname: 'user/avatar/user_1/photo.png',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(mocks.getFileContent).not.toHaveBeenCalled();
  });

  it('rejects a files/generations key leaked from another tenant', async () => {
    const caller = ragEvalRouter.createCaller(ctx);

    await expect(
      caller.importDatasetRecords({
        datasetId: 'ds-1',
        pathname: 'files/generations/images/raw.jpg',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(mocks.getFileContent).not.toHaveBeenCalled();
  });
});
