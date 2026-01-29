import React from 'react';

interface SkeletonLoaderProps {
  type?: 'header' | 'search' | 'cart' | 'user' | 'mobile-menu' | 'cart-page';
  className?: string;
}

export default function SkeletonLoader({ 
  type = 'header', 
  className = '' 
}: SkeletonLoaderProps) {
  switch (type) {
    case 'cart-page':
      return (
        <div className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 ${className}`}>
          <div className="mb-8">
            <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-2" />
            <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
          </div>
          <div className="lg:grid lg:grid-cols-12 lg:gap-8">
            <div className="lg:col-span-8">
              <div className="bg-white rounded-lg shadow-md overflow-hidden">
                <div className="p-4 border-b flex justify-between items-center">
                  <div className="h-6 w-24 bg-gray-200 rounded animate-pulse" />
                  <div className="h-4 w-20 bg-gray-200 rounded animate-pulse" />
                </div>
                <div className="divide-y">
                  {[1, 2, 3].map((item) => (
                    <div key={item} className="p-6">
                      <div className="flex gap-4">
                        <div className="flex-shrink-0 w-24 h-24 bg-gray-200 rounded-md animate-pulse" />
                        <div className="flex-1 space-y-3">
                          <div className="flex justify-between">
                            <div className="space-y-2">
                              <div className="h-5 w-48 bg-gray-200 rounded animate-pulse" />
                              <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
                            </div>
                            <div className="h-5 w-5 bg-gray-200 rounded animate-pulse" />
                          </div>
                          <div className="flex justify-between items-center">
                            <div className="h-8 w-32 bg-gray-200 rounded animate-pulse" />
                            <div className="h-6 w-20 bg-gray-200 rounded animate-pulse" />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="lg:col-span-4 mt-8 lg:mt-0">
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="h-6 w-32 bg-gray-200 rounded animate-pulse mb-4" />
                <div className="space-y-3 mb-6">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex justify-between">
                      <div className="h-4 w-20 bg-gray-200 rounded animate-pulse" />
                      <div className="h-4 w-16 bg-gray-200 rounded animate-pulse" />
                    </div>
                  ))}
                </div>
                <div className="h-12 w-full bg-gray-200 rounded animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      );

    case 'header':
      return (
        <header className={`bg-white border-b border-gray-200 sticky top-0 z-50 ${className}`}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              {/* Logo skeleton */}
              <div className="flex-shrink-0">
                <div className="h-8 w-32 bg-gray-200 rounded animate-pulse" />
              </div>

              {/* Desktop Navigation skeleton */}
              <nav className="hidden md:flex space-x-8">
                {[1, 2, 3, 4].map((item) => (
                  <div key={item} className="h-4 w-16 bg-gray-200 rounded animate-pulse" />
                ))}
              </nav>

              {/* Right Section skeleton */}
              <div className="flex items-center space-x-4">
                {/* Desktop Search skeleton */}
                <div className="hidden md:block w-64">
                  <div className="flex">
                    <div className="w-full px-4 py-2 border border-gray-300 rounded-l-md bg-gray-100 animate-pulse" />
                    <div className="bg-blue-600 text-white px-4 py-2 rounded-r-md animate-pulse" />
                  </div>
                </div>

                {/* Cart skeleton */}
                <div className="relative p-2">
                  <div className="h-5 w-5 bg-gray-200 rounded-full animate-pulse" />
                </div>

                {/* User Menu skeleton */}
                <div className="flex items-center space-x-2">
                  <div className="h-5 w-16 bg-gray-200 rounded animate-pulse" />
                  <div className="h-8 w-20 bg-gray-200 rounded animate-pulse" />
                </div>

                {/* Mobile Menu Button skeleton */}
                <div className="md:hidden p-2">
                  <div className="h-6 w-6 bg-gray-200 rounded animate-pulse" />
                </div>
              </div>
            </div>
          </div>
        </header>
      );
      
    case 'search':
      return (
        <div className={`relative w-full max-w-md ${className}`}>
          <div className="flex">
            <div className="w-full px-4 py-2 border border-gray-300 rounded-l-md bg-gray-100 animate-pulse" />
            <div className="bg-blue-600 text-white px-4 py-2 rounded-r-md hover:bg-blue-700 transition-colors animate-pulse" />
          </div>
        </div>
      );
      
    case 'cart':
      return (
        <div className={`relative p-2 ${className}`}>
          <div className="h-5 w-5 bg-gray-200 rounded-full animate-pulse" />
        </div>
      );
      
    case 'user':
      return (
        <div className={`flex items-center space-x-2 ${className}`}>
          <div className="h-5 w-16 bg-gray-200 rounded animate-pulse" />
          <div className="h-8 w-20 bg-gray-200 rounded animate-pulse" />
        </div>
      );
      
    case 'mobile-menu':
      return (
        <div className={`md:hidden p-2 ${className}`}>
          <div className="h-6 w-6 bg-gray-200 rounded animate-pulse" />
        </div>
      );
      
    default:
      return (
        <div className={className}>
          <div className="bg-gray-200 rounded animate-pulse" />
        </div>
      );
  }
}