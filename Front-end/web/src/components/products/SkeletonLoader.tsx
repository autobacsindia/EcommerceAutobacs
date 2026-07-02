'use client';

import { motion } from 'framer-motion';

interface SkeletonLoaderProps {
  type?: 'hero' | 'gallery' | 'card' | 'text' | 'bundle';
  count?: number;
}

export default function SkeletonLoader({ type = 'card', count = 1 }: SkeletonLoaderProps) {
  const renderSkeleton = () => {
    switch (type) {
      case 'hero':
        return (
          <div className="relative h-[80vh] min-h-[600px] bg-obsidian-deep animate-pulse">
            <div className="absolute inset-0 bg-linear-to-r from-obsidian to-obsidian-deep" />
          </div>
        );

      case 'gallery':
        return (
          <div className="grid grid-cols-12 gap-4 h-[600px]">
            <div className="col-span-2 space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="w-full aspect-square bg-obsidian-raised rounded-lg animate-pulse" />
              ))}
            </div>
            <div className="col-span-8 bg-obsidian-raised rounded-xl animate-pulse" />
            <div className="col-span-2 space-y-4">
              <div className="h-32 bg-obsidian-raised rounded-xl animate-pulse" />
              <div className="h-48 bg-obsidian-raised rounded-xl animate-pulse" />
            </div>
          </div>
        );

      case 'card':
        return (
          <div className="bg-obsidian-raised/50 border border-hairline rounded-xl p-6 animate-pulse">
            <div className="h-48 bg-obsidian-raised rounded-lg mb-4" />
            <div className="space-y-3">
              <div className="h-6 bg-obsidian-raised rounded w-3/4" />
              <div className="h-4 bg-obsidian-raised rounded w-1/2" />
              <div className="h-10 bg-obsidian-raised rounded w-full mt-4" />
            </div>
          </div>
        );

      case 'text':
        return (
          <div className="space-y-4">
            <div className="h-8 bg-obsidian-raised rounded w-1/3 animate-pulse" />
            <div className="h-4 bg-obsidian-raised rounded w-full animate-pulse" />
            <div className="h-4 bg-obsidian-raised rounded w-2/3 animate-pulse" />
          </div>
        );

      case 'bundle':
        return (
          <div className="bg-obsidian-raised/50 border border-hairline rounded-2xl p-6 animate-pulse">
            <div className="h-6 bg-obsidian-raised rounded w-1/3 mb-6" />
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-obsidian-raised rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-obsidian-raised rounded w-3/4" />
                    <div className="h-4 bg-obsidian-raised rounded w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      default:
        return <div className="bg-obsidian-raised rounded-xl h-48 animate-pulse" />;
    }
  };

  return (
    <>
      {[...Array(count)].map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: i * 0.1 }}
        >
          {renderSkeleton()}
        </motion.div>
      ))}
    </>
  );
}
