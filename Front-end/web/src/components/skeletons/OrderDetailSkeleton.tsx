import React from 'react';
import { Skeleton } from "@/components/ui/Skeleton";

export default function OrderDetailSkeleton() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <Skeleton className="h-6 w-24 mb-2" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <Skeleton className="h-4 w-48 mt-2" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-10 w-32 rounded-lg" />
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-obsidian rounded-lg shadow-sm border p-6 mb-8">
        <Skeleton className="h-6 w-48 mb-6" />
        <div className="px-4">
          <Skeleton className="h-2 w-full rounded-full mb-8" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex flex-col items-center gap-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column - Items */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-obsidian rounded-lg shadow-sm border overflow-hidden">
            <div className="p-6 border-b">
              <Skeleton className="h-6 w-32" />
            </div>
            <div className="divide-y">
              {[1, 2].map((i) => (
                <div key={i} className="p-6">
                  <div className="flex gap-4">
                    <Skeleton className="w-24 h-24 rounded-md" />
                    <div className="flex-1">
                      <div className="flex justify-between mb-2">
                        <Skeleton className="h-6 w-48" />
                        <Skeleton className="h-6 w-20" />
                      </div>
                      <Skeleton className="h-4 w-32 mb-2" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column - Summary & Info */}
        <div className="space-y-6">
          {/* Order Summary */}
          <div className="bg-obsidian rounded-lg shadow-sm border p-6">
            <Skeleton className="h-6 w-32 mb-4" />
            <div className="space-y-3 border-b pb-4 mb-4">
              <div className="flex justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
              <div className="flex justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
              <div className="flex justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
            </div>
            <div className="flex justify-between pt-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-24" />
            </div>
          </div>

          {/* Shipping Info */}
          <div className="bg-obsidian rounded-lg shadow-sm border p-6">
            <Skeleton className="h-6 w-40 mb-4" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>

          {/* Payment Info */}
          <div className="bg-obsidian rounded-lg shadow-sm border p-6">
            <Skeleton className="h-6 w-40 mb-4" />
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-12 rounded" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
