/**
 * Per-user IM mapping status published on each `messenger.availablePlatforms` entry.
 * Additive — older clients ignore it.
 *
 * `linked` is true when a `messenger_account_links` row exists for
 * `(userId, platform)`, or (DingTalk only) the user's email matches the
 * `<staffId>@DINGTALK_IDENTITY_EMAIL_DOMAIN` convention used by push.
 */
export interface MessengerPlatformBinding {
  linked: boolean;
  platformUsername?: string | null;
}
