import { createHash, timingSafeEqual } from 'node:crypto';

import { BROKER_TOKEN_MIN } from './constants.ts';

export function assertBrokerToken(token: string | undefined): string {
  if (typeof token !== 'string' || token.length < BROKER_TOKEN_MIN) {
    throw new Error('DWS_BROKER_TOKEN 长度必须不少于 32');
  }
  return token;
}

/** Constant-time bearer check. Length differences still compare equal-length digests. */
export function bearerAuthorized(header: string | undefined, token: string): boolean {
  const presented = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const left = createHash('sha256').update(presented).digest();
  const right = createHash('sha256').update(token).digest();
  return presented.length > 0 && timingSafeEqual(left, right);
}
