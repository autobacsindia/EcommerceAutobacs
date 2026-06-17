'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';
import FloatingCTACard from './FloatingCTACard';

interface HeroSectionProps {
  product: {
    _id: string;
    name: string;
    price: number;
    originalPrice?: number;
    stock: number;
    shortDescription?: string;
    images?: Array<{ url: string; alt?: string }>;
  };
}

export default function HeroSection({ product }: HeroSectionProps) {
  const lifestyleImage = product.images?.[0]?.url || '/placeholder-product.jpg';

  return (
    <section className="relative h-[80vh] min-h-[600px] max-h-[900px]">
      {/* Background — isolated overflow-hidden so the fill image is clipped
          but the CTA card can extend beyond the section without being blocked */}
      <div className="absolute inset-0 overflow-hidden">
        <Image
          src={lifestyleImage}
          alt={product.name}
          fill
          className="object-cover"
          priority
          sizes="100vw"
        />
        {/* Dark Gradient Overlays */}
        <div className="absolute inset-0 bg-linear-to-r from-black/95 via-black/80 to-black/50" />
        <div className="absolute inset-0 bg-linear-to-t from-black/90 via-transparent to-black/40" />
      </div>

      {/* Content */}
      <div className="relative z-10 h-full max-w-7xl mx-auto px-6 flex items-center">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 w-full items-center">
          
          {/* Left: Product Info */}
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            className="space-y-6"
          >
            {/* Badge */}
            <div className="inline-block px-4 py-2 bg-orange-500/20 border border-orange-500/30 rounded-full">
              <span className="text-orange-400 font-semibold text-sm">
                PREMIUM OFF-ROAD GEAR
              </span>
            </div>

            {/* Product Name */}
            <h1 className="text-5xl lg:text-6xl xl:text-7xl font-black text-white leading-tight tracking-tight">
              {product.name}
            </h1>

            {/* Subtitle */}
            <p className="text-xl lg:text-2xl text-zinc-300 leading-relaxed max-w-xl">
              {product.shortDescription || 'Built for extreme off-road visibility and rugged Indian terrain.'}
            </p>

            {/* Price */}
            <div className="flex items-baseline gap-4 flex-wrap">
              <span className="text-4xl lg:text-5xl font-bold text-orange-500">
                ₹{product.price.toLocaleString('en-IN')}
              </span>
              {product.originalPrice && product.originalPrice > product.price && (
                <>
                  <span className="text-2xl text-zinc-500 line-through">
                    ₹{product.originalPrice.toLocaleString('en-IN')}
                  </span>
                  <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full font-semibold text-sm border border-green-500/30">
                    {Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)}% OFF
                  </span>
                </>
              )}
            </div>

            {/* Stock Status */}
            {product.stock > 0 && (
              <p className="text-zinc-400 flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                {product.stock <= 5 ? (
                  <span className="text-orange-400 font-semibold">
                    Only {product.stock} left - Order now!
                  </span>
                ) : (
                  'In Stock - Ships within 24 hours'
                )}
              </p>
            )}

            {/* Social Proof */}
            <div className="flex items-center gap-3 pt-4">
              <div className="flex -space-x-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="w-10 h-10 rounded-full bg-zinc-700 border-2 border-zinc-900 flex items-center justify-center text-xs text-white">
                    {String.fromCharCode(64 + i)}
                  </div>
                ))}
              </div>
              <div className="text-zinc-300 text-sm">
                <span className="text-white font-semibold">500+</span> off-road enthusiasts installed
              </div>
            </div>
          </motion.div>

          {/* Right: Floating CTA Card (Desktop Only) */}
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="hidden lg:block"
          >
            <FloatingCTACard product={product} />
          </motion.div>

        </div>
      </div>

      {/* Scroll Indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10"
      >
        <div className="w-6 h-10 border-2 border-white/30 rounded-full flex justify-center">
          <motion.div
            animate={{ y: [0, 12, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="w-1 h-3 bg-white/60 rounded-full mt-2"
          />
        </div>
      </motion.div>
    </section>
  );
}
