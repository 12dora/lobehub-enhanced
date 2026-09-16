import type { MessengerPlatformBinding } from '@lobechat/types';
import useSWR from 'swr';

import { messengerKeys } from '@/libs/swr/keys';
import { messengerService } from '@/services/messenger';

interface AvailablePlatformLike {
  binding?: MessengerPlatformBinding | null;
  capabilities?: { chat?: boolean; push?: boolean };
  id?: string;
}

const findDingTalk = (platforms: unknown): AvailablePlatformLike | undefined =>
  Array.isArray(platforms)
    ? (platforms.find((item) => (item as AvailablePlatformLike | null)?.id === 'dingtalk') as
        AvailablePlatformLike | undefined)
    : undefined;

/**
 * A DingTalk reminder row is only offered when the admin has provisioned the IM
 * connector *and* turned push on. `capabilities` is added by the messenger router;
 * an older payload without it counts as push=false rather than as "assume yes".
 */
export const isDingTalkPushAvailable = (platforms: unknown): boolean =>
  findDingTalk(platforms)?.capabilities?.push === true;

export interface DingTalkBindingState {
  /**
   * `false` only when the payload positively says the caller has no DingTalk identity.
   * A payload that predates `binding` leaves this `undefined` — unknown, not unlinked —
   * so an older server keeps today's behaviour instead of blocking every user.
   */
  linked?: boolean;
  platformUsername?: string;
}

/**
 * Reads the per-user mapping the messenger router publishes alongside the connector
 * capabilities. Without a mapping every push is dropped server-side (`user_not_mapped`),
 * so the toggle has to know about it even when the connector itself is healthy.
 */
export const readDingTalkBinding = (platforms: unknown): DingTalkBindingState => {
  const binding = findDingTalk(platforms)?.binding;
  if (!binding || typeof binding !== 'object') return {};

  const username = binding.platformUsername;
  return {
    linked: typeof binding.linked === 'boolean' ? binding.linked : undefined,
    platformUsername: typeof username === 'string' && username.length > 0 ? username : undefined,
  };
};

export type DingTalkPushStatus = 'available' | 'error' | 'loading' | 'unavailable' | 'unlinked';

/**
 * `unavailable` ("the admin has not enabled push") and `unlinked` ("this account has no
 * DingTalk identity") are diagnoses, so neither may be reported while the platform list
 * is still in flight or when the request failed — those also yield `available === false`,
 * but for reasons the user can act on differently.
 */
export const useDingTalkPushAvailable = () => {
  const { data, error, isLoading, mutate } = useSWR(messengerKeys.availablePlatforms(), () =>
    messengerService.availablePlatforms(),
  );

  const pushEnabled = isDingTalkPushAvailable(data);
  const { linked, platformUsername } = readDingTalkBinding(data);

  const status: DingTalkPushStatus = isLoading
    ? 'loading'
    : error
      ? 'error'
      : pushEnabled
        ? linked === false
          ? 'unlinked'
          : 'available'
        : 'unavailable';

  const available = status === 'available';

  return {
    available,
    // Only meaningful once push is actually deliverable to this account.
    platformUsername: available ? platformUsername : undefined,
    retry: () => mutate(),
    status,
  };
};
