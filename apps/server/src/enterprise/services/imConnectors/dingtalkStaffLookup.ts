import { fetchDingTalkContact } from '@/server/services/messenger/platforms/dingtalk/provision';

export interface DingTalkStaffLookupResult {
  name: string | null;
}

/**
 * Best-effort corp display name for a DingTalk staffId. Reuses the provision
 * `user/get` client (`fetchDingTalkContact` / cached `fetchLegacyAppToken`).
 * Returns null when the connector cannot be reached or the staff id is
 * unknown — callers still persist the admin-typed id.
 */
export const lookupDingTalkStaff = async (
  staffId: string,
): Promise<DingTalkStaffLookupResult | null> => {
  const contact = await fetchDingTalkContact(staffId);
  if (!contact) return null;
  return { name: contact.name };
};
