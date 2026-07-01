'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Video, Play, ChevronLeft, ChevronRight } from 'lucide-react';
import { API_ENDPOINTS } from '@/lib/constants';

interface VideoItem {
  _id: string;
  title: string;
  description: string;
  url: string;
  thumbnail: string;
  category: string;
  embedType: string;
  duration: string;
  tags: string[];
}

function getEmbedUrl(item: VideoItem): string {
  if (item.embedType === 'youtube') {
    const match = item.url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
    if (match) return `https://www.youtube.com/embed/${match[1]}?autoplay=1`;
  }
  if (item.embedType === 'vimeo') {
    const match = item.url.match(/vimeo\.com\/(\d+)/);
    if (match) return `https://player.vimeo.com/video/${match[1]}?autoplay=1`;
  }
  return item.url;
}

function VideosContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeVideo, setActiveVideo] = useState<VideoItem | null>(null);
  const [pagination, setPagination] = useState<{ total: number; pages: number } | null>(null);

  const category = searchParams.get('category') || 'all';
  const page = parseInt(searchParams.get('page') || '1');

  const fetchVideos = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '12',
        ...(category !== 'all' && { category }),
      });
      const res = await fetch(`/api/v1${API_ENDPOINTS.MEDIA_VIDEOS}?${params}`);
      const data = await res.json();
      if (data.success) {
        setVideos(data.data);
        setCategories(data.categories || []);
        setPagination(data.pagination);
      }
    } catch (_) {}
    finally { setLoading(false); }
  }, [category, page]);

  useEffect(() => { fetchVideos(); }, [fetchVideos]);

  function updateParam(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (value && value !== 'all') p.set(key, value); else p.delete(key);
    p.delete('page');
    router.push(`?${p.toString()}`);
  }

  return (
    <div>
      {/* Header */}
      <div className="bg-linear-to-r from-red-700 to-red-900 text-ink py-14 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-3">
            <Video className="h-8 w-8 opacity-80" />
            <h1 className="text-4xl font-bold">Videos</h1>
          </div>
          <p className="text-ink/80 text-lg">Tutorials, promotions and behind-the-scenes content</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Category tabs */}
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-8">
            {['all', ...categories].map(c => (
              <button
                key={c}
                onClick={() => updateParam('category', c)}
                className={`px-4 py-1.5 text-sm rounded-full border transition-colors capitalize ${category === c ? 'bg-red-600 text-ink border-transparent' : 'border-hairline text-ink-muted hover:border-hairline'}`}
              >
                {c === 'all' ? 'All Videos' : c}
              </button>
            ))}
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-obsidian rounded-xl border border-hairline overflow-hidden animate-pulse">
                <div className="h-48 bg-obsidian-raised" />
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-obsidian-raised rounded w-2/3" />
                  <div className="h-3 bg-obsidian-raised rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : videos.length === 0 ? (
          <div className="text-center py-20">
            <Video className="h-16 w-16 text-gray-200 mx-auto mb-4" />
            <p className="text-ink-muted">No videos available yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {videos.map(video => (
              <button
                key={video._id}
                onClick={() => setActiveVideo(video)}
                className="group text-left bg-obsidian rounded-xl border border-hairline overflow-hidden hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <div className="relative h-48 bg-obsidian-raised overflow-hidden">
                  {video.thumbnail ? (
                    <img src={video.thumbnail} alt={video.title} loading="lazy" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-obsidian-deep">
                      <Video className="h-12 w-12 text-ink-muted" />
                    </div>
                  )}
                  {/* Play overlay */}
                  <div className="absolute inset-0 flex items-center justify-center bg-obsidian-deep/20 group-hover:bg-obsidian-deep/40 transition-colors">
                    <div className="w-14 h-14 bg-obsidian/90 group-hover:bg-obsidian rounded-full flex items-center justify-center shadow-lg transition-colors">
                      <Play className="h-6 w-6 text-red-600 ml-1" />
                    </div>
                  </div>
                  {video.duration && (
                    <span className="absolute bottom-2 right-2 bg-obsidian-deep/70 text-ink text-xs px-1.5 py-0.5 rounded">
                      {video.duration}
                    </span>
                  )}
                </div>
                <div className="p-4">
                  <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{video.category}</span>
                  <h3 className="font-semibold text-ink mt-2 text-sm line-clamp-2 group-hover:text-red-600 transition-colors">
                    {video.title}
                  </h3>
                  {video.description && (
                    <p className="text-xs text-ink-muted mt-1 line-clamp-2">{video.description}</p>
                  )}
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
                className={`w-9 h-9 rounded-lg text-sm font-medium border transition-colors ${page === i + 1 ? 'bg-red-600 text-ink border-transparent' : 'border-hairline text-ink-muted hover:bg-obsidian-deep'}`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Video Modal */}
      {activeVideo && (
        <div
          className="fixed inset-0 bg-obsidian-deep/80 z-50 flex items-center justify-center p-4"
          onClick={() => setActiveVideo(null)}
        >
          <div
            className="bg-obsidian-deep rounded-xl overflow-hidden w-full max-w-4xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="relative" style={{ paddingBottom: '56.25%' }}>
              <iframe
                src={getEmbedUrl(activeVideo)}
                title={activeVideo.title}
                allow="autoplay; fullscreen"
                allowFullScreen
                className="absolute inset-0 w-full h-full"
              />
            </div>
            <div className="p-4 bg-obsidian-deep">
              <h3 className="text-ink font-semibold">{activeVideo.title}</h3>
              {activeVideo.description && (
                <p className="text-ink-muted text-sm mt-1">{activeVideo.description}</p>
              )}
              <button
                onClick={() => setActiveVideo(null)}
                className="mt-3 text-xs text-ink-muted hover:text-ink transition-colors"
              >
                ✕ Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function VideosPage() {
  return (
    <Suspense fallback={<div className="h-96 flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-red-600 border-t-transparent rounded-full" /></div>}>
      <VideosContent />
    </Suspense>
  );
}
