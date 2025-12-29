'use client';

import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X, ZoomIn } from 'lucide-react';
import EnhancedImage from '@/components/layout/EnhancedImage';

interface Image {
  id: number;
  src: string;
  alt: string;
  name?: string;
}

interface ImageGalleryProps {
  images: Image[];
  className?: string;
}

export default function ImageGallery({ images, className = '' }: ImageGalleryProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [mainImageLoaded, setMainImageLoaded] = useState(false);

  // Reset to first image when images change
  useEffect(() => {
    setCurrentIndex(0);
    setMainImageLoaded(false);
  }, [images]);

  const goToPrevious = () => {
    const isFirstImage = currentIndex === 0;
    const newIndex = isFirstImage ? images.length - 1 : currentIndex - 1;
    setCurrentIndex(newIndex);
  };

  const goToNext = () => {
    const isLastImage = currentIndex === images.length - 1;
    const newIndex = isLastImage ? 0 : currentIndex + 1;
    setCurrentIndex(newIndex);
  };

  const goToImage = (index: number) => {
    setCurrentIndex(index);
  };

  const handleMainImageLoad = () => {
    setMainImageLoaded(true);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLightboxOpen) {
        if (e.key === 'Escape') {
          setIsLightboxOpen(false);
        } else if (e.key === 'ArrowLeft') {
          goToPrevious();
        } else if (e.key === 'ArrowRight') {
          goToNext();
        }
      } else if (e.key === 'Escape') {
        setIsLightboxOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLightboxOpen, currentIndex, images.length]);

  if (!images || images.length === 0) {
    return (
      <div className={`bg-gray-100 rounded-lg aspect-square flex items-center justify-center ${className}`}>
        <span className="text-gray-400">No images available</span>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-lg ${className}`}>
      {/* Main Image Display */}
      <div className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden group">
        <EnhancedImage
          src={images[currentIndex]?.src}
          alt={images[currentIndex]?.alt || images[currentIndex]?.name || 'Product image'}
          width={600}
          height={600}
          className="object-cover w-full h-full"
          context="product"
          onLoad={handleMainImageLoad}
        />
        
        {/* Loading indicator */}
        {!mainImageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        )}

        {/* Navigation arrows for desktop */}
        {images.length > 1 && (
          <>
            <button
              onClick={goToPrevious}
              className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white rounded-full p-2 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Previous image"
            >
              <ChevronLeft className="h-5 w-5 text-gray-800" />
            </button>
            <button
              onClick={goToNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white rounded-full p-2 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Next image"
            >
              <ChevronRight className="h-5 w-5 text-gray-800" />
            </button>
          </>
        )}

        {/* Zoom button */}
        <button
          onClick={() => setIsLightboxOpen(true)}
          className="absolute bottom-4 right-4 bg-white/80 hover:bg-white rounded-full p-2 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="View full size image"
        >
          <ZoomIn className="h-5 w-5 text-gray-800" />
        </button>

        {/* Image counter */}
        {images.length > 1 && (
          <div className="absolute top-4 left-4 bg-black/50 text-white text-sm px-2 py-1 rounded">
            {currentIndex + 1} of {images.length}
          </div>
        )}
      </div>

      {/* Thumbnail Strip */}
      {images.length > 1 && (
        <div className="mt-4 flex overflow-x-auto gap-2 pb-2 hide-scrollbar">
          {images.map((image, index) => (
            <button
              key={image.id || index}
              onClick={() => goToImage(index)}
              className={`flex-shrink-0 w-20 h-20 rounded-md overflow-hidden border-2 transition-all ${
                index === currentIndex ? 'border-blue-500' : 'border-transparent hover:border-gray-300'
              }`}
              aria-label={`View image ${index + 1}`}
            >
              <EnhancedImage
                src={image.src}
                alt={image.alt || image.name || `Thumbnail ${index + 1}`}
                width={80}
                height={80}
                className="object-cover w-full h-full"
                context="product"
              />
            </button>
          ))}
        </div>
      )}

      {/* Lightbox Modal */}
      {isLightboxOpen && (
        <div 
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setIsLightboxOpen(false)}
        >
          <div 
            className="relative max-w-6xl max-h-full w-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setIsLightboxOpen(false)}
              className="absolute top-4 right-4 z-10 bg-white/20 hover:bg-white/30 rounded-full p-2 backdrop-blur-sm"
              aria-label="Close lightbox"
            >
              <X className="h-6 w-6 text-white" />
            </button>

            {/* Navigation for lightbox */}
            {images.length > 1 && (
              <>
                <button
                  onClick={goToPrevious}
                  className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/30 rounded-full p-3 backdrop-blur-sm"
                  aria-label="Previous image"
                >
                  <ChevronLeft className="h-6 w-6 text-white" />
                </button>
                <button
                  onClick={goToNext}
                  className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/30 rounded-full p-3 backdrop-blur-sm"
                  aria-label="Next image"
                >
                  <ChevronRight className="h-6 w-6 text-white" />
                </button>
              </>
            )}

            {/* Lightbox image */}
            <div className="flex justify-center items-center h-full max-h-[90vh]">
              <EnhancedImage
                src={images[currentIndex]?.src}
                alt={images[currentIndex]?.alt || images[currentIndex]?.name || 'Full size product image'}
                width={800}
                height={800}
                className="max-h-[80vh] object-contain"
                context="product"
              />
            </div>

            {/* Lightbox counter */}
            {images.length > 1 && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/50 text-white text-sm px-3 py-1 rounded">
                {currentIndex + 1} of {images.length}
              </div>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}