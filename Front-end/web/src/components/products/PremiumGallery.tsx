'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, X, ZoomIn } from 'lucide-react';
import ImageModal from './ImageModal';

interface ProductImage {
  id: string | number;
  src: string;
  alt: string;
  name?: string;
}

interface PremiumGalleryProps {
  images: ProductImage[];
  productName: string;
}

export default function PremiumGallery({ images, productName }: PremiumGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const touchStartX = useRef(0);

  const displayImages = images && images.length > 0 ? images : [
    { id: 'placeholder', src: '/placeholder-product.jpg', alt: productName }
  ];

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (diff > 0 && activeIndex < displayImages.length - 1) {
        setActiveIndex(activeIndex + 1);
      } else if (diff < 0 && activeIndex > 0) {
        setActiveIndex(activeIndex - 1);
      }
    }
  };

  const goToPrevious = () => {
    setActiveIndex((prev) => (prev > 0 ? prev - 1 : displayImages.length - 1));
  };

  const goToNext = () => {
    setActiveIndex((prev) => (prev < displayImages.length - 1 ? prev + 1 : 0));
  };

  return (
    <>
      <div className="grid grid-cols-12 gap-4 h-[600px] lg:h-[700px]">
        {/* Vertical Thumbnail Rail */}
        <div className="col-span-2 lg:col-span-1 flex flex-col gap-3 overflow-y-auto py-2 scrollbar-thin">
          {displayImages.map((image, index) => (
            <motion.button
              key={image.id}
              whileHover={{ scale: 1.05 }}
              onClick={() => setActiveIndex(index)}
              className={`relative w-full aspect-square rounded-lg overflow-hidden border-2 transition-all flex-shrink-0 ${
                activeIndex === index
                  ? 'border-orange-500 shadow-lg shadow-orange-500/30'
                  : 'border-zinc-700 hover:border-zinc-500'
              }`}
            >
              <Image
                src={image.src}
                alt={image.alt}
                fill
                className="object-cover"
                sizes="80px"
              />
            </motion.button>
          ))}
        </div>

        {/* Main Cinematic Image */}
        <div className="col-span-10 lg:col-span-8 relative bg-zinc-900 rounded-xl overflow-hidden group">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeIndex}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="relative w-full h-full"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              <Image
                src={displayImages[activeIndex]?.src || '/placeholder-product.jpg'}
                alt={displayImages[activeIndex]?.alt || productName}
                fill
                className="object-contain p-4 transition-transform duration-500 group-hover:scale-105 cursor-zoom-in"
                priority={activeIndex === 0}
                sizes="(max-width: 1024px) 100vw, 70vw"
                onClick={() => setIsModalOpen(true)}
              />
            </motion.div>
          </AnimatePresence>

          {/* Navigation Arrows */}
          {displayImages.length > 1 && (
            <>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={goToPrevious}
                className="absolute left-4 top-1/2 -translate-y-1/2 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700 rounded-full p-3 opacity-0 group-hover:opacity-100 transition-opacity z-10"
              >
                <ChevronLeft className="w-6 h-6 text-white" />
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={goToNext}
                className="absolute right-4 top-1/2 -translate-y-1/2 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700 rounded-full p-3 opacity-0 group-hover:opacity-100 transition-opacity z-10"
              >
                <ChevronRight className="w-6 h-6 text-white" />
              </motion.button>
            </>
          )}

          {/* Zoom Indicator */}
          <div className="absolute top-4 right-4 bg-zinc-900/80 border border-zinc-700 rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <ZoomIn className="w-5 h-5 text-zinc-300" />
          </div>

          {/* Image Counter */}
          {displayImages.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-zinc-900/90 border border-zinc-700 text-zinc-300 px-4 py-2 rounded-full text-sm font-medium">
              {activeIndex + 1} / {displayImages.length}
            </div>
          )}
        </div>

        {/* Image Info Panel */}
        <div className="hidden lg:flex col-span-3 flex-col gap-4">
          <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-4">
            <h3 className="text-white font-bold mb-3">Product Views</h3>
            <div className="space-y-2">
              <button className="w-full text-left p-3 bg-zinc-700/50 hover:bg-zinc-700 rounded-lg transition-colors text-zinc-300 text-sm">
                📸 Vehicle-Mounted
              </button>
              <button className="w-full text-left p-3 bg-zinc-700/50 hover:bg-zinc-700 rounded-lg transition-colors text-zinc-300 text-sm">
                🌙 Night Performance
              </button>
              <button className="w-full text-left p-3 bg-zinc-700/50 hover:bg-zinc-700 rounded-lg transition-colors text-zinc-300 text-sm">
                🔧 Installation
              </button>
              <button className="w-full text-left p-3 bg-zinc-700/50 hover:bg-zinc-700 rounded-lg transition-colors text-zinc-300 text-sm">
                🔍 Material Close-up
              </button>
            </div>
          </div>

          <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-4 flex-1">
            <h4 className="text-white font-semibold text-sm mb-2">Product Details</h4>
            <p className="text-zinc-400 text-xs leading-relaxed">
              Click on the main image to view in fullscreen. Use arrow keys or swipe to navigate between images.
            </p>
          </div>
        </div>
      </div>

      {/* Fullscreen Modal */}
      <ImageModal
        images={displayImages}
        activeIndex={activeIndex}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onNavigate={setActiveIndex}
      />
    </>
  );
}
