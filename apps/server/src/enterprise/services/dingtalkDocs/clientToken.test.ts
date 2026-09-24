// @vitest-environment node
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  AITABLE_CREATE_TOKEN_PREFIX,
  aitableCreateClientToken,
  resolveAitableCreateClientToken,
} from './clientToken';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('aitableCreateClientToken', () => {
  it('is a UUID v4 of the sha256 prefix, stable per tool call id', () => {
    const id = 'call_docs_1';
    const token = aitableCreateClientToken(id);
    expect(token).toMatch(UUID_V4);
    expect(aitableCreateClientToken(id)).toBe(token);
    expect(aitableCreateClientToken('call_docs_2')).not.toBe(token);

    const digest = createHash('sha256').update(`${AITABLE_CREATE_TOKEN_PREFIX}${id}`).digest();
    const expected = Buffer.from(digest.subarray(0, 16));
    expected[6] = ((expected[6] ?? 0) & 0x0f) | 0x40;
    expected[8] = ((expected[8] ?? 0) & 0x3f) | 0x80;
    expect(Buffer.from(token.replaceAll('-', ''), 'hex').equals(expected)).toBe(true);
  });

  it('mints a fresh UUID when the tool call id is missing', () => {
    const first = resolveAitableCreateClientToken(undefined);
    const second = resolveAitableCreateClientToken('   ');
    expect(first).toMatch(UUID_V4);
    expect(second).toMatch(UUID_V4);
    expect(second).not.toBe(first);
    expect(resolveAitableCreateClientToken('call_docs_1')).toBe(
      aitableCreateClientToken('call_docs_1'),
    );
  });
});
