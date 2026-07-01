'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Star, BadgeCheck, Quote } from 'lucide-react';
import apiClient from '@/lib/api';

interface Testimonial {
  id: string;
  name: string;
  rating: number;
  title?: string;
  comment: string;
  isVerifiedPurchase?: boolean;
  product?: { id: string; name: string; slug: string; image: string | null } | null;
}

export default function TestimonialsSection() {
  const [items, setItems] = useState<Testimonial[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiClient.get('/reviews/testimonials?limit=9') as any;
        setItems(data.testimonials || []);
      } catch {
        setItems([]);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Hide the section entirely until there is something to show.
  if (!loaded || items.length === 0) return null;

  return (
    <section className="bg-obsidian-deep py-16 border-t border-hairline">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <p className="text-xs font-display font-bold tracking-[0.2em] uppercase text-gold mb-3">
            What Drivers Say
          </p>
          <h2 className="text-4xl font-display font-bold text-ink uppercase">Trusted by Builders</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((t) => (
            <div key={t.id} className="relative bg-obsidian border border-hairline rounded-sm p-6 flex flex-col">
              <Quote className="absolute top-5 right-5 h-7 w-7 text-hairline" />

              <div className="flex items-center gap-1 mb-3">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star key={s} className={`h-4 w-4 ${s <= t.rating ? 'text-yellow-400 fill-yellow-400' : 'text-[#333]'}`} />
                ))}
              </div>

              {t.title && <h3 className="text-ink font-display font-bold mb-1">{t.title}</h3>}
              <p className="text-ink/70 text-sm font-display flex-1">&ldquo;{t.comment}&rdquo;</p>

              <div className="mt-4 pt-4 border-t border-hairline flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-ink text-sm font-display font-bold">{t.name}</span>
                  {t.isVerifiedPurchase && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-gold">
                      <BadgeCheck className="h-3.5 w-3.5" /> Verified
                    </span>
                  )}
                </div>
                {t.product && (
                  <Link href={`/products/${t.product.slug}`} className="text-[11px] text-[#777] hover:text-gold truncate max-w-[45%] text-right">
                    {t.product.name}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
