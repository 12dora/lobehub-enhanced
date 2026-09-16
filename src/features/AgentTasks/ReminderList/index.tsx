'use client';

import { Flexbox } from '@lobehub/ui';
import { Checkbox, Segmented } from '@lobehub/ui/base-ui';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import WideScreenContainer from '@/features/WideScreenContainer';

import CreatedReminderTable from './CreatedReminderTable';
import ReceivedReminderTable from './ReceivedReminderTable';

/** Which reminder table the tab shows. */
export type ReminderScope = 'created' | 'received';

/**
 * 定时提醒 surface of the tasks page: two tables — the reminder tasks the user
 * created (我发起的) and the deliveries addressed to the user (我收到的).
 * Creating/editing a reminder happens in chat or on the task detail page, so
 * this surface only lists, opens and stops reminders.
 */
const ReminderList = memo(() => {
  const { t } = useTranslation('chat');
  const [scope, setScope] = useState<ReminderScope>('created');
  const [includeFinished, setIncludeFinished] = useState(false);

  const options = useMemo(
    () => [
      { label: t('reminderList.section.created'), value: 'created' as const },
      { label: t('reminderList.section.received'), value: 'received' as const },
    ],
    [t],
  );

  return (
    <WideScreenContainer gap={12} paddingBlock={16} wrapperStyle={{ flex: 1, overflowY: 'auto' }}>
      <Flexbox horizontal align={'center'} gap={12} justify={'space-between'} wrap={'wrap'}>
        <Segmented
          options={options}
          size={'small'}
          value={scope}
          onChange={(value) => setScope(value as ReminderScope)}
        />
        {scope === 'created' && (
          <Checkbox checked={includeFinished} onChange={setIncludeFinished}>
            {t('reminderList.showFinished')}
          </Checkbox>
        )}
      </Flexbox>
      {scope === 'created' ? (
        <CreatedReminderTable includeFinished={includeFinished} />
      ) : (
        <ReceivedReminderTable />
      )}
    </WideScreenContainer>
  );
});

ReminderList.displayName = 'ReminderList';

export default ReminderList;
