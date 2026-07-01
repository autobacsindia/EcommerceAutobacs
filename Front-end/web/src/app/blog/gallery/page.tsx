'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Image as ImageIcon, X, ChevronLeft, ChevronRight, ZoomIn } from 'lucide-react';
import { API_ENDPOINTS } from '@/lib/constants';

interface GalleryItem {
  _id: string;
  title: string;
  description: string;
  url: string;
  thumbnail: string;
  album: string;
  tags: string[];
}

function GalleryContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [items, setItems] = useState<GalleryItem[]>([]);
  const [albums, setAlbums] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<{ index: number } | null>(null);
  const [pagination, setPagination] = useState<{ total: number; pages: number } | null>(null);

  const album = searchParams.get('album') || 'all';
  const page = parseInt(searchParams.get('page') || '1');

  const fetchGallery = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '24',
        ...(album !== 'all' && { album }),
      });
      const res = await fetch(`/api/v1${API_ENDPOINTS.MEDIA_GALLERY}?${params}`);
      const data = await res.json();
      if (data.success) {
        setItems(data.data);
        setAlbums(data.albums || []);
        setPagination(data.pagination);
      }
    } catch (_) {}
    finally { setLoading(false); }
  }, [album, page]);

  useEffect(() => { fetchGallery(); }, [fetchGallery]);

  function updateParam(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (value && value !== 'all') p.set(key, value); else p.delete(key);
    p.delete('page');
    router.push(`?${p.toString()}`);
  }

  function openLightbox(index: number) { setLightbox({ index }); }
  function closeLightbox() { setLightbox(null); }
  function prevImage() {
    if (!lightbox) return;
    setLightbox({ index: (lightbox.index - 1 + items.length) % items.length });
  }
  function nextImage() {
    if (!lightbox) return;
    setLightbox({ index: (lightbox.index + 1) % items.length });
  }

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!lightbox) return;
      if (e.key === 'ArrowLeft') prevImage();
      if (e.key === 'ArrowRight') nextImage();
      if (e.key === 'Escape') closeLightbox();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  return (
    <div>
      {/* Header */}
      <div className="bg-linear-to-r from-purple-700 to-purple-900 text-ink py-14 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-3">
            <ImageIcon className="h-8 w-8 opacity-80" />
            <h1 className="text-4xl font-bold">Photo Gallery</h1>
          </div>
          <p className="text-ink/80 text-lg">Events, products and behind-the-scenes moments</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Album tabs */}
        {albums.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-8">
            {['all', ...albums].map(a => (
              <button
                key={a}
                onClick={() => updateParam('album', a)}
                className={`px-4 py-1.5 text-sm rounded-full border transition-colors capitalize ${album === a ? 'bg-purple-600 text-ink border-transparent' : 'border-hairline text-ink-muted hover:border-hairline'}`}
              >
                {a === 'all' ? 'All Albums' : a}
              </button>
            ))}
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {[...Array(24)].map((_, i) => (
              <div key={i} className="aspect-square bg-obsidian-raised rounded-lg animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20">
            <ImageIcon className="h-16 w-16 text-gray-200 mx-auto mb-4" />
            <p className="text-ink-muted">No photos in this album yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {items.map((item, index) => (
              <button
                key={item._id}
                onClick={() => openLightbox(index)}
                className="group aspect-square relative overflow-hidden rounded-lg bg-obsidian-raised focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <img
                  src={item.thumbnail || item.url}
                  alt={item.title}
                  loading="lazy"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-obsidian-deep/0 group-hover:bg-obsidian-deep/30 transition-colors flex items-center justify-center">
                  <ZoomIn className="h-8 w-8 text-ink opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.pages > 1 && (
          <div className="flex justify-center gap-2 mt-8">
            {[...Array(pagination.pages)].map((_, i) => (
              <button
                key={i}
                onClick={() => updateParam('page', String(i + 1))}
                className={`w-9 h-9 rounded-lg text-sm font-medium border transition-colors ${page === i + 1 ? 'bg-purple-600 text-ink border-transparent' : 'border-hairline text-ink-muted hover:bg-obsidian-deep'}`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox !== null && items[lightbox.index] && (
        <div
          className="fixed inset-0 bg-obsidian-deep/90 z-50 flex items-center justify-center p-4"
          onClick={closeLightbox}
        >
          <button
            onClick={(e) => { e.stopPropagation(); prevImage(); }}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-obsidian/10 hover:bg-obsidian/20 rounded-full text-ink transition-colors"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>

          <div className="max-w-5xl max-h-[90vh] flex flex-col items-center gap-3" onClick={e => e.stopPropagation()}>
            <img
              src={items[lightbox.index].url}
              alt={items[lightbox.index].title}
              className="max-h-[80vh] max-w-full object-contain rounded-lg"
            />
            <div className="text-center">
              <p className="text-ink font-medium">{items[lightbox.index].title}</p>
              {items[lightbox.index].description && (
                <p className="text-ink/70 text-sm mt-1">{items[lightbox.index].description}</p>
              )}
              <p className="text-ink/40 text-xs mt-1">{lightbox.index + 1} / {items.length}</p>
            </div>
          </div>

          <button
            onClick={(e) => { e.stopPropagation(); nextImage(); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-obsidian/10 hover:bg-obsidian/20 rounded-full text-ink transition-colors"
          >
            <ChevronRight className="h-6 w-6" />
          </button>

          <button
            onClick={closeLightbox}
            className="absolute top-4 right-4 p-2 bg-obsidian/10 hover:bg-obsidian/20 rounded-full text-ink transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function GalleryPage() {
  return (
    <Suspense fallback={<div className="h-96 flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-purple-600 border-t-transparent rounded-full" /></div>}>
      <GalleryContent />
    </Suspense>
  );
}
