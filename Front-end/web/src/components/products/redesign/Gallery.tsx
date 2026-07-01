'use client';

import { useState } from 'react';
import ProductImage from '@/components/products/ProductImage';
import { cn } from '@/lib/utils';

export interface GalleryImage {
  src: string;
  alt: string;
}

/**
 * PDP gallery (obsidian + gold). Large main image with a thumbnail rail and a
 * circular SALE badge (Treato's reference), reskinned to the storefront theme.
 */
export default function Gallery({
  images,
  name,
  onSale,
}: {
  images: GalleryImage[];
  name: string;
  onSale?: boolean;
}) {
  const [active, setActive] = useState(0);
  const current = images[active];

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-square overflow-hidden border border-hairline bg-obsidian-raised">
        {current ? (
          <ProductImage src={current.src} alt={current.alt} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[11px] uppercase tracking-[0.2em] text-ink-muted">
            No image
          </div>
        )}
        {onSale && (
          <div className="absolute left-5 top-5 grid h-16 w-16 place-items-center rounded-full bg-gold text-[10px] font-semibold uppercase tracking-[0.16em] text-obsidian">
            Sale
          </div>
        )}
      </div>

      {images.length > 1 && (
        <div className="grid grid-cols-5 gap-3">
          {images.slice(0, 5).map((img, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              aria-label={`View image ${i + 1}`}
              className={cn(
                'relative aspect-square overflow-hidden border transition-colors',
                i === active ? 'border-gold' : 'border-hairline hover:border-gold/50'
              )}
            >
              <ProductImage src={img.src} alt={img.alt} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
