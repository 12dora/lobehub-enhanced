'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { CalendarDays } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { CalendarEventView, GetEventState } from '../../types';
import ErrorNotice from '../components/ErrorNotice';
import { ResultCard, ResultField } from '../components/ResultCard';
import { formatDateTime, formatTimeRange } from './rows';

const MAX_DESCRIPTION_LENGTH = 160;

/**
 * `getEvent` state as the runtime may deliver it: nested under `event`, or — for a
 * payload that was spread onto the state — flat on the state itself.
 */
type EventDetailState = GetEventState & Partial<CalendarEventView>;

/** Reads the event from either shape; a state with neither is not an event. */
const readEvent = (state?: EventDetailState): CalendarEventView | undefined => {
  if (state?.event) return state.event;
  if (state?.summary || state?.eventId || state?.start) return state;

  return undefined;
};

/** `getEvent` result: the event with its time, place and attendee count. */
const EventDetail = memo<BuiltinRenderProps<Record<string, unknown>, EventDetailState>>(
  ({ pluginError, pluginState }) => {
    const { t } = useTranslation('plugin');

    if (pluginError) return <ErrorNotice error={pluginError} />;

    const event = readEvent(pluginState);
    if (!event) return null;

    const time = event.isAllDay
      ? [
          formatDateTime(event.start)?.split(' ')[0],
          t('builtins.lobe-dingtalk-workspace.ui.render.allDay'),
        ]
          .filter(Boolean)
          .join(' · ')
      : formatTimeRange(event.start, event.end);
    const description = event.description?.trim();

    return (
      <ResultCard
        icon={CalendarDays}
        title={event.summary?.trim() || t('builtins.lobe-dingtalk-workspace.ui.apiLabel.getEvent')}
      >
        <Flexbox gap={6}>
          {time && (
            <ResultField label={t('builtins.lobe-dingtalk-workspace.ui.render.field.time')}>
              {time}
            </ResultField>
          )}
          {event.location && (
            <ResultField label={t('builtins.lobe-dingtalk-workspace.ui.render.field.location')}>
              {event.location}
            </ResultField>
          )}
          {event.attendees && event.attendees.length > 0 && (
            <ResultField label={t('builtins.lobe-dingtalk-workspace.ui.render.field.attendees')}>
              {t('builtins.lobe-dingtalk-workspace.ui.render.attendeeCount', {
                count: event.attendees.length,
              })}
            </ResultField>
          )}
          {description && (
            <ResultField label={t('builtins.lobe-dingtalk-workspace.ui.render.field.description')}>
              {description.length > MAX_DESCRIPTION_LENGTH
                ? `${description.slice(0, MAX_DESCRIPTION_LENGTH)}…`
                : description}
            </ResultField>
          )}
        </Flexbox>
      </ResultCard>
    );
  },
);

EventDetail.displayName = 'DingtalkWorkspaceEventDetail';

export default EventDetail;
