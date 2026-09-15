import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import { auth } from '@/auth';
import { account } from '@/database/schemas/betterAuth';
import { serverDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import authentik from '@/libs/better-auth/sso/providers/authentik';
import { getInitializedIdentityProviderRuntimeArtifact } from '@/server/enterprise/services/identityProvider/startupArtifact';

export const runtime = 'nodejs';

const headers = { 'Cache-Control': 'no-store' };

const unauthorized = () => Response.json({ error: 'unauthorized' }, { headers, status: 401 });
const notFound = () => Response.json({ error: 'not_found' }, { headers, status: 404 });

const authentikEndSessionUrl = (issuer: string): string => {
  const base = issuer.endsWith('/') ? issuer : `${issuer}/`;
  return new URL('end-session/', base).href;
};

const postLogoutRedirectUri = (appUrl: string): string | null => {
  try {
    return new URL('/signin', appUrl).href;
  } catch {
    return null;
  }
};

/**
 * GET /api/auth/oidc/end-session
 *
 * Session-cookie authenticated. Returns Authentik RP-initiated logout form fields
 * while the Better Auth session is still valid. Never logs the ID token.
 */
export const GET = async (request: Request): Promise<Response> => {
  const session = await auth.api.getSession({ headers: request.headers });
  const userId = session?.user?.id;
  if (!userId) return unauthorized();

  let snapshot: ReturnType<typeof getInitializedIdentityProviderRuntimeArtifact>;
  try {
    snapshot = getInitializedIdentityProviderRuntimeArtifact();
  } catch {
    return notFound();
  }

  const issuerByProviderId = new Map<string, string>();
  for (const provider of snapshot.databaseProviders) {
    if (
      !provider.enabled ||
      provider.type !== 'authentik' ||
      !snapshot.providerIds.includes(provider.providerKey)
    ) {
      continue;
    }
    issuerByProviderId.set(provider.providerKey, provider.issuer);
  }

  const env = authentik.checkEnvs();
  const envActive =
    Boolean(env) &&
    snapshot.providerIds.includes(authentik.id) &&
    !snapshot.databaseProviders.some((provider) => provider.providerKey === authentik.id);
  if (envActive && env) {
    issuerByProviderId.set(authentik.id, env.AUTH_AUTHENTIK_ISSUER);
  }

  if (issuerByProviderId.size === 0) return notFound();

  const [row] = await serverDB
    .select({
      idToken: account.idToken,
      providerId: account.providerId,
    })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        inArray(account.providerId, [...issuerByProviderId.keys()]),
        isNotNull(account.idToken),
      ),
    )
    .limit(1);

  const idToken = row?.idToken;
  const issuer = row ? issuerByProviderId.get(row.providerId) : undefined;
  if (!idToken || !issuer) return notFound();

  const redirectUri = postLogoutRedirectUri(appEnv.APP_URL);
  if (!redirectUri) return notFound();

  return Response.json(
    {
      url: authentikEndSessionUrl(issuer),
      method: 'POST',
      fields: {
        id_token_hint: idToken,
        post_logout_redirect_uri: redirectUri,
      },
    },
    { headers },
  );
};
