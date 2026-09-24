import { getBuiltinIntervention } from '@lobechat/builtin-tools/interventions';
import { safeParseJSON } from '@lobechat/utils';
import { Flexbox } from '@lobehub/ui';
import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useUserStore } from '@/store/user';
import { toolInterventionSelectors } from '@/store/user/selectors';

import { dataSelectors, useConversationStore } from '../../../../../store';
import Arguments from '../Arguments';
import ApprovalActions from './ApprovalActions';
import {
  type BeforeApproveCheckOptions,
  markInterventionMounted,
  registerBeforeApproveCheck,
} from './beforeApproveRegistry';
import {
  isCustomInteractionIdentifier,
  isHeteroInteractionIdentifier,
  prepareCustomInteractionSubmit,
  recordCustomInteractionResolution,
} from './customInteractionHandlers';
import Fallback from './Fallback';
import KeyValueEditor from './KeyValueEditor';
import SecurityBlacklistWarning from './SecurityBlacklistWarning';

export type { ApprovalMode } from '@/store/user/slices/settings/selectors';

interface InterventionProps {
  actionsPortalTarget?: HTMLDivElement | null;
  apiName: string;
  assistantGroupId?: string;
  id: string;
  identifier: string;
  requestArgs: string;
  toolCallId: string;
}

const Intervention = memo<InterventionProps>(
  ({ requestArgs, id, identifier, apiName, toolCallId, assistantGroupId, actionsPortalTarget }) => {
    const approvalMode = useUserStore(toolInterventionSelectors.approvalMode);
    const [isEditing, setIsEditing] = useState(false);
    const updatePluginArguments = useConversationStore((s) => s.updatePluginArguments);

    // Store beforeApprove callbacks from intervention components (support multiple registrations)
    // Use Map with id as key for reliable cleanup
    const beforeApproveCallbacksRef = useRef<Map<string, () => void | Promise<void>>>(new Map());

    // Register a callback to be called before approval. Also mirrored into the
    // shared registry (keyed by tool message id) so "approve all" runs the same
    // check for this call; the card's own approve keeps using the local map.
    const registerBeforeApprove = useCallback(
      (
        callbackId: string,
        callback: () => void | Promise<void>,
        options?: BeforeApproveCheckOptions,
      ) => {
        beforeApproveCallbacksRef.current.set(callbackId, callback);
        const unregisterShared = registerBeforeApproveCheck(id, callbackId, callback, options);
        // Return cleanup function to unregister
        return () => {
          beforeApproveCallbacksRef.current.delete(callbackId);
          unregisterShared();
        };
      },
      [id],
    );

    // Handler to be called before approve action - calls all registered callbacks
    const handleBeforeApprove = useCallback(async () => {
      const callbacks = Array.from(beforeApproveCallbacksRef.current.values());
      await Promise.all(callbacks.map((cb) => cb()));
    }, []);

    const handleCancel = useCallback(() => {
      setIsEditing(false);
    }, []);

    const handleFinish = useCallback(
      async (editedObject: Record<string, any>) => {
        if (!toolCallId) return;

        try {
          const newArgsString = JSON.stringify(editedObject, null, 2);

          if (newArgsString !== requestArgs) {
            await updatePluginArguments(toolCallId, editedObject, true);
          }
          setIsEditing(false);
        } catch (error) {
          console.error('Error stringifying arguments:', error);
        }
      },
      [requestArgs, toolCallId, updatePluginArguments],
    );

    // Callback for builtin intervention components to update arguments
    const handleArgsChange = useCallback(
      async (newArgs: unknown) => {
        if (!toolCallId) return;
        await updatePluginArguments(toolCallId, newArgs, true);
      },
      [toolCallId, updatePluginArguments],
    );

    const parsedArgs = useMemo(() => safeParseJSON(requestArgs || '') ?? {}, [requestArgs]);

    const isCustomInteraction = isCustomInteractionIdentifier(identifier, apiName);

    const BuiltinToolInterventionRender = getBuiltinIntervention(identifier, apiName);

    // An approve / reject body is on screen (not the args editor, not a custom
    // interaction). Runs after the card's own effects, so the checks it registers
    // on mount are already in the shared registry.
    const isApprovable = BuiltinToolInterventionRender ? !isEditing && !isCustomInteraction : true;
    useEffect(() => (isApprovable ? markInterventionMounted(id) : undefined), [id, isApprovable]);

    const topicId = useConversationStore((s) => dataSelectors.getDbMessageById(id)(s)?.topicId);
    const submitToolInteraction = useConversationStore((s) => s.submitToolInteraction);
    const skipToolInteraction = useConversationStore((s) => s.skipToolInteraction);
    const cancelToolInteraction = useConversationStore((s) => s.cancelToolInteraction);
    // Hetero (CC / Codex) interventions ship the answer back through IPC to a
    // running CLI subprocess instead of starting a fresh `executeClientAgent`
    // turn. Route through the conversation store so it carries this card's own
    // `context` (agent/topic) to the chat store — otherwise the optimistic
    // writes and topic-status flip fall back to the global `activeTopicId` and
    // land on whichever topic the user is currently viewing.
    const submitHeteroIntervention = useConversationStore((s) => s.submitHeteroIntervention);

    const handleInteractionAction = useCallback(
      async (
        action:
          | { type: 'submit'; payload: Record<string, unknown> }
          | { type: 'skip'; payload?: Record<string, unknown>; reason?: string }
          | { type: 'cancel'; payload?: Record<string, unknown> },
      ) => {
        if (isHeteroInteractionIdentifier(identifier)) {
          await submitHeteroIntervention(id, action.type, action.payload);
          return;
        }
        switch (action.type) {
          case 'submit': {
            const { payload, options } = await prepareCustomInteractionSubmit(
              identifier,
              action.payload,
              {
                apiName,
                requestArgs: parsedArgs,
                topicId,
              },
            );
            await submitToolInteraction(id, payload, options);
            break;
          }
          case 'skip': {
            await recordCustomInteractionResolution(
              identifier,
              'skipped',
              action.payload,
              {
                apiName,
                requestArgs: parsedArgs,
                topicId,
              },
              action.reason,
            );
            await skipToolInteraction(id, action.reason);
            break;
          }
          case 'cancel': {
            await recordCustomInteractionResolution(identifier, 'cancelled', action.payload, {
              apiName,
              requestArgs: parsedArgs,
              topicId,
            });
            await cancelToolInteraction(id);
            break;
          }
        }
      },
      [
        apiName,
        cancelToolInteraction,
        id,
        identifier,
        parsedArgs,
        skipToolInteraction,
        submitHeteroIntervention,
        submitToolInteraction,
        topicId,
      ],
    );

    if (BuiltinToolInterventionRender) {
      if (isEditing)
        return (
          <Suspense fallback={<Arguments arguments={requestArgs} />}>
            <KeyValueEditor
              initialValue={parsedArgs}
              onCancel={handleCancel}
              onFinish={handleFinish}
            />
          </Suspense>
        );

      if (isCustomInteraction) {
        return (
          <Flexbox gap={12}>
            <BuiltinToolInterventionRender
              actionsPortalTarget={actionsPortalTarget}
              apiName={apiName}
              args={parsedArgs}
              identifier={identifier}
              interactionMode="custom"
              messageId={id}
              registerBeforeApprove={registerBeforeApprove}
              onArgsChange={handleArgsChange}
              onInteractionAction={handleInteractionAction}
            />
          </Flexbox>
        );
      }

      const actions = (
        <Flexbox horizontal justify={'flex-end'}>
          <ApprovalActions
            apiName={apiName}
            approvalMode={approvalMode}
            assistantGroupId={assistantGroupId}
            identifier={identifier}
            messageId={id}
            toolCallId={toolCallId}
            onBeforeApprove={handleBeforeApprove}
          />
        </Flexbox>
      );

      return (
        <Flexbox data-pending-hotkey-scope gap={12}>
          <SecurityBlacklistWarning args={parsedArgs} />
          <BuiltinToolInterventionRender
            apiName={apiName}
            args={parsedArgs}
            identifier={identifier}
            messageId={id}
            registerBeforeApprove={registerBeforeApprove}
            onArgsChange={handleArgsChange}
          />
          {actionsPortalTarget ? createPortal(actions, actionsPortalTarget) : actions}
        </Flexbox>
      );
    }

    return (
      <Flexbox gap={12}>
        <SecurityBlacklistWarning args={parsedArgs} />
        <Fallback
          actionsPortalTarget={actionsPortalTarget}
          apiName={apiName}
          assistantGroupId={assistantGroupId}
          id={id}
          identifier={identifier}
          requestArgs={requestArgs}
          toolCallId={toolCallId}
        />
      </Flexbox>
    );
  },
);

export default Intervention;
