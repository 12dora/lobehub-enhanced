import { DEFAULT_INBOX_AVATAR, DEFAULT_INBOX_TITLE, INBOX_SESSION_ID } from '@lobechat/const';
import type { AgentRankItem } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { PlatformDefaultInboxService } from '../../services/agentCatalog/defaultInbox';
import { resolveServerRuntimeBranding } from '../../services/branding';
import { applyInboxRankIdentity, overlayInboxAgentRank } from './stats.rankIdentity';

vi.mock('../../services/branding', () => ({
  resolveServerRuntimeBranding: vi.fn(),
}));

const rankRow = (overrides: Partial<AgentRankItem> = {}): AgentRankItem => ({
  avatar: '/avatars/agent-default.png',
  backgroundColor: null,
  count: 3,
  id: 'agt_local',
  title: 'Local assistant',
  ...overrides,
});

const inboxRow = (overrides: Partial<AgentRankItem> = {}): AgentRankItem =>
  rankRow({
    avatar: DEFAULT_INBOX_AVATAR,
    count: 8,
    id: INBOX_SESSION_ID,
    title: DEFAULT_INBOX_TITLE,
    ...overrides,
  });

const PUBLISHED_BRANDING = {
  defaultAgentDisplayName: 'AI 助手',
  iconUrl: 'https://brand.example/icon.png',
  logoUrl: 'https://brand.example/logo.png',
};

describe('admin.stats inbox rank identity', () => {
  beforeEach(() => {
    vi.mocked(resolveServerRuntimeBranding).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('applyInboxRankIdentity', () => {
    it('overlays only the merged inbox entry', () => {
      const local = rankRow();
      const rows = applyInboxRankIdentity([inboxRow(), local], {
        avatar: '/f/pba_published',
        backgroundColor: '#abc',
        title: 'Published assistant',
      });

      expect(rows[0]).toMatchObject({
        avatar: '/f/pba_published',
        backgroundColor: '#abc',
        count: 8,
        id: INBOX_SESSION_ID,
        title: 'Published assistant',
      });
      expect(rows[1]).toEqual(local);
    });
  });

  describe('overlayInboxAgentRank', () => {
    const db = {} as LobeChatDatabase;

    it('skips catalog and branding reads when the rank has no inbox entry', async () => {
      const getPublishedIdentity = vi
        .spyOn(PlatformDefaultInboxService.prototype, 'getPublishedIdentity')
        .mockResolvedValue({
          avatar: '/f/pba_published',
          backgroundColor: '#123',
          title: 'Published assistant',
        });
      const rows = [rankRow()];

      await expect(overlayInboxAgentRank(db, 'admin', rows)).resolves.toBe(rows);
      expect(getPublishedIdentity).not.toHaveBeenCalled();
      expect(resolveServerRuntimeBranding).not.toHaveBeenCalled();
    });

    it('overlays catalog identity without resolving branding when avatar and title are customised', async () => {
      vi.spyOn(PlatformDefaultInboxService.prototype, 'getPublishedIdentity').mockResolvedValue({
        avatar: '/f/pba_published',
        backgroundColor: '#123456',
        title: 'Published assistant',
      });

      const local = rankRow();
      const result = await overlayInboxAgentRank(db, 'admin', [inboxRow(), local]);

      expect(result[0]).toMatchObject({
        avatar: '/f/pba_published',
        backgroundColor: '#123456',
        id: INBOX_SESSION_ID,
        title: 'Published assistant',
      });
      expect(result[1]).toEqual(local);
      expect(resolveServerRuntimeBranding).not.toHaveBeenCalled();
    });

    it('resolves cached branding when the catalog avatar is built-in', async () => {
      vi.spyOn(PlatformDefaultInboxService.prototype, 'getPublishedIdentity').mockResolvedValue({
        avatar: DEFAULT_INBOX_AVATAR,
        backgroundColor: '#123456',
        title: 'Published assistant',
      });
      vi.mocked(resolveServerRuntimeBranding).mockResolvedValue({
        ...PUBLISHED_BRANDING,
      } as Awaited<ReturnType<typeof resolveServerRuntimeBranding>>);

      const result = await overlayInboxAgentRank(db, 'admin', [inboxRow()]);

      expect(result[0]).toMatchObject({
        avatar: 'https://brand.example/icon.png',
        backgroundColor: '#123456',
        id: INBOX_SESSION_ID,
        title: 'Published assistant',
      });
      expect(resolveServerRuntimeBranding).toHaveBeenCalledOnce();
      expect(resolveServerRuntimeBranding).toHaveBeenCalledWith();
    });

    it('resolves cached branding when the catalog title is blank', async () => {
      vi.spyOn(PlatformDefaultInboxService.prototype, 'getPublishedIdentity').mockResolvedValue({
        avatar: '/f/pba_published',
        backgroundColor: null,
        title: '  ',
      });
      vi.mocked(resolveServerRuntimeBranding).mockResolvedValue({
        ...PUBLISHED_BRANDING,
      } as Awaited<ReturnType<typeof resolveServerRuntimeBranding>>);

      const result = await overlayInboxAgentRank(db, 'admin', [inboxRow()]);

      expect(result[0]).toMatchObject({
        avatar: '/f/pba_published',
        id: INBOX_SESSION_ID,
        title: 'AI 助手',
      });
      expect(resolveServerRuntimeBranding).toHaveBeenCalledWith();
    });
  });
});
