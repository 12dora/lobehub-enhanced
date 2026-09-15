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

export const useDingTalkPushAvailable = () => {
  const { data, isLoading } = useSWR(messengerKeys.availablePlatforms(), () =>
    messengerService.availablePlatforms(),
  );

  return { available: isDingTalkPushAvailable(data), isLoading };
};
