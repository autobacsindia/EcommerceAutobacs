import React from 'react';

interface SkeletonLoaderProps {
  type?: 'header' | 'search' | 'cart' | 'user' | 'mobile-menu';
  className?: string;
}

export default function SkeletonLoader({ 
  type = 'header', 
  className = '' 
}: SkeletonLoaderProps) {
  switch (type) {
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