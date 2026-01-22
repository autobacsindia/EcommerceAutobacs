'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
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
  
  // Zoom and Pan state
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const imageRef = useRef<HTMLDivElement>(null);

  // Hover Zoom state for main image
  const [isHovering, setIsHovering] = useState(false);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });

  // Reset to first image when images change
  useEffect(() => {
    setCurrentIndex(0);
    setMainImageLoaded(false);
  }, [images]);

  // Reset zoom state when lightbox opens or image changes
  useEffect(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, [isLightboxOpen, currentIndex]);

  // Lock body scroll when lightbox is open
  useEffect(() => {
    if (isLightboxOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isLightboxOpen]);

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

  // Zoom handlers
  const handleZoomIn = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setScale(s => Math.min(s + 0.5, 4));
  };

  const handleZoomOut = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setScale(s => {
      const newScale = Math.max(s - 0.5, 1);
      if (newScale === 1) setPosition({ x: 0, y: 0 });
      return newScale;
    });
  };

  const handleResetZoom = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  // Main Image Hover Zoom Handlers
  const handleMainMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (window.innerWidth < 768) return; // Disable on mobile
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - left) / width) * 100;
    const y = ((e.clientY - top) / height) * 100;
    setHoverPos({ x, y });
    setIsHovering(true);
  };

  const handleMainMouseLeave = () => {
    setIsHovering(false);
  };

  // Pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale > 1) {
      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && scale > 1) {
      e.preventDefault();
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (isLightboxOpen) {
      // Prevent default scroll behavior if zooming
      if (e.ctrlKey || scale > 1) {
        // e.preventDefault(); // React synthetic events can't always prevent default wheel
      }
      
      // Zoom logic
      if (e.deltaY < 0) {
        // Zoom in
        setScale(s => Math.min(s + 0.25, 4));
      } else {
        // Zoom out
        setScale(s => {
          const newScale = Math.max(s - 0.25, 1);
          if (newScale === 1) setPosition({ x: 0, y: 0 });
          return newScale;
        });
      }
    }
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
        } else if (e.key === '+' || e.key === '=') {
          setScale(s => Math.min(s + 0.5, 4));
        } else if (e.key === '-' || e.key === '_') {
          setScale(s => {
            const newScale = Math.max(s - 0.5, 1);
            if (newScale === 1) setPosition({ x: 0, y: 0 });
            return newScale;
          });
        } else if (e.key === '0') {
          setScale(1);
          setPosition({ x: 0, y: 0 });
        }
      } else if (e.key === 'Escape') {
        setIsLightboxOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLightboxOpen, currentIndex, images.length]);

  // Use React Portal for lightbox to avoid z-index/stacking context issues
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!images || images.length === 0) {
    return (
      <div className={`bg-gray-100 rounded-lg aspect-square flex items-center justify-center ${className}`}>
        <span className="text-gray-400">No images available</span>
      </div>
    );
  }

  // Lightbox Component using Portal
  const Lightbox = () => {
    if (!isLightboxOpen) return null;
    
    // We can't use createPortal on server side, so check for window/document
    if (typeof window === 'undefined' || !mounted) return null;

    const { createPortal } = require('react-dom');
    
    return createPortal(
      <div 
        className="fixed inset-0 bg-black/90 z-[9999] flex items-center justify-center p-4 overflow-hidden"
        onClick={() => setIsLightboxOpen(false)}
      >
        {/* Global Close Button - Fixed to viewport */}
        <button
          onClick={() => setIsLightboxOpen(false)}
          className="fixed top-4 right-4 z-[10000] p-2 bg-white text-black rounded-full shadow-lg hover:bg-gray-200 transition-all"
          aria-label="Close full screen"
        >
          <X className="h-6 w-6" />
        </button>

        <div 
          className="relative w-full h-full max-w-7xl flex flex-col pointer-events-auto"
          // Removed stopPropagation here to allow clicking outside image to close
        >
          {/* Toolbar */}
          <div 
            className="flex justify-between items-center mb-4 z-20 pr-16"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 text-white">
              <span className="text-sm font-medium">{currentIndex + 1} / {images.length}</span>
            </div>
            
            <div className="flex items-center gap-2 bg-black/50 rounded-lg p-1 backdrop-blur-sm">
              <button
                onClick={handleZoomOut}
                disabled={scale <= 1}
                className={`p-2 rounded-md hover:bg-white/20 text-white transition-colors ${scale <= 1 ? 'opacity-50 cursor-not-allowed' : ''}`}
                title="Zoom Out (-)"
              >
                <ZoomOut className="h-5 w-5" />
              </button>
              <span className="min-w-[3ch] text-center text-white text-sm select-none">{Math.round(scale * 100)}%</span>
              <button
                onClick={handleZoomIn}
                disabled={scale >= 4}
                className={`p-2 rounded-md hover:bg-white/20 text-white transition-colors ${scale >= 4 ? 'opacity-50 cursor-not-allowed' : ''}`}
                title="Zoom In (+)"
              >
                <ZoomIn className="h-5 w-5" />
              </button>
              <div className="w-px h-5 bg-white/20 mx-1"></div>
              <button
                onClick={handleResetZoom}
                className="p-2 rounded-md hover:bg-white/20 text-white transition-colors"
                title="Reset Zoom (0)"
              >
                <RotateCcw className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Navigation for lightbox (outside image area to avoid conflict with drag) */}
          {images.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); goToPrevious(); }}
                className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 lg:-translate-x-12 p-3 text-white/70 hover:text-white transition-colors z-20 hidden md:block"
                aria-label="Previous image"
              >
                <ChevronLeft className="h-10 w-10" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); goToNext(); }}
                className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 lg:translate-x-12 p-3 text-white/70 hover:text-white transition-colors z-20 hidden md:block"
                aria-label="Next image"
              >
                <ChevronRight className="h-10 w-10" />
              </button>
            </>
          )}

          {/* Lightbox image container */}
          <div 
            className="flex-1 relative flex items-center justify-center overflow-hidden cursor-default select-none rounded-lg bg-black/20"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
            style={{ cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
          >
            <div 
              ref={imageRef}
              onClick={(e) => e.stopPropagation()}
              style={{ 
                transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`, 
                transition: isDragging ? 'none' : 'transform 0.2s ease-out',
                transformOrigin: 'center center',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                height: '100%'
              }}
            >
              <EnhancedImage
                src={images[currentIndex]?.src}
                alt={images[currentIndex]?.alt || images[currentIndex]?.name || 'Full size product image'}
                width={1200}
                height={1200}
                className="max-h-[85vh] w-auto max-w-full object-contain pointer-events-none" 
                context="product"
              />
            </div>
          </div>
          
          <div className="text-center text-white/70 text-sm mt-2 h-6 select-none">
            {scale > 1 ? 'Drag to pan' : 'Click zoom controls or use +/- keys to zoom'}
          </div>
        </div>
      </div>,
      document.body
    );
  };

  return (
    <div className={`bg-white rounded-lg ${className}`}>
      {/* Main Image Display */}
      <div 
        className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden group cursor-zoom-in"
        onMouseMove={handleMainMouseMove}
        onMouseLeave={handleMainMouseLeave}
        onClick={() => setIsLightboxOpen(true)}
      >
        <div 
          className="w-full h-full transition-transform duration-100 ease-out will-change-transform"
          style={isHovering ? {
            transform: 'scale(2)',
            transformOrigin: `${hoverPos.x}% ${hoverPos.y}%`
          } : { transform: 'scale(1)' }}
        >
          <EnhancedImage
            src={images[currentIndex]?.src}
            alt={images[currentIndex]?.alt || images[currentIndex]?.name || 'Product image'}
            width={600}
            height={600}
            className="object-cover w-full h-full"
            context="product"
            onLoad={handleMainImageLoad}
          />
        </div>
        
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
              onClick={(e) => {
                e.stopPropagation();
                goToPrevious();
              }}
              className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white rounded-full p-2 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Previous image"
            >
              <ChevronLeft className="h-5 w-5 text-gray-800" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                goToNext();
              }}
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
      <Lightbox />

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