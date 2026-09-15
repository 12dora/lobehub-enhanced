/**
 * Client IP for rate-limiting when the app sits behind **one** reverse proxy
 * (Caddy) that **appends** the observed peer address to `x-forwarded-for`.
 *
 * With a single trusted proxy, the last XFF hop is the address Caddy added
 * (the real connecting client). Earlier hops are client-settable and ignored.
 * Falls back to `x-real-ip`, then `socketAddress` (direct TCP peer) if the
 * caller can supply it. Other forwarding headers (`cf-connecting-ip`,
 * `x-client-ip`, `forwarded`, …) are not consulted — they are client-settable
 * when Caddy is the only proxy.
 */
export const getTrustedProxyClientIP = (
  headers: Headers,
  socketAddress?: string | null,
): string => {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded
      .split(',')
      .map((hop) => hop.trim())
      .filter((hop) => hop.length > 0);
    const lastHop = hops.at(-1);
    if (lastHop) return lastHop;
  }

  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const socket = socketAddress?.trim();
  if (socket) return socket;

  return '';
};

/**
 * Get client IP address
 * @param headers HTTP request headers
 */
export const getClientIP = (headers: Headers): string => {
  // Check various IP headers in priority order
  const ipHeaders = [
    'cf-connecting-ip', // Cloudflare
    'x-real-ip', // Nginx proxy
    'x-forwarded-for', // Standard proxy header
    'x-client-ip', // Apache
    'true-client-ip', // Akamai and Cloudflare
    'x-cluster-client-ip', // Load balancer
    'forwarded', // RFC 7239
    'fastly-client-ip', // Fastly CDN
    'x-forwarded', // General forward
    'x-original-forwarded-for', // Original forwarded
  ];

  for (const header of ipHeaders) {
    const value = headers.get(header);
    if (!value) continue;

    // Handle cases where multiple IPs may be present (e.g., x-forwarded-for)
    if (header.toLowerCase() === 'x-forwarded-for') {
      const firstIP = value.split(',')[0].trim();
      if (firstIP) return firstIP;
    }

    return value.trim();
  }

  return '';
};
