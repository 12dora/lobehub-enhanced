// @vitest-environment node
import type { OpenAIChatMessage } from '@lobechat/model-runtime';
import { buildOwnDeploymentOrigins } from '@lobechat/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileModel } from '@/database/models/file';

import {
  createOwnOriginAttachmentRewriteHooks,
  rewriteOwnOriginAttachmentUrls,
  rewriteOwnOriginUrls,
} from './attachmentInliner';

const fileServiceMocks = vi.hoisted(() => ({
  getFileByteArray: vi.fn(),
  getMachineReadableUrl: vi.fn(),
}));

const fileModelMocks = vi.hoisted(() => ({
  ctorCalls: [] as Array<{ userId?: string; workspaceId?: string }>,
  findById: vi.fn(),
}));

vi.mock('@/server/services/file', () => ({
  FileService: class FileService {
    getFileByteArray = fileServiceMocks.getFileByteArray;
    getMachineReadableUrl = fileServiceMocks.getMachineReadableUrl;
  },
}));

vi.mock('@/database/models/file', () => ({
  FileModel: class FileModel {
    static getFileById = async (_db: unknown, _id: string) => undefined;
    findById = fileModelMocks.findById;
    constructor(_db?: unknown, userId?: string, workspaceId?: string) {
      fileModelMocks.ctorCalls.push({ userId, workspaceId });
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
});

describe('createOwnOriginAttachmentRewriteHooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fileModelMocks.ctorCalls.length = 0;
    fileServiceMocks.getFileByteArray.mockReset();
    fileServiceMocks.getMachineReadableUrl.mockReset();
    fileServiceMocks.getMachineReadableUrl.mockImplementation(
      async (file: { url?: string | null }) =>
        file.url ? `https://presigned.example.com/${file.url}` : '',
    );
    fileModelMocks.findById.mockReset();
    fileModelMocks.findById.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rewrites an OpenAI-compatible own-origin /f/<id> image URL to a presigned URL', async () => {
    fileModelMocks.findById.mockResolvedValue({
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

    expect(fileModelMocks.ctorCalls).toEqual([{ userId: 'user-1', workspaceId: 'ws-1' }]);
    expect(fileModelMocks.findById).toHaveBeenCalledWith('file-1');
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
    fileModelMocks.findById.mockResolvedValue(undefined);
    const getFileById = vi.spyOn(FileModel, 'getFileById');

    const messages = [imageMessage(FOREIGN_ID_URL)];
    const hooks = createOwnOriginAttachmentRewriteHooks({
      db: {} as never,
      ownOrigins,
      userId: 'user-1',
    });

    await hooks.beforeChat?.({ messages, model: 'gpt-4o' } as never);

    expect(fileModelMocks.findById).toHaveBeenCalledWith('file-foreign');
    expect(getFileById).not.toHaveBeenCalled();
    expect(fileServiceMocks.getMachineReadableUrl).not.toHaveBeenCalled();
    expect(messages[0].content).toEqual([
      { image_url: { url: FOREIGN_ID_URL }, type: 'image_url' },
    ]);
  });

  it('leaves non-own-origin URLs untouched', async () => {
    const getFileById = vi.spyOn(FileModel, 'getFileById');
    const messages = [imageMessage(FOREIGN_HOST_URL), imageMessage(S3_URL)];
    const hooks = createOwnOriginAttachmentRewriteHooks({
      db: {} as never,
      ownOrigins: s3Origins,
      userId: 'user-1',
    });

    await hooks.beforeChat?.({ messages, model: 'gpt-4o' } as never);

    expect(fileModelMocks.findById).not.toHaveBeenCalled();
    expect(getFileById).not.toHaveBeenCalled();
    expect(fileServiceMocks.getMachineReadableUrl).not.toHaveBeenCalled();
    expect(messages[0].content).toEqual([
      { image_url: { url: FOREIGN_HOST_URL }, type: 'image_url' },
    ]);
    expect(messages[1].content).toEqual([{ image_url: { url: S3_URL }, type: 'image_url' }]);
  });

  it('does not rewrite and does not look up files when userId is missing', async () => {
    const getFileById = vi.spyOn(FileModel, 'getFileById');
    const messages = [imageMessage(OWN_FILE_URL)];
    const hooks = createOwnOriginAttachmentRewriteHooks({
      db: {} as never,
      ownOrigins,
    });

    await hooks.beforeChat?.({ messages, model: 'gpt-4o' } as never);

    expect(fileModelMocks.ctorCalls).toEqual([]);
    expect(fileModelMocks.findById).not.toHaveBeenCalled();
    expect(getFileById).not.toHaveBeenCalled();
    expect(fileServiceMocks.getMachineReadableUrl).not.toHaveBeenCalled();
    expect(messages[0].content).toEqual([{ image_url: { url: OWN_FILE_URL }, type: 'image_url' }]);
  });

  it('presigns over-size files (no inline cap) and rewrites video_url', async () => {
    fileModelMocks.findById.mockImplementation(async (id: string) => {
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

  it('applies the same rewrite to beforeCreateImage', async () => {
    fileModelMocks.findById.mockResolvedValue({
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

  it('does not look up files in beforeCreateImage when userId is missing', async () => {
    const getFileById = vi.spyOn(FileModel, 'getFileById');
    const params = { imageUrls: [OWN_FILE_URL], prompt: 'edit' };
    const hooks = createOwnOriginAttachmentRewriteHooks({
      db: {} as never,
      ownOrigins,
    });

    await hooks.beforeCreateImage?.({ model: 'dall-e-3', params } as never);

    expect(fileModelMocks.ctorCalls).toEqual([]);
    expect(getFileById).not.toHaveBeenCalled();
    expect(params.imageUrls).toEqual([OWN_FILE_URL]);
  });
});
