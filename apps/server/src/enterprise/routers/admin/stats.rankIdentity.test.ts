import { DEFAULT_INBOX_AVATAR, DEFAULT_INBOX_TITLE, INBOX_SESSION_ID } from '@lobechat/const';
import type { AgentRankItem } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { PlatformDefaultInboxService } from '../../services/agentCatalog/defaultInbox';
import { resolveServerRuntimeBranding } from '../../services/branding';
import {
  applyInboxRankIdentity,
  overlayInboxAgentRank,
  resolveInboxRankIdentity,
} from './stats.rankIdentity';

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

describe('admin.stats inbox rank identity', () => {
  beforeEach(() => {
    vi.mocked(resolveServerRuntimeBranding).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveInboxRankIdentity', () => {
    it('prefers the published catalog identity', () => {
      expect(
        resolveInboxRankIdentity({
          branding: {
            defaultAgentDisplayName: 'AI 助手',
            iconUrl: 'https://brand.example/icon.png',
            logoUrl: 'https://brand.example/logo.png',
          },
          catalog: {
            avatar: '/f/pba_published',
            backgroundColor: '#123456',
            title: 'Published assistant',
          },
        }),
      ).toEqual({
        avatar: '/f/pba_published',
        backgroundColor: '#123456',
        title: 'Published assistant',
      });
    });

    it('falls through blank catalog fields to published branding, then DEFAULT_INBOX_*', () => {
      expect(
        resolveInboxRankIdentity({
          branding: {
            defaultAgentDisplayName: 'AI 助手',
            iconUrl: 'https://brand.example/icon.png',
            logoUrl: 'https://brand.example/logo.png',
          },
          catalog: { avatar: '  ', backgroundColor: null, title: '' },
        }),
      ).toEqual({
        avatar: 'https://brand.example/icon.png',
        backgroundColor: null,
        title: 'AI 助手',
      });

      expect(
        resolveInboxRankIdentity({
          branding: {
            defaultAgentDisplayName: '  ',
            iconUrl: null,
            logoUrl: 'https://brand.example/logo.png',
          },
          catalog: null,
        }),
      ).toEqual({
        avatar: 'https://brand.example/logo.png',
        backgroundColor: null,
        title: DEFAULT_INBOX_TITLE,
      });

      expect(
        resolveInboxRankIdentity({
          branding: { defaultAgentDisplayName: null, iconUrl: null, logoUrl: null },
          catalog: null,
        }),
      ).toEqual({
        avatar: DEFAULT_INBOX_AVATAR,
        backgroundColor: null,
        title: DEFAULT_INBOX_TITLE,
      });
    });
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

    it('overlays catalog identity onto the merged inbox entry', async () => {
      vi.spyOn(PlatformDefaultInboxService.prototype, 'getPublishedIdentity').mockResolvedValue({
        avatar: '/f/pba_published',
        backgroundColor: '#123456',
        title: 'Published assistant',
      });
      vi.mocked(resolveServerRuntimeBranding).mockResolvedValue({
        defaultAgentDisplayName: 'AI 助手',
        iconUrl: 'https://brand.example/icon.png',
        logoUrl: 'https://brand.example/logo.png',
      } as Awaited<ReturnType<typeof resolveServerRuntimeBranding>>);

      const local = rankRow();
      const result = await overlayInboxAgentRank(db, 'admin', [inboxRow(), local]);

      expect(result[0]).toMatchObject({
        avatar: '/f/pba_published',
        backgroundColor: '#123456',
        id: INBOX_SESSION_ID,
        title: 'Published assistant',
      });
      expect(result[1]).toEqual(local);
      expect(resolveServerRuntimeBranding).toHaveBeenCalledWith({
        getDatabase: expect.any(Function),
      });
    });
  });
});
