/**
 * Stable identity-email seam for the DingTalk login method (kind `dingtalk`).
 *
 * The messenger auto-link / SSO / JIT modules own `buildDingTalkIdentityEmail`; this file
 * re-exports it so the identity-provider adapter does not import concurrently-edited
 * `autoLink.ts` / `sso.ts` / `provision.ts`.
 */
export {
  buildDingTalkIdentityEmail,
  DINGTALK_IDENTITY_EMAIL_DOMAIN,
  resolveDingTalkIdentityEmailDomain,
} from './const';
