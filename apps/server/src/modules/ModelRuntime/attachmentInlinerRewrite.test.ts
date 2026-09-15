// @vitest-environment node
import type { OpenAIChatMessage } from '@lobechat/model-runtime';
import { buildOwnDeploymentOrigins } from '@lobechat/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createOwnOriginAttachmentRewriteHooks,
  rewriteOwnOriginAttachmentUrls,
  rewriteOwnOriginUrls,
} from './attachmentInliner';

const fileServiceMocks = vi.hoisted(() => ({
  ctorCalls: [] as Array<{ userId: string; workspaceId?: string }>,
  getFileByteArray: vi.fn(),
  getMachineReadableUrl: vi.fn(),
}));

const fileModelMocks = vi.hoisted(() => ({
  constructorCalls: [] as unknown[][],
  findById: vi.fn(),
  getFileById: vi.fn(),
  getFilesByIds: vi.fn(),
}));

const fileAccessMocks = vi.hoisted(() => ({
  resolveFileAccess: vi.fn(),
}));

vi.mock('@/server/services/file', () => ({
  FileService: class FileService {
    constructor(_db: unknown, userId: string, workspaceId?: string) {
      fileServiceMocks.ctorCalls.push({ userId, workspaceId });
    }
    getFileByteArray = fileServiceMocks.getFileByteArray;
    getMachineReadableUrl = fileServiceMocks.getMachineReadableUrl;
  },
}));

vi.mock('@/server/services/file/fileAccess', () => ({
  resolveFileAccess: (...args: unknown[]) => fileAccessMocks.resolveFileAccess(...args),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: class FileModel {
    static getFileById = (...args: unknown[]) => fileModelMocks.getFileById(...args);
    static getFilesByIds = (...args: unknown[]) => fileModelMocks.getFilesByIds(...args);
    findById = fileModelMocks.findById;
    constructor(...args: unknown[]) {
      fileModelMocks.constructorCalls.push(args);
    }
  },
}));

const ownOrigins = buildOwnDeploymentOrigins({
  appUrl: 'http://localhost:3010',
});

const s3Origins = buildOwnDeploymentOrigins({
  appUrl: 'http://localhost:3010',
  bucket: 'lobe-files',
  endpoint: 'http://localhost:9000',
  forcePathStyle: true,
});

const OWN_FILE_URL = 'http://localhost:3010/f/file-1';
const OWN_VIDEO_URL = 'http://localhost:3010/f/file-video';
const FOREIGN_ID_URL = 'http://localhost:3010/f/file-foreign';
const FOREIGN_HOST_URL = 'https://cdn.example.com/cat.png';
const S3_URL = 'http://localhost:9000/lobe-files/secret.png';
const DATA_URI = 'data:image/png;base64,aaaa';
const PREVIEW_URL = 'https://presigned.example.com/files/cat.png';
const VIDEO_PREVIEW_URL = 'https://presigned.example.com/files/clip.mp4';

const imageMessage = (
  url: string,
  role: OpenAIChatMessage['role'] = 'user',
): OpenAIChatMessage => ({
  content: [{ image_url: { url }, type: 'image_url' }],
  role,
});

describe('rewriteOwnOriginAttachmentUrls', () => {
  it('replaces own-origin image/file/video URLs and leaves the rest', async () => {
    const resolvePreviewUrl = vi.fn(async (url: string) => {
      if (url === OWN_FILE_URL) return PREVIEW_URL;
      if (url === OWN_VIDEO_URL) return VIDEO_PREVIEW_URL;
      return null;
    });
    const messages: OpenAIChatMessage[] = [
      imageMessage(OWN_FILE_URL),
      imageMessage(FOREIGN_HOST_URL),
      imageMessage(DATA_URI),
      {
        content: [
          {
            file_url: {
              fileId: 'file-1',
              mimeType: 'application/pdf',
              name: 'report.pdf',
              url: OWN_FILE_URL,
            },
            type: 'file_url',
          },
          { type: 'video_url', video_url: { url: OWN_VIDEO_URL } },
        ],
        role: 'user',
      },
    ];

    await rewriteOwnOriginAttachmentUrls(messages, ownOrigins, resolvePreviewUrl);

    expect(messages[0].content).toEqual([{ image_url: { url: PREVIEW_URL }, type: 'image_url' }]);
    expect(messages[1].content).toEqual([
      { image_url: { url: FOREIGN_HOST_URL }, type: 'image_url' },
    ]);
    expect(messages[2].content).toEqual([{ image_url: { url: DATA_URI }, type: 'image_url' }]);
    expect(messages[3].content).toEqual([
      {
        file_url: {
          fileId: 'file-1',
          mimeType: 'application/pdf',
          name: 'report.pdf',
          url: PREVIEW_URL,
        },
        type: 'file_url',
      },
      { type: 'video_url', video_url: { url: VIDEO_PREVIEW_URL } },
    ]);
    expect(resolvePreviewUrl).toHaveBeenCalledTimes(2);
  });

  it('rewrites an own-origin audio_url', async () => {
    const resolvePreviewUrl = vi.fn(async () => PREVIEW_URL);
    const messages: OpenAIChatMessage[] = [
      {
        content: [{ audio_url: { url: OWN_FILE_URL }, type: 'audio_url' }],
        role: 'user',
      },
    ];

    await rewriteOwnOriginAttachmentUrls(messages, ownOrigins, resolvePreviewUrl);

    expect(messages[0].content).toEqual([{ audio_url: { url: PREVIEW_URL }, type: 'audio_url' }]);
    expect(resolvePreviewUrl).toHaveBeenCalledTimes(1);
  });

  it('rewrites url attributes inside files_info and leaves text outside the block', async () => {
    const resolvePreviewUrl = vi.fn(async (url: string) =>
      url === OWN_FILE_URL ? PREVIEW_URL : null,
    );
    const messages: OpenAIChatMessage[] = [
      {
        content: `please fetch url="${OWN_FILE_URL}"\n<files_info><image name="own" url="${OWN_FILE_URL}"></image> <image name="foreign" url="${FOREIGN_HOST_URL}"></image></files_info>`,
        role: 'user',
      },
    ];

    await rewriteOwnOriginAttachmentUrls(messages, ownOrigins, resolvePreviewUrl);

    expect(messages[0].content).toBe(
      `please fetch url="${OWN_FILE_URL}"\n<files_info><image name="own" url="${PREVIEW_URL}"></image> <image name="foreign" url="${FOREIGN_HOST_URL}"></image></files_info>`,
    );
    expect(resolvePreviewUrl).toHaveBeenCalledTimes(1);
  });

  it('leaves a URL in place when the resolver returns null', async () => {
    const messages = [imageMessage(OWN_FILE_URL)];

    await rewriteOwnOriginAttachmentUrls(messages, ownOrigins, async () => null);

    expect(messages[0].content).toEqual([{ image_url: { url: OWN_FILE_URL }, type: 'image_url' }]);
  });
});

describe('rewriteOwnOriginUrls', () => {
  it('rewrites own-origin imageUrls and leaves foreign/data URIs', async () => {
    const resolvePreviewUrl = vi.fn(async (url: string) =>
      url === OWN_FILE_URL ? PREVIEW_URL : null,
    );

    await expect(
      rewriteOwnOriginUrls(
        [OWN_FILE_URL, FOREIGN_HOST_URL, DATA_URI, OWN_FILE_URL],
        ownOrigins,
        resolvePreviewUrl,
      ),
    ).resolves.toEqual([PREVIEW_URL, FOREIGN_HOST_URL, DATA_URI, PREVIEW_URL]);
    expect(resolvePreviewUrl).toHaveBeenCalledTimes(1);
  });

  it('does not resolve a raw S3 object URL', async () => {
    const resolvePreviewUrl = vi.fn();

    await expect(rewriteOwnOriginUrls([S3_URL], s3Origins, resolvePreviewUrl)).resolves.toEqual([
      S3_URL,
    ]);
    expect(resolvePreviewUrl).not.toHaveBeenCalled();
  });

  it('returns the same array when nothing is rewritten', async () => {
    const urls = [S3_URL];
    const resolvePreviewUrl = vi.fn();

    await expect(rewriteOwnOriginUrls(urls, s3Origins, resolvePreviewUrl)).resolves.toBe(urls);
    expect(resolvePreviewUrl).not.toHaveBeenCalled();
  });

  it('skips non-string entries without throwing', async () => {
    const urls = [null, OWN_FILE_URL, 12] as unknown as string[];
    const resolvePreviewUrl = vi.fn(async () => PREVIEW_URL);

    await expect(rewriteOwnOriginUrls(urls, ownOrigins, resolvePreviewUrl)).resolves.toEqual([
      null,
      PREVIEW_URL,
      12,
    ]);
  });
});

describe('createOwnOriginAttachmentRewriteHooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fileServiceMocks.ctorCalls.length = 0;
    fileModelMocks.constructorCalls.length = 0;
    fileServiceMocks.getFileByteArray.mockReset();
    fileServiceMocks.getMachineReadableUrl.mockReset();
    fileServiceMocks.getMachineReadableUrl.mockImplementation(
      async (file: { url?: string | null }) =>
        file.url ? `https://presigned.example.com/${file.url}` : '',
    );
    fileModelMocks.getFileById.mockReset();
    fileModelMocks.getFileById.mockResolvedValue(undefined);
    fileModelMocks.getFilesByIds.mockReset();
    fileModelMocks.getFilesByIds.mockImplementation(async (db: unknown, ids: string[]) => {
      const rows: unknown[] = [];
      for (const id of ids) {
        const row = await fileModelMocks.getFileById(db, id);
        if (row) rows.push({ ...(row as object), id });
      }
      return rows;
    });
    fileModelMocks.findById.mockReset();
    fileAccessMocks.resolveFileAccess.mockReset();
    fileAccessMocks.resolveFileAccess.mockResolvedValue({ allowed: true, reason: 'owner' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rewrites an OpenAI-compatible own-origin /f/<id> image URL to a presigned URL', async () => {
    fileModelMocks.getFileById.mockResolvedValue({
      fileType: 'image/png',
      size: 12,
      url: 'files/cat.png',
    } as never);

    const messages = [imageMessage(OWN_FILE_URL)];
    const hooks = createOwnOriginAttachmentRewriteHooks({
      db: {} as never,
      ownOrigins,
      userId: 'user-1',
      workspaceId: 'ws-1',
    });

    await hooks.beforeChat?.({ messages, model: 'gpt-4o' } as never);

    expect(fileServiceMocks.ctorCalls).toEqual([{ userId: 'user-1', workspaceId: 'ws-1' }]);
    expect(fileModelMocks.constructorCalls).toEqual([]);
    expect(fileModelMocks.getFileById).toHaveBeenCalledWith({}, 'file-1');
    expect(fileModelMocks.getFilesByIds).toHaveBeenCalledTimes(1);
    expect(fileModelMocks.getFilesByIds).toHaveBeenCalledWith({}, ['file-1']);
    expect(fileModelMocks.findById).not.toHaveBeenCalled();
    expect(fileAccessMocks.resolveFileAccess).toHaveBeenCalledWith(
      expect.objectContaining({ viewerUserId: 'user-1' }),
    );
    expect(fileServiceMocks.getFileByteArray).not.toHaveBeenCalled();
    expect(fileServiceMocks.getMachineReadableUrl).toHaveBeenCalledWith({
      id: 'file-1',
      url: 'files/cat.png',
    });
    expect(messages[0].content).toEqual([
      { image_url: { url: 'https://presigned.example.com/files/cat.png' }, type: 'image_url' },
    ]);
  });

  it('leaves foreign and unknown ids as-is', async () => {
    fileModelMocks.getFileById.mockResolvedValue(undefined);

    const messages = [imageMessage(FOREIGN_ID_URL)];
    const hooks = createOwnOriginAttachmentRewriteHooks({
      db: {} as never,
      ownOrigins,
      userId: 'user-1',
    });

    await hooks.beforeChat?.({ messages, model: 'gpt-4o' } as never);

    expect(fileModelMocks.getFileById).toHaveBeenCalledWith({}, 'file-foreign');
    expect(fileModelMocks.findById).not.toHaveBeenCalled();
    expect(fileServiceMocks.getMachineReadableUrl).not.toHaveBeenCalled();
    expect(messages[0].content).toEqual([
      { image_url: { url: FOREIGN_ID_URL }, type: 'image_url' },
    ]);
  });

  it('leaves non-own-origin URLs untouched', async () => {
    const messages = [imageMessage(FOREIGN_HOST_URL), imageMessage(S3_URL)];
    const hooks = createOwnOriginAttachmentRewriteHooks({
      db: {} as never,
      ownOrigins: s3Origins,
      userId: 'user-1',
    });

    await hooks.beforeChat?.({ messages, model: 'gpt-4o' } as never);

    expect(fileModelMocks.findById).not.toHaveBeenCalled();
    expect(fileModelMocks.getFileById).not.toHaveBeenCalled();
    expect(fileServiceMocks.getMachineReadableUrl).not.toHaveBeenCalled();
    expect(messages[0].content).toEqual([
      { image_url: { url: FOREIGN_HOST_URL }, type: 'image_url' },
    ]);
    expect(messages[1].content).toEqual([{ image_url: { url: S3_URL }, type: 'image_url' }]);
  });

  it('does not rewrite and does not look up files when userId is missing', async () => {
    const messages = [imageMessage(OWN_FILE_URL)];
    const hooks = createOwnOriginAttachmentRewriteHooks({
      db: {} as never,
      ownOrigins,
    });

    await hooks.beforeChat?.({ messages, model: 'gpt-4o' } as never);

    expect(fileServiceMocks.ctorCalls).toEqual([]);
    expect(fileModelMocks.constructorCalls).toEqual([]);
    expect(fileModelMocks.findById).not.toHaveBeenCalled();
    expect(fileModelMocks.getFileById).not.toHaveBeenCalled();
    expect(fileServiceMocks.getMachineReadableUrl).not.toHaveBeenCalled();
    expect(messages[0].content).toEqual([{ image_url: { url: OWN_FILE_URL }, type: 'image_url' }]);
  });

  it('presigns over-size files (no inline cap) and rewrites video_url', async () => {
    fileModelMocks.getFileById.mockImplementation(async (_db: unknown, id: string) => {
      if (id === 'file-1')
        return { fileType: 'image/png', size: 80 * 1024 * 1024, url: 'files/huge.png' };
      if (id === 'file-video')
        return { fileType: 'video/mp4', size: 12 * 1024 * 1024, url: 'files/clip.mp4' };
      return undefined;
    });

    const messages: OpenAIChatMessage[] = [
      imageMessage(OWN_FILE_URL),
      {
        content: [{ type: 'video_url', video_url: { url: OWN_VIDEO_URL } }],
        role: 'user',
      },
    ];
    const hooks = createOwnOriginAttachmentRewriteHooks({
      db: {} as never,
      ownOrigins,
      userId: 'user-1',
    });

    await hooks.beforeChat?.({ messages, model: 'gpt-4o' } as never);

    expect(fileServiceMocks.getFileByteArray).not.toHaveBeenCalled();
    expect(messages[0].content).toEqual([
      { image_url: { url: 'https://presigned.example.com/files/huge.png' }, type: 'image_url' },
    ]);
    expect(messages[1].content).toEqual([
      {
        type: 'video_url',
        video_url: { url: 'https://presigned.example.com/files/clip.mp4' },
      },
    ]);
  });

  it('applies the same rewrite to beforeCreateImage imageUrls', async () => {
    fileModelMocks.getFileById.mockResolvedValue({
      fileType: 'image/png',
      size: 12,
      url: 'files/cat.png',
    } as never);

    const params = { imageUrls: [OWN_FILE_URL, S3_URL], prompt: 'edit' };
    const hooks = createOwnOriginAttachmentRewriteHooks({
      db: {} as never,
      ownOrigins: s3Origins,
      userId: 'user-1',
    });

    await hooks.beforeCreateImage?.({ model: 'dall-e-3', params } as never);

    expect(params.imageUrls).toEqual(['https://presigned.example.com/files/cat.png', S3_URL]);
    expect(fileServiceMocks.getFileByteArray).not.toHaveBeenCalled();
  });

  it('rewrites beforeCreateImage imageUrl (singular) the same way as imageUrls', async () => {
    fileModelMocks.getFileById.mockResolvedValue({
      fileType: 'image/png',
      size: 12,
      url: 'files/cat.png',
    } as never);

    const params = { imageUrl: OWN_FILE_URL, imageUrls: [] as string[], prompt: 'edit' };
    const hooks = createOwnOriginAttachmentRewriteHooks({
      db: {} as never,
      ownOrigins,
      userId: 'user-1',
    });

    await hooks.beforeCreateImage?.({ model: 'dall-e-3', params } as never);

    expect(params.imageUrl).toBe('https://presigned.example.com/files/cat.png');
    expect(params.imageUrls).toEqual([]);
  });

  it('does not look up files in beforeCreateImage when userId is missing', async () => {
    const params = { imageUrls: [OWN_FILE_URL], prompt: 'edit' };
    const hooks = createOwnOriginAttachmentRewriteHooks({
      db: {} as never,
      ownOrigins,
    });

    await hooks.beforeCreateImage?.({ model: 'dall-e-3', params } as never);

    expect(fileServiceMocks.ctorCalls).toEqual([]);
    expect(fileModelMocks.getFileById).not.toHaveBeenCalled();
    expect(params.imageUrls).toEqual([OWN_FILE_URL]);
  });

  it('rewrites beforeCreateVideo imageUrl, imageUrls and endImageUrl', async () => {
    fileModelMocks.getFileById.mockImplementation(async (_db: unknown, id: string) => ({
      fileType: 'image/png',
      size: 12,
      url: `files/${id}.png`,
    }));

    const startUrl = 'http://localhost:3010/f/file-start';
    const midUrl = 'http://localhost:3010/f/file-mid';
    const endUrl = 'http://localhost:3010/f/file-end';
    const params = {
      endImageUrl: endUrl,
      imageUrl: startUrl,
      imageUrls: [midUrl, S3_URL],
      prompt: 'animate',
    };
    const hooks = createOwnOriginAttachmentRewriteHooks({
      db: {} as never,
      ownOrigins: s3Origins,
      userId: 'user-1',
    });

    await hooks.beforeCreateVideo?.({ model: 'veo', params } as never);

    expect(params.imageUrl).toBe('https://presigned.example.com/files/file-start.png');
    expect(params.imageUrls).toEqual(['https://presigned.example.com/files/file-mid.png', S3_URL]);
    expect(params.endImageUrl).toBe('https://presigned.example.com/files/file-end.png');
    expect(fileServiceMocks.getFileByteArray).not.toHaveBeenCalled();
    expect(fileModelMocks.getFilesByIds).toHaveBeenCalledTimes(1);
    const batchedIds = [...(fileModelMocks.getFilesByIds.mock.calls[0]?.[1] as string[])].sort();
    expect(batchedIds).toEqual(['file-end', 'file-mid', 'file-start']);
  });

  it('does not look up files in beforeCreateVideo when userId is missing', async () => {
    const params = { imageUrl: OWN_FILE_URL, prompt: 'animate' };
    const hooks = createOwnOriginAttachmentRewriteHooks({
      db: {} as never,
      ownOrigins,
    });

    await hooks.beforeCreateVideo?.({ model: 'veo', params } as never);

    expect(fileServiceMocks.ctorCalls).toEqual([]);
    expect(fileModelMocks.getFilesByIds).not.toHaveBeenCalled();
    expect(params.imageUrl).toBe(OWN_FILE_URL);
  });

  it('batches distinct /f/ ids of one hook call into a single getFilesByIds', async () => {
    fileModelMocks.getFileById.mockImplementation(async (_db: unknown, id: string) => ({
      fileType: 'image/png',
      size: 12,
      url: `files/${id}.png`,
    }));

    const messages = [
      imageMessage('http://localhost:3010/f/file-a'),
      imageMessage('http://localhost:3010/f/file-b'),
    ];
    const hooks = createOwnOriginAttachmentRewriteHooks({
      db: {} as never,
      ownOrigins,
      userId: 'user-1',
    });

    await hooks.beforeChat?.({ messages, model: 'gpt-4o' } as never);

    expect(fileModelMocks.getFilesByIds).toHaveBeenCalledTimes(1);
    const batchedIds = [...(fileModelMocks.getFilesByIds.mock.calls[0]?.[1] as string[])].sort();
    expect(batchedIds).toEqual(['file-a', 'file-b']);
  });
});
