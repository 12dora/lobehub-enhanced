import { describe, expect, it } from 'vitest';

import { type SidebarAgentItem } from '@/database/repositories/home';

import { applyInboxAssigneeIdentity } from './inboxAssigneeIdentity';

const agent = (id: string, overrides: Partial<SidebarAgentItem> = {}): SidebarAgentItem =>
  ({
    avatar: `${id}-avatar`,
    description: null,
    id,
    pinned: false,
    title: `${id}-title`,
    type: 'agent',
    updatedAt: new Date(0),
    ...overrides,
  }) as SidebarAgentItem;

const identity = { avatar: '/platform/inbox.png', id: 'inbox-1', title: '企业助手' };

describe('applyInboxAssigneeIdentity', () => {
  it('overlays the published identity when the sidebar already carries the inbox row', () => {
    const list = [
      agent('a-1'),
      agent('inbox-1', { avatar: '/avatars/lobe-ai.png', title: 'AI 助手' }),
    ];

    const result = applyInboxAssigneeIdentity(list, identity);

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      avatar: '/platform/inbox.png',
      id: 'inbox-1',
      title: '企业助手',
    });
    // Non-inbox rows are untouched.
    expect(result[0]).toBe(list[0]);
  });

  it('injects the inbox row at the top when it is missing', () => {
    const list = [agent('a-1')];

    const result = applyInboxAssigneeIdentity(list, identity);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      avatar: '/platform/inbox.png',
      id: 'inbox-1',
      title: '企业助手',
    });
    expect(result[1]).toBe(list[0]);
  });

  it('returns the list unchanged when there is no inbox agent id', () => {
    const list = [agent('a-1')];

    expect(applyInboxAssigneeIdentity(list, { ...identity, id: undefined })).toBe(list);
    expect(applyInboxAssigneeIdentity(list, { ...identity, id: null })).toBe(list);
  });
});
