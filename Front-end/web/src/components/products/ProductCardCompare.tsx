'use client';

import { cn } from '@/lib/utils';

interface Props {
  productId: string;
  isCompared: boolean;
  onToggle: (id: string) => void;
}

export default function ProductCardCompare({ productId, isCompared, onToggle }: Props) {
  return (
    <div className="absolute top-2 left-2" onClick={(e) => e.stopPropagation()}>
      <label className="flex items-center bg-[#252525] rounded-full p-1 shadow-md cursor-pointer">
        <input
          type="checkbox"
          className="sr-only"
          checked={isCompared}
          onChange={() => onToggle(productId)}
        />
        <div className={cn(
          'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors',
          isCompared ? 'bg-[#3B9EE8] border-[#3B9EE8]' : 'border-[#555555]'
        )}>
          {isCompared && (
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <span className="ml-1 text-xs font-medium text-[#C4C4C4] pr-2">Compare</span>
      </label>
    </div>
  );
}
