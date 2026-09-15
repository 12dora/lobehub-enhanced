'use client';

import { Flexbox } from '@lobehub/ui';
import { Select, Text } from '@lobehub/ui/base-ui';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { messengerKeys } from '@/libs/swr/keys';
import { messengerService } from '@/services/messenger';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import AgentSelect from './AgentSelect';
import {
  buildMessengerScopeOptions,
  messengerScopeSelectClassNames,
  PERSONAL_SCOPE,
  resolvePersonalScopeLabel,
} from './scopeOptions';

interface ScopedLinkLike {
  activeAgentId: string | null;
  /** Active scope of this link: a workspace id, or null for personal. */
  workspaceId: string | null;
}

interface AgentScopeSelectProps {
  /** Localized label for the agent column (e.g. 「默认助手」). */
  agentLabel: string;
  disabled?: boolean;
  link: ScopedLinkLike;
  /** Returns whether the update persisted, so the optimistic pick can roll back. */
  onSetActive: (agentId: string | null) => Promise<boolean>;
}

/**
 * "Scope + active agent" picker shared by messenger detail pages.
 *
 * The bot itself is a single shared bot; which LobeHub context a conversation
 * runs in is the *active agent's* scope, so the first selector only filters the
 * agent list below it. The active scope is persisted server-side when an agent
 * is chosen (the server derives the workspace from the agent).
 *
 * `IntegrationDetail/shared.tsx`'s `UserAgentConnection` still carries its own
 * copy of this block; it should adopt this component when that file gets its
 * `@lobehub/ui` → `@lobehub/ui/base-ui` migration.
 */
const AgentScopeSelect = memo<AgentScopeSelectProps>(
  ({ agentLabel, disabled, link, onSetActive }) => {
    const { t } = useTranslation('messenger');
    const enableWorkspaceScopes = useServerConfigStore(
      (s) =>
        serverConfigSelectors.enableBusinessFeatures(s) && s.featureFlags.enableWorkspace === true,
    );

    const scopesSWR = useSWR(enableWorkspaceScopes ? messengerKeys.bindingScopes() : null, () =>
      messengerService.listBindingScopes(),
    );
    const [scope, setScope] = useState<string>(
      enableWorkspaceScopes ? (link.workspaceId ?? PERSONAL_SCOPE) : PERSONAL_SCOPE,
    );
    const userAvatar = useUserStore(userProfileSelectors.userAvatar);
    const userDisplayName = useUserStore(userProfileSelectors.displayUserName);
    const userFullName = useUserStore(userProfileSelectors.fullName);

    // Mirror the Agent Transfer scope picker: each row is an avatar + name.
    // Personal uses the user's avatar; workspaces use their own avatar.
    const scopeOptions = useMemo(() => {
      const personalLabel = resolvePersonalScopeLabel({
        fallbackLabel: userDisplayName || t('messenger.scopePersonal'),
        fullName: userFullName,
      });

      return buildMessengerScopeOptions({
        personalAvatar: userAvatar,
        personalLabel,
        personalTagLabel: t('messenger.scopePersonalTag', { defaultValue: 'personal' }),
        workspaces: scopesSWR.data,
      });
    }, [scopesSWR.data, t, userAvatar, userDisplayName, userFullName]);

    const scopeWorkspaceId = scope === PERSONAL_SCOPE ? null : scope;
    const linkIsActiveScope = scopeWorkspaceId === (link.workspaceId ?? null);

    useEffect(() => {
      if (enableWorkspaceScopes || scope === PERSONAL_SCOPE) return;
      setScope(PERSONAL_SCOPE);
    }, [enableWorkspaceScopes, scope]);

    // Optimistic selection for the currently-selected scope. Persisting the
    // active agent does a server round-trip plus a links refetch, so without this
    // the dropdown only reflects the new pick once both finish. `pending` mirrors
    // the user's choice immediately and is cleared once the link data catches up
    // — which also lets a later refresh (e.g. `/助手` sent from the IM client)
    // win instead of being masked forever. Scoped by workspace so it only applies
    // while the scope it was made in is selected.
    const [pending, setPending] = useState<{
      agentId: string | null;
      workspaceId: string | null;
    } | null>(null);
    const pendingForScope = pending && pending.workspaceId === scopeWorkspaceId ? pending : null;

    useEffect(() => {
      if (!pending) return;
      if (
        (link.workspaceId ?? null) === pending.workspaceId &&
        (link.activeAgentId ?? null) === pending.agentId
      ) {
        setPending(null);
      }
    }, [link.workspaceId, link.activeAgentId, pending]);

    const activeAgentId = pendingForScope
      ? pendingForScope.agentId
      : linkIsActiveScope
        ? (link.activeAgentId ?? null)
        : null;

    return (
      <Flexbox horizontal align="flex-end" gap={12}>
        {enableWorkspaceScopes && (
          <Flexbox flex={1} gap={6}>
            <Text fontSize={12} type="secondary">
              {t('messenger.scope')}
            </Text>
            <Select
              classNames={messengerScopeSelectClassNames}
              disabled={disabled}
              options={scopeOptions}
              value={scope}
              onChange={(next) => setScope((next as string | null) ?? PERSONAL_SCOPE)}
            />
          </Flexbox>
        )}
        <Flexbox flex={1} gap={6}>
          <Text fontSize={12} type="secondary">
            {agentLabel}
          </Text>
          <AgentSelect
            // Default to the scope's inbox agent when the selected scope has no
            // agent yet (neither an optimistic pick nor a persisted one), rather
            // than leaving the dropdown empty.
            defaultToInbox={!disabled && !pendingForScope && !linkIsActiveScope}
            disabled={disabled}
            placeholder={t('messenger.activeAgentPlaceholder')}
            value={activeAgentId ?? undefined}
            workspaceId={scopeWorkspaceId}
            onChange={async (agentId) => {
              if (disabled) return;
              const next = (agentId ?? null) as string | null;
              // Reflect the pick immediately, then persist in the background.
              setPending({ agentId: next, workspaceId: scopeWorkspaceId });
              const ok = await onSetActive(next);
              // Roll back to the persisted value if the update failed.
              if (!ok) setPending(null);
            }}
          />
        </Flexbox>
      </Flexbox>
    );
  },
);

AgentScopeSelect.displayName = 'MessengerAgentScopeSelect';

export default AgentScopeSelect;
