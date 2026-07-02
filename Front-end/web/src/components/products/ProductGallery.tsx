'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, ZoomIn } from 'lucide-react';

interface ProductImage {
  id: string | number;
  src: string;
  alt: string;
  name?: string;
}

interface ProductGalleryProps {
  images: ProductImage[];
  productName: string;
}

export default function ProductGallery({ images, productName }: ProductGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isZoomed, setIsZoomed] = useState(false);
  const [zoomPosition, setZoomPosition] = useState({ x: 0, y: 0 });
  const galleryRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);

  // Ensure we have images to display
  const displayImages = images && images.length > 0 ? images : [
    { id: 'placeholder', src: '/placeholder-product.jpg', alt: productName }
  ];

  // Handle touch swipe for mobile
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

  // Handle mouse move for zoom effect (desktop)
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isZoomed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setZoomPosition({ x, y });
  };

  // Navigate images
  const goToPrevious = () => {
    setActiveIndex((prev) => (prev > 0 ? prev - 1 : displayImages.length - 1));
  };

  const goToNext = () => {
    setActiveIndex((prev) => (prev < displayImages.length - 1 ? prev + 1 : 0));
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goToPrevious();
      if (e.key === 'ArrowRight') goToNext();
      if (e.key === 'Escape') setIsZoomed(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [displayImages.length]);

  return (
    <div className="space-y-4" ref={galleryRef}>
      {/* Main Image */}
      <div 
        className="relative aspect-square bg-obsidian-deep rounded-2xl overflow-hidden group cursor-zoom-in"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onMouseMove={handleMouseMove}
        onClick={() => setIsZoomed(!isZoomed)}
      >
        <Image
          src={displayImages[activeIndex]?.src || '/placeholder-product.jpg'}
          alt={displayImages[activeIndex]?.alt || productName}
          fill
          className={`object-contain p-4 transition-transform duration-300 ${
            isZoomed ? 'scale-150' : 'scale-100 hover:scale-105'
          }`}
          style={isZoomed ? {
            transformOrigin: `${zoomPosition.x}% ${zoomPosition.y}%`
          } : undefined}
          priority
          sizes="(max-width: 768px) 100vw, 60vw"
        />

        {/* Navigation Arrows */}
        {displayImages.length > 1 && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); goToPrevious(); }}
              className="absolute left-3 top-1/2 -translate-y-1/2 bg-obsidian/90 hover:bg-obsidian rounded-full p-2 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Previous image"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); goToNext(); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-obsidian/90 hover:bg-obsidian rounded-full p-2 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Next image"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}

        {/* Zoom Indicator */}
        <div className="absolute top-3 right-3 bg-obsidian/90 rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <ZoomIn className="w-4 h-4 text-ink/80" />
        </div>

        {/* Image Counter */}
        {displayImages.length > 1 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-obsidian-deep/70 text-ink px-3 py-1 rounded-full text-sm">
            {activeIndex + 1} / {displayImages.length}
          </div>
        )}
      </div>

      {/* Thumbnail Gallery */}
      {displayImages.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
          {displayImages.map((image, index) => (
            <button
              key={image.id}
              onClick={() => setActiveIndex(index)}
              className={`relative w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all ${
                activeIndex === index
                  ? 'border-gold ring-2 ring-gold'
                  : 'border-hairline hover:border-hairline'
              }`}
              aria-label={`View image ${index + 1}`}
            >
              <Image
                src={image.src}
                alt={image.alt}
                fill
                className="object-cover"
                sizes="80px"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
