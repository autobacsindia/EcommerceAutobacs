'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from 'lucide-react';

interface ProductImage {
  id: string | number;
  src: string;
  alt: string;
}

interface ImageModalProps {
  images: ProductImage[];
  activeIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export default function ImageModal({ images, activeIndex, isOpen, onClose, onNavigate }: ImageModalProps) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onNavigate(activeIndex > 0 ? activeIndex - 1 : images.length - 1);
      if (e.key === 'ArrowRight') onNavigate(activeIndex < images.length - 1 ? activeIndex + 1 : 0);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, activeIndex, images.length, onClose, onNavigate]);

  const goToPrevious = () => {
    setZoom(1);
    onNavigate(activeIndex > 0 ? activeIndex - 1 : images.length - 1);
  };

  const goToNext = () => {
    setZoom(1);
    onNavigate(activeIndex < images.length - 1 ? activeIndex + 1 : 0);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] bg-obsidian-deep/95 backdrop-blur-sm"
        onClick={onClose}
      >
        {/* Close Button */}
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={onClose}
          className="absolute top-6 right-6 z-10 bg-obsidian/10 hover:bg-obsidian/20 border border-hairline/20 rounded-full p-3 transition-colors"
        >
          <X className="w-6 h-6 text-ink" />
        </motion.button>

        {/* Navigation Arrows */}
        {images.length > 1 && (
          <>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={(e) => { e.stopPropagation(); goToPrevious(); }}
              className="absolute left-6 top-1/2 -translate-y-1/2 z-10 bg-obsidian/10 hover:bg-obsidian/20 border border-hairline/20 rounded-full p-4 transition-colors"
            >
              <ChevronLeft className="w-8 h-8 text-ink" />
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={(e) => { e.stopPropagation(); goToNext(); }}
              className="absolute right-6 top-1/2 -translate-y-1/2 z-10 bg-obsidian/10 hover:bg-obsidian/20 border border-hairline/20 rounded-full p-4 transition-colors"
            >
              <ChevronRight className="w-8 h-8 text-ink" />
            </motion.button>
          </>
        )}

        {/* Zoom Controls */}
        <div className="absolute bottom-6 right-6 z-10 flex gap-2">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={(e) => { e.stopPropagation(); setZoom(Math.min(zoom + 0.5, 3)); }}
            className="bg-obsidian/10 hover:bg-obsidian/20 border border-hairline/20 rounded-full p-3 transition-colors"
          >
            <ZoomIn className="w-5 h-5 text-ink" />
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={(e) => { e.stopPropagation(); setZoom(Math.max(zoom - 0.5, 1)); }}
            className="bg-obsidian/10 hover:bg-obsidian/20 border border-hairline/20 rounded-full p-3 transition-colors"
          >
            <ZoomOut className="w-5 h-5 text-ink" />
          </motion.button>
        </div>

        {/* Image Counter */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 bg-obsidian/10 border border-hairline/20 text-ink px-6 py-3 rounded-full text-sm font-medium">
          {activeIndex + 1} / {images.length}
        </div>

        {/* Main Image */}
        <div className="h-full flex items-center justify-center p-12" onClick={(e) => e.stopPropagation()}>
          <motion.div
            key={activeIndex}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: zoom }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.3 }}
            className="relative w-full h-full max-w-6xl max-h-[80vh]"
          >
            <Image
              src={images[activeIndex]?.src || '/placeholder-product.jpg'}
              alt={images[activeIndex]?.alt || 'Product image'}
              fill
              className="object-contain"
              sizes="90vw"
              priority
            />
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
