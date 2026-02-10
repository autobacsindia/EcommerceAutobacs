import React from 'react';
import { Skeleton } from "@/components/ui/Skeleton";

export default function OrderHistorySkeleton() {
  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-8">
        <Skeleton className="h-10 w-48 mb-2" />
        <Skeleton className="h-5 w-64" />
      </div>

      {/* Filters and Search */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>

          {/* Status Filter & Sort */}
          <div className="flex gap-2">
            <Skeleton className="h-10 w-32 rounded-lg" />
            <Skeleton className="h-10 w-32 rounded-lg" />
          </div>
        </div>
      </div>

      {/* Results Count */}
      <div className="mb-4">
        <Skeleton className="h-5 w-48" />
      </div>

      {/* Orders List */}
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white border rounded-lg p-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4 mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div>
                    <Skeleton className="h-6 w-40 mb-1" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                </div>
                <Skeleton className="h-4 w-48 mt-2" />
              </div>
              <Skeleton className="h-8 w-24 rounded-lg" />
            </div>

            <div className="border-t pt-4 mb-4">
              <Skeleton className="h-4 w-24 mb-3" />
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Skeleton className="h-4 w-64" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <div className="flex justify-between">
                  <Skeleton className="h-4 w-56" />
                  <Skeleton className="h-4 w-16" />
                </div>
              </div>
            </div>

            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 border-t pt-4">
              <div>
                <Skeleton className="h-4 w-24 mb-1" />
                <Skeleton className="h-8 w-32" />
              </div>
              <Skeleton className="h-12 w-40 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
