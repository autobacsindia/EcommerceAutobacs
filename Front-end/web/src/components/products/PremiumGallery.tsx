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
  isDark?: boolean;
}

export default function PremiumGallery({ images, productName, isDark = true }: PremiumGalleryProps) {
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
      <div className="grid grid-cols-12 gap-4 h-150 lg:h-175">
        {/* Vertical Thumbnail Rail */}
        <div className="col-span-2 lg:col-span-1 flex flex-col gap-3 overflow-y-auto py-2 scrollbar-thin">
          {displayImages.map((image, index) => (
            <motion.button
              key={image.id}
              whileHover={{ scale: 1.05 }}
              onClick={() => setActiveIndex(index)}
              className={`relative w-full aspect-square rounded-lg overflow-hidden border-2 transition-all shrink-0 ${
                activeIndex === index
                  ? 'border-orange-500 shadow-lg shadow-orange-500/30'
                  : isDark ? 'border-hairline hover:border-hairline' : 'border-hairline hover:border-hairline'
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
        <div className={`col-span-10 lg:col-span-11 relative rounded-xl overflow-hidden group ${isDark ? 'bg-obsidian-deep' : 'bg-obsidian-raised'}`}>
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
                className={`absolute left-4 top-1/2 -translate-y-1/2 rounded-full p-3 opacity-0 group-hover:opacity-100 transition-opacity z-10 border ${isDark ? 'bg-obsidian-deep/80 hover:bg-obsidian-raised border-hairline' : 'bg-obsidian/90 hover:bg-obsidian border-hairline'}`}
              >
                <ChevronLeft className={`w-6 h-6 ${isDark ? 'text-ink' : 'text-ink/80'}`} />
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={goToNext}
                className={`absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-3 opacity-0 group-hover:opacity-100 transition-opacity z-10 border ${isDark ? 'bg-obsidian-deep/80 hover:bg-obsidian-raised border-hairline' : 'bg-obsidian/90 hover:bg-obsidian border-hairline'}`}
              >
                <ChevronRight className={`w-6 h-6 ${isDark ? 'text-ink' : 'text-ink/80'}`} />
              </motion.button>
            </>
          )}

          {/* Zoom Indicator */}
          <div className={`absolute top-4 right-4 rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity border ${isDark ? 'bg-obsidian-deep/80 border-hairline' : 'bg-obsidian/90 border-hairline'}`}>
            <ZoomIn className={`w-5 h-5 ${isDark ? 'text-ink/70' : 'text-ink-muted'}`} />
          </div>

          {/* Image Counter */}
          {displayImages.length > 1 && (
            <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-sm font-medium border ${isDark ? 'bg-obsidian-deep/90 border-hairline text-ink/70' : 'bg-obsidian/90 border-hairline text-ink/80'}`}>
              {activeIndex + 1} / {displayImages.length}
            </div>
          )}
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
