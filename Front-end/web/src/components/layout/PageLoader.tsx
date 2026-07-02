import React from 'react';
import SkeletonLoader from './SkeletonLoader';

interface PageLoaderProps {
  type?: 'home' | 'product' | 'category' | 'cart' | 'profile';
}

export default function PageLoader({ type = 'home' }: PageLoaderProps) {
  switch (type) {
    case 'home':
      return (
        <div className="flex min-h-screen flex-col">
          {/* Hero Section Skeleton */}
          <section className="bg-linear-to-r from-gold to-gold text-ink py-20">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
              <div className="h-16 bg-gold rounded mb-6 animate-pulse mx-auto max-w-3xl" />
              <div className="h-8 bg-gold rounded mb-8 mx-auto max-w-2xl" />
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <div className="h-12 w-32 bg-obsidian rounded-lg animate-pulse" />
                <div className="h-12 w-48 bg-transparent border-2 border-hairline rounded-lg animate-pulse" />
              </div>
            </div>
          </section>

          {/* Features Section Skeleton */}
          <section className="py-16 bg-obsidian-deep">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                {[1, 2, 3, 4].map((item) => (
                  <div key={item} className="text-center">
                    <div className="bg-gold/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse" />
                    <div className="h-6 bg-obsidian-raised rounded mb-2 mx-auto max-w-xs" />
                    <div className="h-4 bg-obsidian-raised rounded mx-auto max-w-xs" />
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Popular Categories Skeleton */}
          <section className="py-16">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="h-10 bg-obsidian-raised rounded mb-12 mx-auto max-w-md animate-pulse" />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="group">
                    <div className="bg-obsidian rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-shadow">
                      <div className="h-48 bg-obsidian-raised animate-pulse" />
                      <div className="p-6">
                        <div className="h-6 bg-obsidian-raised rounded mb-2" />
                        <div className="h-4 bg-obsidian-raised rounded" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* CTA Section Skeleton */}
          <section className="bg-gold text-obsidian py-16">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
              <div className="h-10 bg-gold rounded mb-4 mx-auto max-w-xl animate-pulse" />
              <div className="h-8 bg-gold rounded mb-8 mx-auto max-w-2xl animate-pulse" />
              <div className="h-12 w-48 bg-obsidian rounded-lg animate-pulse mx-auto" />
            </div>
          </section>
        </div>
      );

    default:
      return (
        <div className="flex justify-center items-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-gold"></div>
        </div>
      );
  }
}