import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentEvalRouter } from '../agentEval';

const mocks = vi.hoisted(() => ({
  batchCreate: vi.fn(),
  countByDatasetId: vi.fn(),
  getFileByteArray: vi.fn(),
  getFileContent: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => ({})),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFileByteArray: mocks.getFileByteArray,
    getFileContent: mocks.getFileContent,
  })),
}));

vi.mock('@/database/models/agentEval', () => ({
  AgentEvalBenchmarkModel: vi.fn().mockImplementation(() => ({})),
  AgentEvalDatasetModel: vi.fn().mockImplementation(() => ({})),
  AgentEvalRunModel: vi.fn().mockImplementation(() => ({})),
  AgentEvalRunTopicModel: vi.fn().mockImplementation(() => ({})),
  AgentEvalTestCaseModel: vi.fn().mockImplementation(() => ({
    batchCreate: mocks.batchCreate,
    countByDatasetId: mocks.countByDatasetId,
  })),
}));

vi.mock('@/server/services/agentEvalRun', () => ({
  AgentEvalRunService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@/server/workflows/agentEvalRun', () => ({
  AgentEvalRunWorkflow: vi.fn(),
}));

describe('agentEvalRouter dataset file pathnames', () => {
  const ctx = {
    serverDB: {} as never,
    userId: 'user-1',
  };

  const validPath = 'eval-datasets/hour/dataset.json';
  const jsonPayload = JSON.stringify([{ input: 'hello', expected: 'world' }]);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFileContent.mockResolvedValue(jsonPayload);
    mocks.getFileByteArray.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.countByDatasetId.mockResolvedValue(0);
    mocks.batchCreate.mockResolvedValue([{ id: 'case-1' }]);
  });

  describe('parseDatasetFile', () => {
    it('reads a validated client-upload key', async () => {
      const caller = agentEvalRouter.createCaller(ctx);

      const result = await caller.parseDatasetFile({
        filename: 'dataset.json',
        format: 'json',
        pathname: validPath,
      });

      expect(mocks.getFileContent).toHaveBeenCalledWith(validPath);
      expect(result.headers).toEqual(['input', 'expected']);
      expect(result.totalCount).toBe(1);
    });

    it('rejects an arbitrary object key before reading storage', async () => {
      const caller = agentEvalRouter.createCaller(ctx);

      await expect(
        caller.parseDatasetFile({ pathname: 'generations/images/raw.jpg' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      expect(mocks.getFileContent).not.toHaveBeenCalled();
      expect(mocks.getFileByteArray).not.toHaveBeenCalled();
    });

    it('rejects a files/generations key leaked from another tenant', async () => {
      const caller = agentEvalRouter.createCaller(ctx);

      await expect(
        caller.parseDatasetFile({ pathname: 'files/generations/images/raw.jpg' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      expect(mocks.getFileContent).not.toHaveBeenCalled();
      expect(mocks.getFileByteArray).not.toHaveBeenCalled();
    });
  });

  describe('importDataset', () => {
    const fieldMapping = { input: 'input', expected: 'expected' };

    it('reads a validated client-upload key', async () => {
      const caller = agentEvalRouter.createCaller(ctx);

      const result = await caller.importDataset({
        datasetId: 'ds-1',
        fieldMapping,
        filename: 'dataset.json',
        format: 'json',
        pathname: validPath,
      });

      expect(mocks.getFileContent).toHaveBeenCalledWith(validPath);
      expect(result.count).toBe(1);
    });

    it('rejects parent-directory segments before reading storage', async () => {
      const caller = agentEvalRouter.createCaller(ctx);

      await expect(
        caller.importDataset({
          datasetId: 'ds-1',
          fieldMapping,
          pathname: 'eval-datasets/../secrets/data.json',
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      expect(mocks.getFileContent).not.toHaveBeenCalled();
      expect(mocks.getFileByteArray).not.toHaveBeenCalled();
    });

    it('rejects a files/generations key leaked from another tenant', async () => {
      const caller = agentEvalRouter.createCaller(ctx);

      await expect(
        caller.importDataset({
          datasetId: 'ds-1',
          fieldMapping,
          pathname: 'files/generations/images/raw.jpg',
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      expect(mocks.getFileContent).not.toHaveBeenCalled();
      expect(mocks.getFileByteArray).not.toHaveBeenCalled();
    });
  });
});
