import { type SidebarAgentItem } from '@/database/repositories/home';

export interface InboxAssigneeIdentity {
  avatar: string;
  id?: string | null;
  title: string;
}

/**
 * The assignee picker builds its rows from the *home sidebar* list
 * (`getSidebarAgentList`), which keeps the builtin inbox meta — typically
 * `/avatars/lobe-ai.png` — instead of the platform-published identity that the
 * rest of the app renders (`useDefaultInboxAvatar` / `useDefaultInboxDisplayName`).
 *
 * Overlay the effective identity on the inbox row so the popover matches the
 * closed chip, and inject the row when the sidebar list does not carry it at all.
 */
export const applyInboxAssigneeIdentity = (
  agents: SidebarAgentItem[],
  { avatar, id, title }: InboxAssigneeIdentity,
): SidebarAgentItem[] => {
  if (!id) return agents;

  const hasInbox = agents.some((agent) => agent.id === id);

  if (!hasInbox) {
    return [
      {
        avatar,
        description: null,
        id,
        pinned: false,
        title,
        type: 'agent' as const,
        updatedAt: new Date(),
      },
      ...agents,
    ];
  }

  return agents.map((agent) => (agent.id === id ? { ...agent, avatar, title } : agent));
};
