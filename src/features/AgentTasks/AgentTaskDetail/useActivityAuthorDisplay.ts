import type { TaskDetailActivityAuthor } from '@lobechat/types';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

import { isInboxAgentId } from '../shared/isInboxAgent';
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';

/**
 * Belt-and-suspenders: inbox agent authors re-resolve through client branding
 * instead of trusting stale server `author.name` / `author.avatar`.
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
    avatar: inboxMeta?.avatar ?? author.avatar,
    name: inboxMeta?.title ?? author.name,
  };
};
