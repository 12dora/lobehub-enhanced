import {
  AdminReauthBlockedError,
  AdminReauthCancelledError,
} from '@/enterprise/client/features/admin/reauth/requestAdminReauth';
import { getAdminUsersMutationErrorKey } from '@/enterprise/client/features/admin/users/utils';
import type {
  AdminImConnectorBindingsUpsertInput,
  ImConnectorBindingBoundVia,
  ImConnectorPlatform,
} from '@/enterprise/client/services/adminImConnectors';
import { readEnterpriseErrorBodies } from '@/utils/enterpriseErrorBody';

/** Mirrors the contract bounds in `apps/server/src/enterprise/contracts/adminImConnectors.ts`. */
export const DINGTALK_PLATFORM_USER_ID_MAX = 64;
export const IM_CONNECTOR_BINDING_USERNAME_MAX = 200;

/** Error code the upsert answers with when the DingTalk user belongs to another AIHub account. */
export const PLATFORM_USER_ALREADY_BOUND = 'PLATFORM_USER_ALREADY_BOUND';

/** Draft of one manual binding, as the 绑定用户 modal holds it. */
export interface ImConnectorBindingDraft {
  /** DingTalk `userid` from the corp directory. */
  platformUserId: string;
  /** Optional display name; the server looks it up when the connector has credentials. */
  platformUsername: string;
  /** AIHub account the reminders belong to. */
  userId: string;
}

export type ImConnectorBindingFieldErrors = Partial<
  Record<'platformUserId' | 'platformUsername' | 'userId', string>
>;

export const emptyImConnectorBindingDraft = (): ImConnectorBindingDraft => ({
  platformUserId: '',
  platformUsername: '',
  userId: '',
});

/**
 * Mirrors the upsert contract: an AIHub account and a DingTalk userid of 1–64 characters are
 * required, the display name is not. Validating here keeps the modal from spending a round trip on
 * input the schema would reject anyway.
 */
export const validateImConnectorBindingDraft = (
  draft: ImConnectorBindingDraft,
): ImConnectorBindingFieldErrors => {
  const errors: ImConnectorBindingFieldErrors = {};

  if (draft.userId.trim().length === 0) errors.userId = 'required';

  const platformUserId = draft.platformUserId.trim();
  if (platformUserId.length === 0) errors.platformUserId = 'required';
  else if (platformUserId.length > DINGTALK_PLATFORM_USER_ID_MAX) {
    errors.platformUserId = 'tooLong';
  }

  if (draft.platformUsername.trim().length > IM_CONNECTOR_BINDING_USERNAME_MAX) {
    errors.platformUsername = 'tooLong';
  }

  return errors;
};

/**
 * @param force - 改绑. The server then transfers the DingTalk user in ONE transaction (drop the
 *   other account's link row, write this one) instead of refusing with a conflict. Omitted rather
 *   than sent `false` so a plain bind keeps the default refusal.
 */
export const toImConnectorBindingUpsertInput = (
  platform: ImConnectorPlatform,
  draft: ImConnectorBindingDraft,
  force?: boolean,
): AdminImConnectorBindingsUpsertInput => {
  const platformUsername = draft.platformUsername.trim();

  return {
    platform,
    platformUserId: draft.platformUserId.trim(),
    userId: draft.userId.trim(),
    ...(force ? { force: true } : {}),
    // Omitted rather than sent empty: that is what lets the server look the name up itself.
    ...(platformUsername.length > 0 ? { platformUsername } : {}),
  };
};

/** The other AIHub account a DingTalk user is already bound to. */
export interface ImConnectorBindingConflict {
  boundUserEmail: string | null;
  boundUserId: string;
  boundUserName: string | null;
  /**
   * How the server found the occupant. `link` is a `messenger_account_links` row, which 改绑
   * deletes; `identity_email` is an account whose mailbox is `<staffId>@<identity domain>`, which
   * has no row to delete — the two cases need different copy because only `link` costs the other
   * account its reminders.
   */
  boundVia: ImConnectorBindingBoundVia;
}

const readString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * The conflict the upsert rejects a taken DingTalk userid with.
 *
 * The router puts it on the TRPCError's `cause.data`, which the lambda error formatter forwards to
 * the client as `data.errorData` — the same walk every other structured admin error takes. Returns
 * `null` for anything else, so a caller can fall through to its generic failure copy.
 */
export const readImConnectorBindingConflict = (
  error: unknown,
): ImConnectorBindingConflict | null => {
  for (const body of readEnterpriseErrorBodies(error)) {
    if (body.code !== PLATFORM_USER_ALREADY_BOUND) continue;
    const details = body.details as Record<string, unknown> | undefined;
    const boundUserId = readString(details?.boundUserId);
    if (!boundUserId) continue;
    return {
      boundUserEmail: readString(details?.boundUserEmail),
      boundUserId,
      boundUserName: readString(details?.boundUserName),
      // An older server that does not send it can only mean a links row.
      boundVia: details?.boundVia === 'identity_email' ? 'identity_email' : 'link',
    };
  }

  return null;
};

/** How a bound account is named in the conflict banner and the unbind confirmation. */
export const displayBindingUserLabel = (
  name: string | null,
  email: string | null,
  userId: string,
): string => name ?? email ?? userId;

/**
 * Failure copy for a bind that is NOT the already-bound conflict (that one is an inline banner).
 *
 * Goes through the shared admin mapping first, so a missing account reads 用户不存在 and a
 * cancelled re-authentication says so, instead of every failure collapsing into 绑定失败.
 */
export const getImConnectorBindErrorKey = (error: unknown): string => {
  if (error instanceof AdminReauthCancelledError) return 'users.errors.reauthCancelled';
  if (error instanceof AdminReauthBlockedError) return 'users.errors.reauthBlocked';
  const key = getAdminUsersMutationErrorKey(error);
  // The shared generic is about users; this surface has its own retry wording.
  return key === 'users.errors.generic' ? 'systemGeneral.imConnectors.bindings.bindFailed' : key;
};
