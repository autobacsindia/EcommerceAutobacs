import React from 'react';
import { Skeleton } from "@/components/ui/Skeleton";

interface SkeletonLoaderProps {
  type?: 'header' | 'search' | 'cart' | 'user' | 'mobile-menu' | 'cart-page';
  className?: string;
}

export default function SkeletonLoader({ 
  type = 'header', 
  className = '' 
}: SkeletonLoaderProps) {
  // Use suppressHydrationWarning for the root elements of loading skeletons
  // to handle minor attribute mismatches that are unavoidable in SSR
  switch (type) {
    case 'cart-page':
      return (
        <div 
          className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 ${className}`}
          suppressHydrationWarning
        >
          <div className="mb-8">
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="lg:grid lg:grid-cols-12 lg:gap-8">
            <div className="lg:col-span-8">
              <div className="bg-obsidian rounded-lg shadow-md overflow-hidden">
                <div className="p-4 border-b flex justify-between items-center">
                  <Skeleton className="h-6 w-24" />
                  <Skeleton className="h-4 w-20" />
                </div>
                <div className="divide-y">
                  {[1, 2, 3].map((item) => (
                    <div key={item} className="p-6">
                      <div className="flex gap-4">
                        <Skeleton className="flex-shrink-0 w-24 h-24 rounded-md" />
                        <div className="flex-1 space-y-3">
                          <div className="flex justify-between">
                            <div className="space-y-2">
                              <Skeleton className="h-5 w-48" />
                              <Skeleton className="h-4 w-24" />
                            </div>
                            <Skeleton className="h-5 w-5" />
                          </div>
                          <div className="flex justify-between items-center">
                            <Skeleton className="h-8 w-32" />
                            <Skeleton className="h-6 w-20" />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="lg:col-span-4 mt-8 lg:mt-0">
              <div className="bg-obsidian rounded-lg shadow-md p-6">
                <Skeleton className="h-6 w-32 mb-4" />
                <div className="space-y-3 mb-6">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex justify-between">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                  ))}
                </div>
                <Skeleton className="h-12 w-full rounded" />
              </div>
            </div>
          </div>
        </div>
      );

    case 'header':
      return (
        <header 
          className={`bg-obsidian-deep sticky top-0 z-50 shadow-md w-full ${className}`}
          suppressHydrationWarning
        >
          <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="flex items-center h-16 border-b border-hairline gap-4">
              {/* Logo skeleton */}
              <div className="flex-shrink-0">
                <Skeleton className="h-8 w-32" />
              </div>

              {/* Location skeleton - hidden on mobile */}
              <div className="hidden lg:block flex-shrink-0">
                <Skeleton className="h-6 w-32" />
              </div>

              {/* Search Bar skeleton - Desktop (Center) */}
              <div className="hidden md:block flex-1 max-w-4xl">
                 <Skeleton className="w-full h-10 rounded-md" />
              </div>

              {/* Right Section skeleton */}
              <div className="flex items-center space-x-4 text-ink flex-shrink-0 ml-auto">
                {/* Currency Switcher skeleton */}
                <div className="hidden sm:block">
                  <Skeleton className="h-8 w-20" />
                </div>

                {/* Cart skeleton */}
                <div className="relative p-2">
                  <Skeleton className="h-5 w-5 rounded-full" />
                </div>

                {/* User Menu skeleton */}
                <div className="flex items-center space-x-2">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-8 w-20" />
                </div>

                {/* Mobile Menu Button skeleton */}
                <div className="md:hidden p-2">
                  <Skeleton className="h-6 w-6" />
                </div>
              </div>
            </div>

            {/* Bottom Row - Navigation Menu skeleton */}
            <nav className="hidden md:flex items-center justify-between gap-2 w-full h-10">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((item) => (
                <Skeleton key={item} className="h-4 w-16" />
              ))}
            </nav>
            </div>
        </header>
      );
      
    case 'search':
      return (
        <div 
          className={`relative w-full max-w-md ${className}`}
          suppressHydrationWarning
        >
          <div className="flex">
            <Skeleton className="w-full h-10 rounded-l-md rounded-r-none" />
            <Skeleton className="w-12 h-10 rounded-l-none rounded-r-md" />
          </div>
        </div>
      );
      
    case 'cart':
      return (
        <div 
          className={`relative p-2 ${className}`}
          suppressHydrationWarning
        >
          <Skeleton className="h-5 w-5 rounded-full" />
        </div>
      );
      
    case 'user':
      return (
        <div 
          className={`flex items-center space-x-2 ${className}`}
          suppressHydrationWarning
        >
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-8 w-20" />
        </div>
      );
      
    case 'mobile-menu':
      return (
        <div 
          className={`md:hidden p-2 ${className}`}
          suppressHydrationWarning
        >
          <Skeleton className="h-6 w-6" />
        </div>
      );
      
    default:
      return (
        <div 
          className={className}
          suppressHydrationWarning
        >
          <Skeleton className="w-full h-full" />
        </div>
      );
  }
}