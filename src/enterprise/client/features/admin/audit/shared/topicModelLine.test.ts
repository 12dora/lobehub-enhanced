import { describe, expect, it } from 'vitest';

import { formatTopicModelLine, resolveAgentDisplayName } from './topicModelLine';

const providerLabel = (id: string | null | undefined) => (id ? `P:${id}` : '');

describe('resolveAgentDisplayName', () => {
  it('prefers the agent title', () => {
    expect(
      resolveAgentDisplayName(
        { agentId: 'agt_1', agentSlug: 'inbox', agentTitle: 'Helper' },
        'Inbox',
      ),
    ).toBe('Helper');
  });

  it('uses the localized default-assistant name for the inbox agent', () => {
    expect(
      resolveAgentDisplayName(
        { agentId: 'agt_1', agentSlug: 'inbox', agentTitle: '  ' },
        '默认助手',
      ),
    ).toBe('默认助手');
  });

  it('falls back to the raw id, then nothing', () => {
    expect(resolveAgentDisplayName({ agentId: 'agt_1', agentSlug: 'custom' }, 'Inbox')).toBe(
      'agt_1',
    );
    expect(resolveAgentDisplayName({ agentId: null }, 'Inbox')).toBeUndefined();
  });
});

describe('formatTopicModelLine', () => {
  it('joins provider, model and agent display name', () => {
    expect(
      formatTopicModelLine(
        providerLabel,
        { agentId: 'agt_1', agentTitle: 'Helper', model: 'custom-model', provider: 'acme' },
        'Inbox',
      ),
    ).toBe('P:acme · custom-model · Helper');
  });

  it('shows the inbox label instead of the inbox agent id', () => {
    expect(
      formatTopicModelLine(providerLabel, { agentId: 'agt_x', agentSlug: 'inbox' }, 'Default'),
    ).toBe('Default');
  });

  it('keeps an em dash when nothing is attributed', () => {
    expect(formatTopicModelLine(providerLabel, {}, 'Inbox')).toBe('—');
  });
});
