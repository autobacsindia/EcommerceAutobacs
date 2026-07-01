'use client';

import { TrackingEvent, OrderStatus } from '@/types/tracking';
import { TimelineEvent } from './TimelineEvent';
import { TimelineProgress } from './TimelineProgress';

interface TrackingTimelineProps {
  events: TrackingEvent[];
  currentStatus: OrderStatus;
  estimatedDelivery: string;
}

export function TrackingTimeline({ events, currentStatus, estimatedDelivery }: TrackingTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="text-center py-12">
        <svg className="mx-auto h-16 w-16 text-ink-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
        <h3 className="mt-4 text-lg font-medium text-ink">No tracking events yet</h3>
        <p className="mt-2 text-ink-muted">
          Tracking information will appear here once your package is processed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with current status */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-ink">Package Journey</h3>
          <p className="text-sm text-ink-muted mt-1">
            {events.length} {events.length === 1 ? 'update' : 'updates'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-ink-muted">Estimated Delivery</p>
          <p className="text-base font-semibold text-ink">
            {new Date(estimatedDelivery).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <TimelineProgress currentStatus={currentStatus} />

      {/* Timeline events */}
      <div className="relative">
        {events.map((event, index) => (
          <TimelineEvent
            key={`${event.timestamp}-${index}`}
            event={event}
            isFirst={index === 0}
            isLast={index === events.length - 1}
          />
        ))}
      </div>
    </div>
  );
}
