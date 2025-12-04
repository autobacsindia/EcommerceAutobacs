'use client';

import { useState } from 'react';
import { TrackingEvent } from '@/types/tracking';
import { getEventIcon, getEventColor } from '@/utils/trackingHelpers';

interface TimelineEventProps {
  event: TrackingEvent;
  isFirst: boolean;
  isLast: boolean;
}

export function TimelineEvent({ event, isFirst, isLast }: TimelineEventProps) {
  const [expanded, setExpanded] = useState(false);
  const iconColor = getEventColor(event.status);
  const EventIcon = getEventIcon(event.status);

  const hasAdditionalInfo = event.scannedBy;

  return (
    <div className="relative flex pb-8 last:pb-0">
      {/* Timeline line */}
      {!isLast && (
        <div className="absolute left-4 top-8 bottom-0 w-0.5 bg-gray-200" />
      )}

      {/* Icon container */}
      <div className={`relative z-10 flex items-center justify-center w-8 h-8 rounded-full ${iconColor} flex-shrink-0`}>
        <EventIcon className="w-4 h-4 text-white" />
      </div>

      {/* Event content */}
      <div className="ml-4 flex-1">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h4 className="text-base font-semibold text-gray-900">
              {event.status.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
            </h4>
            
            {event.location && (
              <div className="flex items-center mt-1 text-sm text-gray-600">
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {event.location}
              </div>
            )}

            {event.description && (
              <p className="mt-1 text-sm text-gray-700">{event.description}</p>
            )}

            {hasAdditionalInfo && expanded && (
              <div className="mt-3 p-3 bg-gray-50 rounded-md">
                {event.scannedBy && (
                  <p className="text-xs text-gray-600">
                    <span className="font-medium">Scanned by:</span> {event.scannedBy}
                  </p>
                )}
              </div>
            )}

            {hasAdditionalInfo && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="mt-2 text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                {expanded ? 'Show less' : 'Show more details'}
              </button>
            )}
          </div>

          <div className="ml-4 flex-shrink-0 text-right">
            <p className="text-sm font-medium text-gray-900">
              {new Date(event.timestamp).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
              })}
            </p>
            <p className="text-xs text-gray-500">
              {new Date(event.timestamp).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
