import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';

describe('agent documents system prompt', () => {
  it('forbids claiming a failed document exists or inventing a URL', () => {
    expect(systemPrompt).toContain('the document does NOT exist');
    expect(systemPrompt).toContain('Never invent a document URL');
    expect(systemPrompt).toContain('lobehub.cloud');
    expect(systemPrompt).toContain('Put the full document content in the reply');
    expect(systemPrompt).toContain(
      'Only use document URLs that a tool result in this turn actually returned',
    );
  });

  it('tells the model to use the share link from readDocument and never the internal id', () => {
    expect(systemPrompt).toContain(
      'readDocument, createDocument, and content updates all return this share link',
    );
    expect(systemPrompt).toContain('Never build a link from it');
    expect(systemPrompt).toContain('/docs/<uuid>');
  });
});
