'use client';

import { createModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import { isDesktop } from '@/const/version';
import { type AdminToolScope } from '@/features/AdminToolScope';
import { MarketAuthProvider } from '@/layout/AuthProvider/MarketAuth';

import { publishSkillStoreAdminScope, SkillStoreAdminScopeProvider } from './adminScope';
import { SkillStoreContent } from './SkillStoreContent';

export { publishSkillStoreAdminScope, useSkillStoreAdminScopeSync } from './adminScope';

/**
 * The modal mounts outside the page tree, so the admin org scope (if any) must
 * be re-provided explicitly for store installs to target the platform catalog.
 * The scope is read from the live bridge instead of being captured here, so the
 * cards stay in sync with the org catalog after a write.
 */
export const createSkillStoreModal = (adminScope?: AdminToolScope | null) => {
  // Seed the bridge for openers that do not call `useSkillStoreAdminScopeSync`
  // (every user surface passes nothing, i.e. the personal scope).
  publishSkillStoreAdminScope(adminScope ?? null);

  return createModal({
    content: (
      <SkillStoreAdminScopeProvider>
        <MarketAuthProvider isDesktop={isDesktop}>
          <SkillStoreContent />
        </MarketAuthProvider>
      </SkillStoreAdminScopeProvider>
    ),
    footer: null,
    title: t('skillStore.title', { ns: 'setting' }),
    width: 'min(80%, 800px)',
  });
};
