'use client';

import { OrderStatus } from '@/types/tracking';

interface TimelineProgressProps {
  currentStatus: OrderStatus;
}

const statusSteps = [
  { status: 'pending', label: 'Order Placed', value: 0, color: 'bg-red-500', ringColor: 'ring-red-200' },
  { status: 'confirmed', label: 'Confirmed', value: 20, color: 'bg-orange-500', ringColor: 'ring-orange-200' },
  { status: 'processing', label: 'Processing', value: 40, color: 'bg-yellow-500', ringColor: 'ring-yellow-200' },
  { status: 'shipped', label: 'Shipped', value: 60, color: 'bg-green-400', ringColor: 'ring-green-200' },
  { status: 'delivered', label: 'Delivered', value: 100, color: 'bg-green-600', ringColor: 'ring-green-300' }
];

export function TimelineProgress({ currentStatus }: TimelineProgressProps) {
  // Find current step
  const currentStep = statusSteps.find(step => step.status === currentStatus);
  const progress = currentStep?.value || 0;
  
  // Handle cancelled/refunded status
  const isCancelled = currentStatus === 'cancelled' || currentStatus === 'refunded' || currentStatus === 'failed';

  return (
    <div className="w-full">
      {/* Progress bar */}
      <div className="relative">
        <div className="overflow-hidden h-2 flex rounded-full bg-gray-200">
          <div
            style={{ 
              width: `${progress}%`,
              background: isCancelled ? undefined : 'linear-gradient(to right, #ef4444, #f97316, #eab308, #4ade80, #16a34a)'
            }}
            className={`transition-all duration-500 ease-out flex flex-col text-center whitespace-nowrap text-white justify-center ${
              isCancelled ? 'bg-red-500' : ''
            }`}
          />
        </div>
      </div>

      {/* Status indicators */}
      <div className="flex justify-between mt-3">
        {statusSteps.map((step, index) => {
          const isActive = step.value <= progress;
          const isCurrent = step.status === currentStatus;

          return (
            <div key={step.status} className="flex flex-col items-center" style={{ flex: 1 }}>
              <div
                className={`w-3 h-3 rounded-full transition-all duration-300 ${
                  isActive
                    ? isCancelled
                      ? 'bg-red-500 scale-110'
                      : `${step.color} scale-110`
                    : 'bg-gray-300'
                } ${isCurrent ? `ring-4 ${isCancelled ? 'ring-red-200' : step.ringColor}` : ''}`}
              />
              <span
                className={`mt-2 text-xs font-medium text-center ${
                  isActive ? 'text-gray-900' : 'text-gray-500'
                }`}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {isCancelled && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">
            This order has been {currentStatus}. Please contact support for more information.
          </p>
        </div>
      )}
    </div>
  );
}
