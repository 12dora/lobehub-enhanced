import { describe, expect, it } from 'vitest';

import { getClientIP, getTrustedProxyClientIP } from './clientIP';

describe('getClientIP', () => {
  // Helper function to create Headers object
  const createHeaders = (entries: [string, string][]) => {
    return new Headers(entries);
  };

  it('should return null when no IP headers are present', () => {
    const headers = createHeaders([]);
    expect(getClientIP(headers)).toBe('');
  });

  it('should handle Cloudflare IP header', () => {
    const headers = createHeaders([['cf-connecting-ip', '1.2.3.4']]);
    expect(getClientIP(headers)).toBe('1.2.3.4');
  });

  it('should handle x-forwarded-for with single IP', () => {
    const headers = createHeaders([['x-forwarded-for', '5.6.7.8']]);
    expect(getClientIP(headers)).toBe('5.6.7.8');
  });

  it('should handle x-forwarded-for with multiple IPs and return the first one', () => {
    const headers = createHeaders([['x-forwarded-for', '9.10.11.12, 13.14.15.16, 17.18.19.20']]);
    expect(getClientIP(headers)).toBe('9.10.11.12');
  });

  it('should handle x-real-ip header', () => {
    const headers = createHeaders([['x-real-ip', '21.22.23.24']]);
    expect(getClientIP(headers)).toBe('21.22.23.24');
  });

  it('should trim whitespace from IP addresses', () => {
    const headers = createHeaders([['x-client-ip', '  25.26.27.28  ']]);
    expect(getClientIP(headers)).toBe('25.26.27.28');
  });

  it('should respect header priority order', () => {
    const headers = createHeaders([
      ['x-forwarded-for', '1.1.1.1'],
      ['cf-connecting-ip', '2.2.2.2'], // Should take precedence
      ['x-real-ip', '3.3.3.3'],
    ]);
    expect(getClientIP(headers)).toBe('2.2.2.2');
  });

  it('should handle empty x-forwarded-for value', () => {
    const headers = createHeaders([['x-forwarded-for', '']]);
    expect(getClientIP(headers)).toBe('');
  });
});

describe('getTrustedProxyClientIP', () => {
  it('takes the last x-forwarded-for hop (Caddy appends the real client)', () => {
    const headers = new Headers([['x-forwarded-for', '1.1.1.1, 203.0.113.10']]);
    expect(getTrustedProxyClientIP(headers)).toBe('203.0.113.10');
  });

  it('ignores a spoofed first hop and client-settable headers', () => {
    const headers = new Headers([
      ['cf-connecting-ip', '8.8.8.8'],
      ['x-client-ip', '9.9.9.9'],
      ['x-forwarded-for', '1.1.1.1, 203.0.113.10'],
      ['x-real-ip', '10.0.0.1'],
    ]);
    expect(getTrustedProxyClientIP(headers)).toBe('203.0.113.10');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const headers = new Headers([
      ['cf-connecting-ip', '8.8.8.8'],
      ['x-real-ip', '203.0.113.20'],
    ]);
    expect(getTrustedProxyClientIP(headers)).toBe('203.0.113.20');
  });

  it('falls back to the socket address when proxy headers are missing', () => {
    expect(getTrustedProxyClientIP(new Headers(), '198.51.100.9')).toBe('198.51.100.9');
  });
});
