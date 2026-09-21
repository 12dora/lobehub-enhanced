/**
 * Whether this deployment exposes DingTalk approval.
 *
 * Source: `window.__SERVER_CONFIG__.config.enterprise.capabilities.dingtalkApproval`,
 * injected into the SPA shell before the entry evaluates and seeded into the
 * server-config store synchronously, so a nav entry never flashes on and off again.
 *
 * **Fails closed**, unlike the platform module switches: the flag says the DingTalk
 * notify app is configured *and* approval is turned on. A deployment that reports
 * nothing has no DingTalk approval to govern, and offering a rule page there — to a
 * user or to an administrator — would promise automation that cannot run. The payload
 * is injected HTML, so it is read as untrusted rather than as its declared type.
 *
 * Kept in its own dependency-free module because both the owner-facing settings page
 * and the admin nav / page read it, and neither may import the other.
 */
export const readDingTalkApprovalCapability = (enterprise: unknown): boolean => {
  if (!enterprise || typeof enterprise !== 'object') return false;

  const { capabilities } = enterprise as { capabilities?: unknown };
  if (!capabilities || typeof capabilities !== 'object') return false;

  return (capabilities as { dingtalkApproval?: unknown }).dingtalkApproval === true;
};
