import { createHash } from 'node:crypto';

import { isNonEmptyString, isRecord } from '@lobechat/utils/object';
import { createRemoteJWKSet, customFetch, decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';

import { authEnv } from '@/envs/auth';
import { getRedisConfig } from '@/envs/redis';
import { initializeRedis } from '@/libs/redis';
import {
  createSafeOutboundFetchAdapter,
  SafeOutboundHttpClient,
} from '@/server/enterprise/security/outboundHttp';
import { IdentityProviderDiscoveryValidator } from '@/server/enterprise/services/identityProvider/discoveryValidator';
import { resolveIdentityProviderOutboundMode } from '@/server/enterprise/services/identityProvider/outboundMode';
import { getInitializedIdentityProviderRuntimeArtifact } from '@/server/enterprise/services/identityProvider/startupArtifact';

import authentik from './sso/providers/authentik';

const LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';
const MAX_TOKEN_AGE_SECONDS = 300;
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export class InvalidLogoutRequest extends Error {}

const resolveProvider = async (issuer: string) => {
  const snapshot = getInitializedIdentityProviderRuntimeArtifact();
  const providers = snapshot.databaseProviders.filter(
    (provider) =>
      provider.enabled &&
      snapshot.providerIds.includes(provider.providerKey) &&
      (provider.type === 'authentik' || provider.type === 'generic_oidc') &&
      provider.issuer === issuer,
  );
  const env = snapshot.providerIds.includes(authentik.id) && authentik.checkEnvs();
  const envMatches = env && env.AUTH_AUTHENTIK_ISSUER.trim() === issuer;
  if (providers.length + (envMatches ? 1 : 0) !== 1) {
    throw new InvalidLogoutRequest('Unknown or ambiguous logout token issuer');
  }

  if (envMatches) {
    const discovery = new IdentityProviderDiscoveryValidator(
      new SafeOutboundHttpClient({ mode: resolveIdentityProviderOutboundMode(process.env) }),
    );
    const metadata = await discovery.discover(issuer);
    return {
      clientId: env.AUTH_AUTHENTIK_ID,
      issuer,
      jwksUri: metadata.jwksUri,
      providerKey: authentik.id,
    };
  }

  const provider = providers[0]!;
  return {
    clientId: provider.clientId,
    issuer: provider.issuer,
    jwksUri: provider.oidcMetadata.jwksUri,
    providerKey: provider.providerKey,
  };
};

export const verifyBackchannelLogoutToken = async (token: string) => {
  // Only the issuer selects trusted configuration; never fetch a URL supplied by a JWT.
  const { iss } = decodeJwt(token);
  if (!isNonEmptyString(iss)) throw new InvalidLogoutRequest('Missing logout token issuer');
  const provider = await resolveProvider(iss);
  const header = decodeProtectedHeader(token);
  if (!isNonEmptyString(header.kid)) throw new InvalidLogoutRequest('Missing signing key ID');

  let jwks = jwksCache.get(provider.jwksUri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(provider.jwksUri), {
      [customFetch]: createSafeOutboundFetchAdapter(
        new SafeOutboundHttpClient({ mode: resolveIdentityProviderOutboundMode(process.env) }),
        { maxRedirects: 0, maxResponseBytes: 64 * 1024, timeoutMs: 5000 },
      ),
    });
    jwksCache.set(provider.jwksUri, jwks);
  }

  // ID-token verification has different nonce/expiry rules; share the pinned discovery
  // and outbound transport, but validate logout claims independently.
  const { payload } = await jwtVerify(token, jwks, {
    algorithms: ['RS256', 'ES256'],
    audience: provider.clientId,
    issuer: provider.issuer,
    requiredClaims: ['iat', 'jti'],
  });
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(payload.iat) ||
    payload.iat! > now ||
    (payload.exp === undefined && now - payload.iat! > MAX_TOKEN_AGE_SECONDS) ||
    (payload.exp !== undefined &&
      (!Number.isSafeInteger(payload.exp) || payload.exp <= payload.iat!)) ||
    !isNonEmptyString(payload.jti)
  ) {
    throw new InvalidLogoutRequest('Invalid logout token timestamps or jti');
  }
  if (
    'nonce' in payload ||
    !isRecord(payload.events) ||
    !Object.hasOwn(payload.events, LOGOUT_EVENT) ||
    !isRecord(payload.events[LOGOUT_EVENT])
  ) {
    throw new InvalidLogoutRequest('Logout token must contain the logout event and no nonce');
  }
  if (payload.sid !== undefined && !isNonEmptyString(payload.sid)) {
    throw new InvalidLogoutRequest('Invalid logout token sid');
  }
  if (!isNonEmptyString(payload.sub)) {
    throw new InvalidLogoutRequest(
      'Logout token sub is required; sid-only logout is unsupported because sessions do not store sid',
    );
  }

  const redis = await initializeRedis(getRedisConfig());
  // This endpoint requires shared replay protection; a disabled/unavailable Redis fails closed.
  if (!redis) throw new InvalidLogoutRequest('Logout replay storage is unavailable');
  const replayId = createHash('sha256')
    .update(
      JSON.stringify([
        authEnv.AUTH_COOKIE_PREFIX,
        provider.issuer,
        provider.clientId,
        provider.providerKey,
        payload.jti,
      ]),
    )
    .digest('hex');
  const remembered = await redis.set(`oidc:backchannel-logout:${replayId}`, '1', {
    // Without exp, retain through the last second in which iat is accepted.
    exat: payload.exp ?? payload.iat! + MAX_TOKEN_AGE_SECONDS + 1,
    nx: true,
  });
  if (remembered !== 'OK') throw new InvalidLogoutRequest('Logout token jti has already been used');

  return { providerKey: provider.providerKey, sub: payload.sub };
};
