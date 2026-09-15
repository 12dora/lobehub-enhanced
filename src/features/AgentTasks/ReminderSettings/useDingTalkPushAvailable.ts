import useSWR from 'swr';

import { messengerKeys } from '@/libs/swr/keys';
import { messengerService } from '@/services/messenger';

interface AvailablePlatformLike {
  capabilities?: { chat?: boolean; push?: boolean };
  id?: string;
}

/**
 * A DingTalk reminder row is only offered when the admin has provisioned the IM
 * connector *and* turned push on. `capabilities` is added by the messenger router;
 * an older payload without it counts as push=false rather than as "assume yes".
 */
export const isDingTalkPushAvailable = (platforms: unknown): boolean =>
  Array.isArray(platforms) &&
  platforms.some((item) => {
    const platform = item as AvailablePlatformLike | null;
    return platform?.id === 'dingtalk' && platform?.capabilities?.push === true;
  });

export type DingTalkPushStatus = 'available' | 'error' | 'loading' | 'unavailable';

/**
 * `unavailable` is a diagnosis ("the admin has not enabled push"), so it must not be
 * reported while the platform list is still in flight or when the request failed —
 * both of those also yield `available === false`, but for reasons the user can act on.
 */
export const useDingTalkPushAvailable = () => {
  const { data, error, isLoading, mutate } = useSWR(messengerKeys.availablePlatforms(), () =>
    messengerService.availablePlatforms(),
  );

  const available = isDingTalkPushAvailable(data);
  const status: DingTalkPushStatus = isLoading
    ? 'loading'
    : error
      ? 'error'
      : available
        ? 'available'
        : 'unavailable';

  return { available, retry: () => mutate(), status };
};
