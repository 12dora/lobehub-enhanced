import { ChatInput } from '@lobehub/editor/react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { type PendingIntervention } from '../store/slices/data/pendingInterventions';
import InterventionBatchHeader from './InterventionBatchHeader';
import InterventionContent from './InterventionContent';
import InterventionTabBar from './InterventionTabBar';
import { styles } from './style';
import { useInterventionBatch } from './useInterventionBatch';

interface InterventionBarProps {
  interventions: PendingIntervention[];
}

const InterventionBar = memo<InterventionBarProps>(({ interventions }) => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [actionsPortalTarget, setActionsPortalTarget] = useState<HTMLDivElement | null>(null);

  // Derive the active index from the stored toolCallId.
  // Falls back to the first intervention when the previously active one is resolved.
  const activeIndex = useMemo(() => {
    if (activeId) {
      const idx = interventions.findIndex((i) => i.toolCallId === activeId);
      if (idx >= 0) return idx;
    }
    return 0;
  }, [interventions, activeId]);

  const handleTabChange = useCallback(
    (index: number) => {
      setActiveId(interventions[index]?.toolCallId ?? null);
    },
    [interventions],
  );

  const batch = useInterventionBatch(interventions, activeIndex);
  const { activeToolMessageId } = batch;

  // While approving all, keep the call being approved on screen.
  useEffect(() => {
    if (!activeToolMessageId) return;
    const target = interventions.find((i) => i.toolMessageId === activeToolMessageId);
    if (target) setActiveId(target.toolCallId);
  }, [activeToolMessageId, interventions]);

  const activeIntervention = interventions[activeIndex];
  if (!activeIntervention) return null;

  return (
    <ChatInput
      data-pending-hotkey-scope
      className={styles.container}
      footer={<div className={styles.actions} ref={setActionsPortalTarget} />}
      maxHeight={'50vh' as any}
      resize={false}
    >
      {(batch.items.length > 1 || !!batch.progress) && (
        <InterventionBatchHeader
          count={batch.items.length}
          progress={batch.progress}
          onApproveAll={batch.approveAll}
          onRejectAll={batch.rejectAll}
          onStop={batch.stopApproveAll}
        />
      )}
      {interventions.length > 1 && (
        <InterventionTabBar
          activeIndex={activeIndex}
          interventions={interventions}
          onTabChange={handleTabChange}
        />
      )}
      <InterventionContent
        actionsPortalTarget={actionsPortalTarget}
        intervention={activeIntervention}
        key={activeIntervention.toolCallId}
      />
    </ChatInput>
  );
});

export default InterventionBar;
