// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentAvatarUpload } from './useAgentAvatarUpload';

const mocks = vi.hoisted(() => ({
  imageToBase64: vi.fn(() => 'data:image/webp;base64,cmVzaXplZA=='),
  mapEnterpriseError: vi.fn<(cause: unknown) => { code: string } | undefined>(() => undefined),
  toastError: vi.fn(),
  uploadAvatar: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@lobehub/ui/base-ui', () => ({ toast: { error: mocks.toastError } }));
vi.mock('@/enterprise/client/services/adminAgents', () => ({
  adminAgentsService: { uploadAvatar: mocks.uploadAvatar },
}));
vi.mock('@/enterprise/client/errors/mapEnterpriseError', () => ({
  mapEnterpriseError: (cause: unknown) => mocks.mapEnterpriseError(cause),
}));
vi.mock('@/utils/imageToBase64', () => ({ imageToBase64: () => mocks.imageToBase64() }));

/** happy-dom decodes no images, so the re-encode path is driven by a scripted element. */
class StubImage {
  private listeners: Record<string, (() => void)[]> = {};
  set src(_value: string) {
    queueMicrotask(() => this.listeners.load?.forEach((listener) => listener()));
  }
  addEventListener(type: string, listener: () => void) {
    (this.listeners[type] ??= []).push(listener);
  }
}

const webpFile = () => new File([new Uint8Array([1, 2, 3])], 'avatar.webp', { type: 'image/webp' });
const pngFile = () => new File([new Uint8Array([4, 5, 6])], 'logo.png', { type: 'image/png' });

const renderUpload = () => {
  const onUploaded = vi.fn();
  const hook = renderHook(() => useAgentAvatarUpload({ onUploaded }));
  return { hook, onUploaded };
};

beforeEach(() => {
  mocks.imageToBase64.mockClear();
  mocks.mapEnterpriseError.mockReset().mockReturnValue(undefined);
  mocks.toastError.mockReset();
  mocks.uploadAvatar.mockReset().mockResolvedValue({
    height: 256,
    mimeType: 'image/webp',
    url: 'https://files.example.com/avatar.webp',
    width: 256,
  });
  vi.stubGlobal('Image', StubImage);
  vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: () => 'req-1' });
});

describe('useAgentAvatarUpload', () => {
  it('uploads the bytes alone and writes back only the hosted URL', async () => {
    const { hook, onUploaded } = renderUpload();

    await act(async () => {
      await hook.result.current.upload(webpFile());
    });

    expect(mocks.uploadAvatar).toHaveBeenCalledWith({
      // The prefix is a transport detail of the data URL, never part of the payload.
      bytesBase64: expect.not.stringContaining('data:'),
      fileName: 'avatar.webp',
      requestId: 'req-1',
    });
    expect(onUploaded).toHaveBeenCalledWith('https://files.example.com/avatar.webp');
    // A webp already arrives square and downsized, so it is never re-encoded.
    expect(mocks.imageToBase64).not.toHaveBeenCalled();
  });

  it('normalises anything that is not already a webp before uploading it', async () => {
    const { hook } = renderUpload();

    await act(async () => {
      await hook.result.current.upload(pngFile());
    });

    expect(mocks.imageToBase64).toHaveBeenCalledOnce();
    expect(mocks.uploadAvatar).toHaveBeenCalledWith(
      expect.objectContaining({ bytesBase64: 'cmVzaXplZA==', fileName: 'avatar.webp' }),
    );
  });

  it('reports a failure and leaves the stored avatar untouched', async () => {
    mocks.uploadAvatar.mockRejectedValue(new Error('offline'));
    const { hook, onUploaded } = renderUpload();

    await act(async () => {
      await hook.result.current.upload(webpFile());
    });

    expect(onUploaded).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith('agentCatalog.editor.avatarUploadFailed');
    expect(hook.result.current.uploading).toBe(false);
  });

  it('names the server code when the failure carries one', async () => {
    mocks.uploadAvatar.mockRejectedValue(new Error('denied'));
    mocks.mapEnterpriseError.mockReturnValue({ code: 'PLATFORM_PERMISSION_DENIED' });
    const { hook } = renderUpload();

    await act(async () => {
      await hook.result.current.upload(webpFile());
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      'agentCatalog.editor.avatarUploadFailed (PLATFORM_PERMISSION_DENIED)',
    );
  });

  it('reports the upload as in flight until it settles', async () => {
    let release: (value: { url: string }) => void = () => {};
    mocks.uploadAvatar.mockReturnValue(
      new Promise<{ url: string }>((resolve) => {
        release = resolve;
      }),
    );
    const { hook } = renderUpload();

    let pending: Promise<void>;
    act(() => {
      pending = hook.result.current.upload(webpFile());
    });
    await waitFor(() => expect(hook.result.current.uploading).toBe(true));

    await act(async () => {
      release({ url: 'https://files.example.com/avatar.webp' });
      await pending!;
    });
    expect(hook.result.current.uploading).toBe(false);
  });
});
