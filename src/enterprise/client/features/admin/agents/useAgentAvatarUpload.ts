'use client';

import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { mapEnterpriseError } from '@/enterprise/client/errors/mapEnterpriseError';
import { adminAgentsService } from '@/enterprise/client/services/adminAgents';
import { imageToBase64 } from '@/utils/imageToBase64';

/** Square edge the stored avatar is normalised to — the same cap the member-facing uploads use. */
const AVATAR_SIZE = 256;
const AVATAR_FILE_NAME = 'avatar.webp';

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(reader.error ?? new Error('avatar read failed')));
    reader.readAsDataURL(file);
  });

/** Re-encode anything that is not already a webp as a square, downsized webp data URL. */
const toWebpDataUrl = async (dataUrl: string): Promise<string> => {
  const img = new Image();
  img.src = dataUrl;
  await new Promise((resolve, reject) => {
    img.addEventListener('load', resolve);
    img.addEventListener('error', reject);
  });
  return imageToBase64({ img, size: AVATAR_SIZE });
};

/** The payload half of an upload: base64 bytes without the `data:<mime>;base64,` prefix. */
export const buildAgentAvatarPayload = async (file: File): Promise<string> => {
  const dataUrl = await readAsDataUrl(file);
  // The picker already hands over a square webp; anything else is normalised the same way, so a
  // multi-megabyte original can never reach the published configuration.
  const webp = file.type === 'image/webp' ? dataUrl : await toWebpDataUrl(dataUrl);
  return webp.slice(webp.indexOf(',') + 1);
};

export interface UseAgentAvatarUploadParams {
  /** Called with the hosted URL the published configuration should store. */
  onUploaded: (url: string) => void;
}

/**
 * Upload an image avatar for the assistant editor. The image never becomes part of the version
 * config: it is stored first, and only the returned URL is written — a data URL in the config
 * would be republished to every assigned member on every save.
 */
export const useAgentAvatarUpload = ({ onUploaded }: UseAgentAvatarUploadParams) => {
  const { t } = useTranslation('admin');
  const [uploading, setUploading] = useState(false);
  /**
   * Only the newest pick may write the avatar or clear the pending state. Two uploads started in a
   * row can settle in either order, and the slower first one landing last would otherwise silently
   * replace the image the admin actually chose — and end the "uploading" state early.
   */
  const latestRequestRef = useRef(0);
  // Nothing may be reported after the modal closes: the form state is gone and a toast then belongs
  // to a dialog the admin already dismissed.
  const mountedRef = useRef(true);
  useEffect(() => {
    // Re-armed on every mount: StrictMode's mount → unmount → remount must not leave it false.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const upload = useCallback(
    async (file: File) => {
      const requestId = latestRequestRef.current + 1;
      latestRequestRef.current = requestId;
      setUploading(true);
      try {
        const { url } = await adminAgentsService.uploadAvatar({
          bytesBase64: await buildAgentAvatarPayload(file),
          fileName: AVATAR_FILE_NAME,
          requestId: crypto.randomUUID(),
        });
        if (!mountedRef.current || latestRequestRef.current !== requestId) return;
        onUploaded(url);
      } catch (cause) {
        if (!mountedRef.current || latestRequestRef.current !== requestId) return;
        // The stable code is the only part of a server failure worth showing an operator.
        const code = mapEnterpriseError(cause)?.code;
        const message = t('agentCatalog.editor.avatarUploadFailed');
        toast.error(code ? `${message} (${code})` : message);
      } finally {
        // Superseded uploads leave the flag alone — it belongs to the request still in flight.
        if (mountedRef.current && latestRequestRef.current === requestId) setUploading(false);
      }
    },
    [onUploaded, t],
  );

  return { upload, uploading };
};
