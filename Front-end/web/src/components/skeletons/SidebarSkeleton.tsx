import React from 'react';
import { Skeleton } from "@/components/ui/Skeleton";

export default function SidebarSkeleton() {
  return (
    <div className="w-full bg-obsidian rounded-lg shadow-sm border p-4 space-y-6">
      {/* Title */}
      <Skeleton className="h-6 w-32 mb-4" />

      {/* Filter Groups */}
      {[1, 2, 3, 4].map((group) => (
        <div key={group} className="space-y-3">
          <Skeleton className="h-5 w-24 mb-2" />
          <div className="space-y-2">
            {[1, 2, 3].map((item) => (
              <div key={item} className="flex items-center space-x-2">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
