import { cx } from 'antd-style';
import { memo } from 'react';

import { type PendingIntervention } from '../store/slices/data/pendingInterventions';
import { useInterventionLabel } from './interventionLabel';
import { styles } from './style';

interface InterventionTabProps {
  active: boolean;
  item: PendingIntervention;
  onSelect: () => void;
}

const InterventionTab = memo<InterventionTabProps>(({ active, item, onSelect }) => {
  const label = useInterventionLabel(item.identifier, item.apiName);

  return (
    <div className={cx(styles.tab, active && styles.tabActive)} title={label} onClick={onSelect}>
      🔧 {label}
    </div>
  );
});

InterventionTab.displayName = 'InterventionTab';

interface InterventionTabBarProps {
  activeIndex: number;
  interventions: PendingIntervention[];
  onTabChange: (index: number) => void;
}

const InterventionTabBar = memo<InterventionTabBarProps>(
  ({ interventions, activeIndex, onTabChange }) => {
    return (
      <div className={styles.tabBar}>
        {interventions.map((item, index) => (
          <InterventionTab
            active={index === activeIndex}
            item={item}
            key={item.toolCallId}
            onSelect={() => onTabChange(index)}
          />
        ))}
        <div className={styles.tabCounter}>
          {activeIndex + 1} / {interventions.length}
        </div>
      </div>
    );
  },
);

export default InterventionTabBar;
