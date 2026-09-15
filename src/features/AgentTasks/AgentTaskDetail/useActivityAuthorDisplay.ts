import type { TaskDetailActivityAuthor } from '@lobechat/types';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

import { isInboxAgentId } from '../shared/isInboxAgent';
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';

/**
 * The server already resolves inbox agent authors to the admin-configured identity
 * (catalog → branding → default), so `author.name` / `author.avatar` always win.
 * Client branding only fills the gaps for legacy rows that carry no author identity.
 */
export const useActivityAuthorDisplay = (
  author?: TaskDetailActivityAuthor,
): TaskDetailActivityAuthor | undefined => {
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const isInboxAuthor =
    author?.type === 'agent' &&
    !!author.id &&
    (author.isInbox === true || isInboxAgentId(author.id, inboxAgentId));
  const inboxMeta = useAgentDisplayMeta(isInboxAuthor ? author?.id : undefined);

  if (!author) return undefined;
  if (!isInboxAuthor) return author;

  return {
    ...author,
    avatar: author.avatar?.trim() ? author.avatar : inboxMeta?.avatar,
    name: author.name?.trim() ? author.name : inboxMeta?.title,
  };
};
