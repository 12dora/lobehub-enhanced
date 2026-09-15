import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { BRANDING_LOGO_URL } from '@lobechat/business-const';
import { DEFAULT_INBOX_AVATAR, DEFAULT_INBOX_TITLE, INBOX_SESSION_ID } from '@lobechat/const';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { resolveServerRuntimeBranding } from '../branding';
import { PlatformDefaultInboxService } from './defaultInbox';
import {
  isInboxIdentityAgent,
  overlayInboxIdentityOnAgentAvatars,
  resolveInboxRankIdentity,
} from './inboxIdentity';

vi.mock('../branding', () => ({
  resolveServerRuntimeBranding: vi.fn(),
}));

const PUBLISHED_BRANDING = {
  defaultAgentDisplayName: 'AI 助手',
  iconUrl: 'https://brand.example/icon.png',
  logoUrl: 'https://brand.example/logo.png',
};

const builtInInboxAvatarLiteral = (source: string) => {
  const match = source.match(
    /\[\s*'\/avatars\/lobe-ai\.png',\s*DEFAULT_INBOX_AVATAR,\s*BRANDING_LOGO_URL\s*\]/,
  );
  expect(match).toBeTruthy();
  return match![0].replaceAll(/\s+/g, '');
};

const builtInCatalogAvatars = [
  ...new Set(['/avatars/lobe-ai.png', DEFAULT_INBOX_AVATAR, BRANDING_LOGO_URL].filter(Boolean)),
];

describe('inbox identity overlay', () => {
  beforeEach(() => {
    vi.mocked(resolveServerRuntimeBranding).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveInboxRankIdentity', () => {
    it('keeps built-in inbox avatars in sync with useDefaultInboxAvatar', () => {
      const overlaySource = readFileSync(
        fileURLToPath(new URL('./inboxIdentity.ts', import.meta.url)),
        'utf8',
      );
      const hookSource = readFileSync(
        fileURLToPath(
          new URL('../../../../../../src/hooks/useDefaultInboxAvatar.ts', import.meta.url),
        ),
        'utf8',
      );

      expect(builtInInboxAvatarLiteral(overlaySource)).toBe(builtInInboxAvatarLiteral(hookSource));
    });

    it('prefers the published catalog identity', () => {
      expect(
        resolveInboxRankIdentity({
          branding: PUBLISHED_BRANDING,
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

    it.each(builtInCatalogAvatars)(
      'falls through built-in catalog avatar %s to branding, then DEFAULT_INBOX_AVATAR',
      (avatar) => {
        expect(
          resolveInboxRankIdentity({
            branding: PUBLISHED_BRANDING,
            catalog: {
              avatar,
              backgroundColor: '#123456',
              title: 'Published assistant',
            },
          }),
        ).toEqual({
          avatar: 'https://brand.example/icon.png',
          backgroundColor: '#123456',
          title: 'Published assistant',
        });

        expect(
          resolveInboxRankIdentity({
            branding: {
              defaultAgentDisplayName: 'AI 助手',
              iconUrl: '  ',
              logoUrl: 'https://brand.example/logo.png',
            },
            catalog: {
              avatar: `  ${avatar}  `,
              backgroundColor: null,
              title: 'Published assistant',
            },
          }),
        ).toEqual({
          avatar: 'https://brand.example/logo.png',
          backgroundColor: null,
          title: 'Published assistant',
        });

        expect(
          resolveInboxRankIdentity({
            branding: { defaultAgentDisplayName: 'AI 助手', iconUrl: null, logoUrl: null },
            catalog: { avatar, backgroundColor: null, title: 'Published assistant' },
          }),
        ).toEqual({
          avatar: DEFAULT_INBOX_AVATAR,
          backgroundColor: null,
          title: 'Published assistant',
        });
      },
    );

    it('falls through blank catalog fields to published branding, then DEFAULT_INBOX_*', () => {
      expect(
        resolveInboxRankIdentity({
          branding: PUBLISHED_BRANDING,
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

  describe('isInboxIdentityAgent', () => {
    it('matches slug, isInbox flag, or the inbox session id', () => {
      expect(isInboxIdentityAgent({ slug: INBOX_SESSION_ID })).toBe(true);
      expect(isInboxIdentityAgent({ isInbox: true, slug: 'other' })).toBe(true);
      expect(isInboxIdentityAgent({ id: INBOX_SESSION_ID })).toBe(true);
      expect(isInboxIdentityAgent({ id: 'agt_local', slug: 'researcher' })).toBe(false);
    });
  });

  describe('overlayInboxIdentityOnAgentAvatars', () => {
    const db = {} as LobeChatDatabase;

    it('skips catalog and branding reads when no inbox agent is present', async () => {
      const getPublishedIdentity = vi
        .spyOn(PlatformDefaultInboxService.prototype, 'getPublishedIdentity')
        .mockResolvedValue({
          avatar: '/f/pba_published',
          backgroundColor: '#123',
          title: 'Published assistant',
        });
      const rows = [
        {
          avatar: '🤖',
          backgroundColor: '#000',
          id: 'agt_local',
          isInbox: false,
          slug: 'researcher',
          title: 'Local assistant',
        },
      ];

      await expect(overlayInboxIdentityOnAgentAvatars(db, 'user-1', rows)).resolves.toBe(rows);
      expect(getPublishedIdentity).not.toHaveBeenCalled();
      expect(resolveServerRuntimeBranding).not.toHaveBeenCalled();
    });

    it('overlays catalog identity on inbox rows and leaves other agents unchanged', async () => {
      vi.spyOn(PlatformDefaultInboxService.prototype, 'getPublishedIdentity').mockResolvedValue({
        avatar: '/f/pba_published',
        backgroundColor: '#123456',
        title: 'Published assistant',
      });

      const local = {
        avatar: '🤖',
        backgroundColor: '#000',
        id: 'agt_local',
        isInbox: false,
        slug: 'researcher',
        title: 'Local assistant',
      };
      const inbox = {
        avatar: DEFAULT_INBOX_AVATAR,
        backgroundColor: null,
        id: 'agt_inbox',
        isInbox: true,
        slug: INBOX_SESSION_ID,
        title: DEFAULT_INBOX_TITLE,
      };

      const result = await overlayInboxIdentityOnAgentAvatars(db, 'user-1', [inbox, local]);

      expect(result[0]).toMatchObject({
        avatar: '/f/pba_published',
        backgroundColor: '#123456',
        id: 'agt_inbox',
        isInbox: true,
        slug: INBOX_SESSION_ID,
        title: 'Published assistant',
      });
      expect(result[1]).toEqual(local);
      expect(resolveServerRuntimeBranding).not.toHaveBeenCalled();
    });

    it('falls through built-in catalog avatar to branding', async () => {
      vi.spyOn(PlatformDefaultInboxService.prototype, 'getPublishedIdentity').mockResolvedValue({
        avatar: DEFAULT_INBOX_AVATAR,
        backgroundColor: '#123456',
        title: 'Published assistant',
      });
      vi.mocked(resolveServerRuntimeBranding).mockResolvedValue({
        ...PUBLISHED_BRANDING,
      } as Awaited<ReturnType<typeof resolveServerRuntimeBranding>>);

      const result = await overlayInboxIdentityOnAgentAvatars(db, 'user-1', [
        {
          avatar: DEFAULT_INBOX_AVATAR,
          backgroundColor: null,
          id: 'agt_inbox',
          slug: INBOX_SESSION_ID,
          title: DEFAULT_INBOX_TITLE,
        },
      ]);

      expect(result[0]).toMatchObject({
        avatar: 'https://brand.example/icon.png',
        backgroundColor: '#123456',
        title: 'Published assistant',
      });
      expect(resolveServerRuntimeBranding).toHaveBeenCalledWith();
    });
  });
});
