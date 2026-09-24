'use client';

import { useMemo } from 'react';

import { useModuleEnabled } from '@/enterprise/client/hooks/useModuleEnabled';

import type { DingTalkConnectorGroups } from './draft';

/**
 * Which groups of the 钉钉 card this deployment has installed (contract §2.2).
 *
 * The states are the tree-resolved ones, so a child whose parent or dependency is off already
 * reads as off here — 工作台能力 disappears with 通知应用 without the card re-deriving it. A group
 * whose module is off is not rendered at all; its stored settings are sent back unchanged on save.
 */
export type DingTalkConnectorModules = DingTalkConnectorGroups;

export const useDingTalkConnectorModules = (): DingTalkConnectorModules => {
  const approval = useModuleEnabled('dingtalkApproval');
  const chat = useModuleEnabled('dingtalkChat');
  const docs = useModuleEnabled('dingtalkDocs');
  const notify = useModuleEnabled('dingtalkNotify');
  const personal = useModuleEnabled('dingtalkPersonal');
  const workspace = useModuleEnabled('dingtalkWorkspace');

  return useMemo(
    () => ({ approval, chat, docs, notify, personal, workspace }),
    [approval, chat, docs, notify, personal, workspace],
  );
};
