import { describe, expect, it, vi } from 'vitest';

import { MANAGED_PLATFORM_DOCUMENT_TOOL_MESSAGE } from '../managedPlatformError';
import { AgentDocumentsExecutionRuntime } from './index';

const createRuntime = (overrides = {}) =>
  new AgentDocumentsExecutionRuntime({
    copyDocument: vi.fn(),
    createDocument: vi.fn(),
    createTopicDocument: vi.fn(),
    listDocuments: vi.fn(),
    listTopicDocuments: vi.fn(),
    modifyNodes: vi.fn(),
    readDocument: vi.fn(),
    removeDocument: vi.fn(),
    renameDocument: vi.fn(),
    replaceDocumentContent: vi.fn(),
    updateLoadRule: vi.fn(),
    ...overrides,
  });

describe('AgentDocumentsExecutionRuntime', () => {
  it('returns agentDocumentId and documentId when creating hinted documents', async () => {
    const createDocument = vi.fn().mockResolvedValue({
      documentId: 'backing-doc-1',
      id: 'agent-doc-1',
      title: 'Reusable Procedure',
    });
    const runtime = createRuntime({ createDocument });

    const result = await runtime.createDocument(
      {
        content: 'steps',
        hintIsSkill: true,
        title: 'Reusable Procedure',
      },
      { agentId: 'agent-1' },
    );

    expect(createDocument).toHaveBeenCalledWith({
      agentId: 'agent-1',
      content: 'steps',
      hintIsSkill: true,
      title: 'Reusable Procedure',
    });
    expect(result.state).toMatchObject({
      agentDocumentId: 'agent-doc-1',
      documentId: 'backing-doc-1',
    });
  });

  it('awaits an async document URL builder', async () => {
    const createDocument = vi.fn().mockResolvedValue({
      documentId: 'docs_backing-doc-1',
      id: 'agent-doc-1',
      title: 'Research Notes',
    });
    const runtime = new AgentDocumentsExecutionRuntime(
      {
        copyDocument: vi.fn(),
        createDocument,
        createTopicDocument: vi.fn(),
        listDocuments: vi.fn(),
        listTopicDocuments: vi.fn(),
        modifyNodes: vi.fn(),
        readDocument: vi.fn(),
        removeDocument: vi.fn(),
        renameDocument: vi.fn(),
        replaceDocumentContent: vi.fn(),
        updateLoadRule: vi.fn(),
      },
      {
        getDocumentUrl: async ({ agentId, documentId }) =>
          `https://app.example.com/acme/agent/${agentId}/docs/${documentId}`,
      },
    );

    const result = await runtime.createDocument(
      {
        content: 'notes',
        title: 'Research Notes',
      },
      { agentId: 'agent-1' },
    );

    expect(result.content).toContain(
      'https://app.example.com/acme/agent/agent-1/docs/docs_backing-doc-1',
    );
  });

  it('forwards tool trigger metadata when creating documents with same-turn tool context', async () => {
    const createDocument = vi.fn().mockResolvedValue({
      documentId: 'backing-doc-1',
      id: 'agent-doc-1',
      title: 'Research Notes',
    });
    const runtime = createRuntime({ createDocument });

    await runtime.createDocument(
      {
        content: 'notes',
        title: 'Research Notes',
      },
      {
        agentId: 'agent-1',
        messageId: 'user-msg-1',
        operationId: 'op-client-1',
        toolCallId: 'call-create-doc-1',
        topicId: 'topic-1',
      },
    );

    expect(createDocument).toHaveBeenCalledWith({
      agentId: 'agent-1',
      content: 'notes',
      title: 'Research Notes',
      toolContext: {
        messageId: 'user-msg-1',
        operationId: 'op-client-1',
        toolCallId: 'call-create-doc-1',
        topicId: 'topic-1',
      },
      trigger: 'tool',
    });
  });

  it('does not forward tool trigger metadata without required attribution ids', async () => {
    const createDocument = vi.fn().mockResolvedValue({
      id: 'agent-doc-1',
      title: 'Draft',
    });
    const runtime = createRuntime({ createDocument });

    await runtime.createDocument(
      {
        content: 'draft',
        title: 'Draft',
      },
      { agentId: 'agent-1', messageId: 'user-msg-1' },
    );

    await runtime.createDocument(
      {
        content: 'draft',
        title: 'Draft',
      },
      { agentId: 'agent-1', toolCallId: 'call-create-doc-1' },
    );

    expect(createDocument).toHaveBeenNthCalledWith(1, {
      agentId: 'agent-1',
      content: 'draft',
      title: 'Draft',
    });
    expect(createDocument).toHaveBeenNthCalledWith(2, {
      agentId: 'agent-1',
      content: 'draft',
      title: 'Draft',
    });
  });

  it('truncates an oversized readDocument content but keeps full content in state', async () => {
    const hugeXml = 'x'.repeat(500_000);
    const hugeMarkdown = 'm'.repeat(500_000);
    const readDocument = vi.fn().mockResolvedValue({
      content: hugeMarkdown,
      id: 'agent-doc-1',
      litexml: hugeXml,
      title: 'Newsletter Archive',
    });
    const runtime = createRuntime({ readDocument });

    const result = await runtime.readDocument({ id: 'agent-doc-1' }, { agentId: 'agent-1' });

    // LLM-facing content is capped well below the raw 500k chars.
    expect(result.content.length).toBeLessThan(hugeXml.length);
    expect(result.content).toContain('document truncated to fit the context window');
    // Inspector still receives the untruncated document via state.
    expect(result.state).toMatchObject({ content: hugeMarkdown, xml: hugeXml });
  });

  it('maps MANAGED_RESOURCE_BY_PLATFORM from createDocument into a Chinese failure', async () => {
    const createDocument = vi.fn().mockRejectedValue(new Error('MANAGED_RESOURCE_BY_PLATFORM'));
    const runtime = createRuntime({ createDocument });

    const result = await runtime.createDocument(
      { content: '手册正文', title: '使用说明' },
      { agentId: 'agent-1' },
    );

    expect(result.success).toBe(false);
    expect(result.content).toBe(MANAGED_PLATFORM_DOCUMENT_TOOL_MESSAGE);
    expect(result.content).not.toContain('Created document');
  });

  it('includes the share URL on readDocument and tells the model not to show the internal id', async () => {
    const readDocument = vi.fn().mockResolvedValue({
      content: '# 办法',
      documentId: 'docs_9zWc6ISEUdWPjmDu',
      id: 'c1e400e5-85fb-48c7-bcf1-e95b17272602',
      litexml: '<doc>办法</doc>',
      title: '项目管理办法（初稿）',
    });
    const runtime = new AgentDocumentsExecutionRuntime(
      {
        copyDocument: vi.fn(),
        createDocument: vi.fn(),
        createTopicDocument: vi.fn(),
        listDocuments: vi.fn(),
        listTopicDocuments: vi.fn(),
        modifyNodes: vi.fn(),
        readDocument,
        removeDocument: vi.fn(),
        renameDocument: vi.fn(),
        replaceDocumentContent: vi.fn(),
        updateLoadRule: vi.fn(),
      },
      {
        getDocumentUrl: ({ agentId, documentId }) =>
          `https://chat.example.com/agent/${agentId}/docs/${documentId.replace(/^docs_/, '')}`,
      },
    );

    const result = await runtime.readDocument(
      { id: 'c1e400e5-85fb-48c7-bcf1-e95b17272602' },
      { agentId: 'agt_jOQo8asIIZcw' },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain(
      'https://chat.example.com/agent/agt_jOQo8asIIZcw/docs/9zWc6ISEUdWPjmDu',
    );
    expect(result.content).toContain('never show it to the user');
    expect(result.content).toContain('<doc>办法</doc>');
    expect(result.content).not.toContain('/docs/c1e400e5-85fb-48c7-bcf1-e95b17272602');
  });

  it('does not truncate a readDocument content under the cap', async () => {
    const readDocument = vi.fn().mockResolvedValue({
      content: 'short markdown',
      id: 'agent-doc-1',
      litexml: '<doc>short</doc>',
      title: 'Small Doc',
    });
    const runtime = createRuntime({ readDocument });

    const result = await runtime.readDocument({ id: 'agent-doc-1' }, { agentId: 'agent-1' });

    expect(result.content).toBe('<doc>short</doc>');
    expect(result.content).not.toContain('document truncated');
  });

  it('does not split a surrogate pair when the cutoff lands mid-emoji', async () => {
    // Place a 2-code-unit emoji so its high surrogate sits exactly at the
    // 200,000-char cutoff; a naive slice would emit a lone `\uD83D`, which some
    // providers reject and would re-break the large-document request.
    const content = `${'a'.repeat(199_999)}😀${'b'.repeat(2000)}`;
    const readDocument = vi.fn().mockResolvedValue({
      content: 'markdown',
      id: 'agent-doc-1',
      litexml: content,
      title: 'Emoji Archive',
    });
    const runtime = createRuntime({ readDocument });

    const result = await runtime.readDocument({ id: 'agent-doc-1' }, { agentId: 'agent-1' });

    // No lone high/low surrogate survives in the LLM-facing content.
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(result.content).not.toMatch(loneSurrogate);
    // Lone surrogates throw in structuredClone; a well-formed slice must not.
    expect(() => structuredClone(result.content)).not.toThrow();
    expect(result.content).toContain('document truncated to fit the context window');
  });
});
