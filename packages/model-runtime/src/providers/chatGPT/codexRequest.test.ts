// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { GenerateObjectSchema } from '../../types';
import {
  ChatGPTCodexOpenAI,
  ChatGPTUpstreamError,
  clipUpstreamText,
  generateChatGPTObject,
  normalizeStrictJsonSchema,
  omitNullOptionalProperties,
  UPSTREAM_ERROR_BODY,
} from './codexRequest';

describe('normalizeStrictJsonSchema', () => {
  it('requires every property and closes objects, including nested ones', () => {
    expect(
      normalizeStrictJsonSchema({
        properties: {
          title: { type: 'string' },
          meta: {
            properties: { source: { type: 'string' } },
            type: 'object',
          },
        },
        required: ['title'],
        type: 'object',
      }),
    ).toEqual({
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        meta: {
          additionalProperties: false,
          properties: { source: { type: ['string', 'null'] } },
          required: ['source'],
          type: ['object', 'null'],
        },
      },
      required: ['title', 'meta'],
      type: 'object',
    });
  });

  it('keeps optional properties nullable instead of inventing a required value', () => {
    expect(
      normalizeStrictJsonSchema({
        properties: {
          note: { type: 'string' },
          title: { type: 'string' },
        },
        required: ['title'],
        type: 'object',
      }),
    ).toEqual({
      additionalProperties: false,
      properties: {
        note: { type: ['string', 'null'] },
        title: { type: 'string' },
      },
      required: ['title', 'note'],
      type: 'object',
    });
  });
});

describe('omitNullOptionalProperties', () => {
  const schema = {
    properties: {
      items: {
        items: {
          properties: { note: { type: 'string' } },
          type: 'object',
        },
        type: 'array',
      },
      note: { type: 'string' },
      title: { type: 'string' },
    },
    required: ['title'],
    type: 'object',
  };

  it('drops an optional null note and leaves the key absent', () => {
    expect(omitNullOptionalProperties({ note: null, title: 'Hi' }, schema)).toEqual({
      title: 'Hi',
    });
    expect(omitNullOptionalProperties({ title: 'Hi' }, schema)).toEqual({ title: 'Hi' });
  });

  it('drops optional nulls inside nested objects and arrays', () => {
    expect(
      omitNullOptionalProperties(
        { items: [{ note: null }, { note: 'kept' }], note: null, title: 'Hi' },
        schema,
      ),
    ).toEqual({ items: [{}, { note: 'kept' }], title: 'Hi' });
  });
});

describe('ChatGPT Codex error body', () => {
  it('keeps a {detail} body the OpenAI SDK would otherwise drop', () => {
    const client = new ChatGPTCodexOpenAI({ apiKey: 'test-token' });
    const error = (
      client as unknown as {
        makeStatusError: (
          status: number,
          body: object,
          message: string | undefined,
          headers: Headers,
        ) => Error & { status?: number };
      }
    ).makeStatusError(
      400,
      { detail: 'Store must be set to false', apiKey: 'sk-supersecretvalue' },
      undefined,
      new Headers(),
    );

    expect(error.message).toContain('{"detail":"Store must be set to false"');
    expect(error.message).not.toContain('sk-supersecretvalue');
    expect(error.message).not.toContain('status code (no body)');
    expect((error as unknown as Record<symbol, unknown>)[UPSTREAM_ERROR_BODY]).toMatchObject({
      detail: 'Store must be set to false',
    });
  });

  it('clips upstream text to 500 characters and redacts bearer tokens', () => {
    const text = `bearer abcdefghijklmnop ${'word '.repeat(150)}`;
    const clipped = clipUpstreamText(text);
    expect(clipped.length).toBe(500);
    expect(clipped).not.toContain('abcdefghijklmnop');
    expect(clipped).toContain('[redacted]');
  });

  it('redacts sensitive JSON fields and long opaque tokens', () => {
    const opaque = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
    const clipped = clipUpstreamText(
      JSON.stringify({
        authorization: 'short-auth',
        detail: 'Store must be set to false',
        nested: { cookie: 'yum', ok: true },
        password: 'hunter2',
        token: opaque,
      }),
    );

    expect(clipped).toContain('Store must be set to false');
    expect(clipped).not.toContain('short-auth');
    expect(clipped).not.toContain('hunter2');
    expect(clipped).not.toContain('yum');
    expect(clipped).not.toContain(opaque);
    expect(clipped.length).toBeLessThanOrEqual(500);
  });
});

const events = async function* (items: unknown[]) {
  for (const item of items) yield item;
};

const schemaWithOptionalNote: GenerateObjectSchema = {
  name: 'topic_title',
  schema: {
    properties: {
      note: { type: 'string' },
      title: { type: 'string' },
    },
    required: ['title'],
    type: 'object',
  },
};

type CodexTextRequest = {
  text: {
    format: {
      schema: { properties: { note: { type: unknown } }; required: string[] };
    };
  };
};

const generateFromEvents = (items: unknown[]) => {
  const create = vi.fn(async (_body: CodexTextRequest) => events(items));
  return {
    create,
    result: generateChatGPTObject({
      client: { responses: { create } } as never,
      payload: {
        messages: [{ content: 'hello', role: 'user' }],
        model: 'gpt-5.6-luna',
        schema: schemaWithOptionalNote,
      },
      prepare: async (payload) => ({ payload }),
    }),
  };
};

const rejection = async (result: Promise<unknown>): Promise<ChatGPTUpstreamError> => {
  try {
    await result;
  } catch (error) {
    return error as ChatGPTUpstreamError;
  }
  throw new Error('expected generateChatGPTObject to throw');
};

describe('generateChatGPTObject terminal events', () => {
  it('returns parsed JSON only after response.completed and omits a null optional note', async () => {
    const { create, result } = generateFromEvents([
      { delta: '{"title":"Hi","note":null}', type: 'response.output_text.delta' },
      {
        response: { output_text: '{"title":"Hi","note":null}' },
        type: 'response.completed',
      },
    ]);

    await expect(result).resolves.toEqual({ title: 'Hi' });
    const sent = create.mock.calls[0]?.[0];
    if (!sent) throw new Error('expected a responses.create call');
    expect(sent.text.format.schema.properties.note.type).toEqual(['string', 'null']);
    expect(sent.text.format.schema.required).toEqual(expect.arrayContaining(['title', 'note']));
  });

  it('throws on response.failed and keeps a non-400 status off the 400 backoff path', async () => {
    const error = await rejection(
      generateFromEvents([
        { delta: '{"title":"Hi"}', type: 'response.output_text.delta' },
        {
          response: { error: { code: 'server_error', message: 'upstream blew up' } },
          type: 'response.failed',
        },
      ]).result,
    );

    expect(error).toBeInstanceOf(ChatGPTUpstreamError);
    expect(error.message).toContain('upstream blew up');
    expect(error.message).toContain('server_error');
    expect(error.status).toBeUndefined();
    expect(error.message).not.toContain('] 400:');
  });

  it('carries HTTP 400 when response.failed includes that status', async () => {
    const error = await rejection(
      generateFromEvents([
        {
          response: {
            error: { code: 'invalid_json_schema', message: 'bad schema', status: 400 },
          },
          type: 'response.failed',
        },
      ]).result,
    );

    expect(error.status).toBe(400);
    expect(error.message).toContain('bad schema');
    expect(error.message).toContain('[chatgpt/gpt-5.6-luna] 400:');
  });

  it('throws on response.incomplete and includes incomplete_details.reason', async () => {
    const error = await rejection(
      generateFromEvents([
        {
          response: {
            incomplete_details: { reason: 'max_output_tokens' },
            output_text: '{"title":"Hi"}',
          },
          type: 'response.incomplete',
        },
      ]).result,
    );

    expect(error.message).toContain('response incomplete: max_output_tokens');
    expect(error.status).toBeUndefined();
  });

  it('throws when the stream ends without response.completed', async () => {
    const error = await rejection(
      generateFromEvents([{ delta: '{"title":"Hi"}', type: 'response.output_text.delta' }]).result,
    );

    expect(error.message).toContain('stream ended without response.completed');
    expect(error.status).toBeUndefined();
  });
});
