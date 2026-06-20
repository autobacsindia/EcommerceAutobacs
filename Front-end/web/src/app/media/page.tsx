'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Newspaper, BookOpen, Image as ImageIcon, Video,
  ArrowRight, Calendar, Eye, Flame, Star,
} from 'lucide-react';
import { API_ENDPOINTS } from '@/lib/constants';

interface Article {
  _id: string;
  title: string;
  slug: string;
  type: 'news' | 'blog';
  coverImage: string;
  excerpt: string;
  category: string;
  author: string;
  views: number;
  featured: boolean;
  publishedAt: string;
  createdAt?: string;
}

const SECTIONS = [
  { href: '/media/news', label: 'News', icon: Newspaper, color: 'bg-blue-600', desc: 'Latest company updates, product launches and industry news' },
  { href: '/media/blogs', label: 'Blog', icon: BookOpen, color: 'bg-green-600', desc: 'Tips, guides and expert automotive advice' },
  { href: '/media/gallery', label: 'Gallery', icon: ImageIcon, color: 'bg-purple-600', desc: 'Photos from events, products and workshops' },
  { href: '/media/videos', label: 'Videos', icon: Video, color: 'bg-red-600', desc: 'Tutorials, promotions and behind-the-scenes clips' },
];

export default function MediaCenterPage() {
  const [featured, setFeatured] = useState<Article[]>([]);
  const [trending, setTrending] = useState<Article[]>([]);
  const [recentNews, setRecentNews] = useState<Article[]>([]);
  const [recentBlogs, setRecentBlogs] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [featRes, trendRes, newsRes, blogsRes] = await Promise.all([
          fetch(`/api/v1${API_ENDPOINTS.MEDIA_ARTICLES}?featured=true&limit=4`),
          fetch(`/api/v1/media/trending?limit=5`),
          fetch(`/api/v1${API_ENDPOINTS.MEDIA_ARTICLES}?type=news&limit=4`),
          fetch(`/api/v1${API_ENDPOINTS.MEDIA_ARTICLES}?type=blog&limit=4`),
        ]);
        const [featData, trendData, newsData, blogsData] = await Promise.all([
          featRes.json(), trendRes.json(), newsRes.json(), blogsRes.json(),
        ]);
        if (featData.success) setFeatured(featData.data);
        if (trendData.success) setTrending(trendData.data);
        if (newsData.success) setRecentNews(newsData.data);
        if (blogsData.success) setRecentBlogs(blogsData.data);
      } catch (_) {}
      finally { setLoading(false); }
    })();
  }, []);

  const heroArticle = featured[0] || null;
  const secondaryFeatured = featured.slice(1, 4);

  return (
    <div>
      {/* ── Hero Section ─────────────────────────────────────────────────────── */}
      {!loading && heroArticle ? (
        <HeroFeatured hero={heroArticle} secondary={secondaryFeatured} />
      ) : (
        <div className="bg-linear-to-br from-gray-900 via-gray-800 to-red-900 text-white py-20 px-4">
          <div className="max-w-4xl mx-auto text-center">
            <p className="text-red-400 text-sm font-semibold uppercase tracking-widest mb-3">Autobacs Media Center</p>
            <h1 className="text-4xl md:text-5xl font-bold mb-5 leading-tight">News, Insights &amp; Stories</h1>
            <p className="text-gray-300 text-lg max-w-2xl mx-auto">
              Stay up to date with the latest from Autobacs — product launches, automotive tips, event galleries and more.
            </p>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">

        {/* Section Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-14">
          {SECTIONS.map(({ href, label, icon: Icon, color, desc }) => (
            <Link key={href} href={href}
              className="group bg-white rounded-xl border border-gray-200 p-5 hover:shadow-lg hover:border-gray-300 transition-all flex flex-col gap-3"
            >
              <div className={`${color} w-10 h-10 rounded-lg flex items-center justify-center`}>
                <Icon className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="font-semibold text-gray-900 group-hover:text-red-600 transition-colors">{label}</p>
                <p className="text-xs text-gray-500 mt-1 leading-snug">{desc}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-gray-400 group-hover:text-red-500 transition-colors mt-auto" />
            </Link>
          ))}
        </div>

        {/* 🔥 Trending */}
        {!loading && trending.length > 0 && (
          <section className="mb-14">
            <div className="flex items-center gap-2 mb-5">
              <Flame className="h-5 w-5 text-orange-500" />
              <h2 className="text-xl font-bold text-gray-900">Trending</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {trending.map((a, i) => (
                <Link
                  key={a._id}
                  href={`/media/${a.type}/${a.slug}`}
                  className="group flex gap-3 bg-white rounded-lg border border-gray-100 p-3 hover:shadow-sm hover:border-orange-200 transition-all"
                >
                  <span className="text-2xl font-bold text-orange-200 group-hover:text-orange-400 transition-colors w-7 shrink-0">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 group-hover:text-red-600 transition-colors line-clamp-2">{a.title}</p>
                    <p className="text-xs text-gray-400 mt-1 flex items-center gap-1"><Eye className="h-3 w-3" />{a.views}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Recent News + Recent Blogs */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          <RecentSection title="Latest News" href="/media/news" articles={recentNews} loading={loading} />
          <RecentSection title="Latest Blog Posts" href="/media/blogs" articles={recentBlogs} loading={loading} />
        </div>
      </div>
    </div>
  );
}

// ── Hero Featured layout ──────────────────────────────────────────────────────
function HeroFeatured({ hero, secondary }: { hero: Article; secondary: Article[] }) {
  return (
    <div className="bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex items-center gap-2 mb-6">
          <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
          <span className="text-amber-400 text-sm font-semibold uppercase tracking-widest">Featured</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Large hero card */}
          <Link
            href={`/media/${hero.type}/${hero.slug}`}
            className="lg:col-span-2 group relative rounded-2xl overflow-hidden min-h-95 flex flex-col justify-end"
          >
            {hero.coverImage ? (
              <img src={hero.coverImage} alt={hero.title} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
            ) : (
              <div className="absolute inset-0 bg-linear-to-br from-red-800 to-gray-900" />
            )}
            <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-transparent" />
            <div className="relative p-6">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${hero.type === 'news' ? 'bg-blue-500' : 'bg-green-500'} text-white mb-3 inline-block`}>
                {hero.type === 'news' ? 'News' : 'Blog'}
              </span>
              <h2 className="text-2xl md:text-3xl font-bold leading-tight mb-2 group-hover:text-red-300 transition-colors">
                {hero.title}
              </h2>
              {hero.excerpt && <p className="text-gray-300 text-sm line-clamp-2 mb-3">{hero.excerpt}</p>}
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />
                  {new Date(hero.publishedAt || hero.createdAt || Date.now()).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{hero.views}</span>
              </div>
            </div>
          </Link>

          {/* 3 secondary highlights */}
          <div className="flex flex-col gap-4">
            {secondary.length === 0
              ? (
                <div className="flex-1 rounded-2xl bg-linear-to-br from-gray-800 to-gray-900 flex items-center justify-center">
                  <p className="text-gray-500 text-sm text-center px-4">Mark articles as Featured to show them here</p>
                </div>
              )
              : secondary.map(a => (
                <Link
                  key={a._id}
                  href={`/media/${a.type}/${a.slug}`}
                  className="group relative rounded-xl overflow-hidden h-28 flex flex-col justify-end flex-1"
                >
                  {a.coverImage
                    ? <img src={a.coverImage} alt={a.title} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    : <div className="absolute inset-0 bg-linear-to-br from-gray-700 to-gray-900" />}
                  <div className="absolute inset-0 bg-linear-to-t from-black/70 to-transparent" />
                  <div className="relative p-3">
                    <p className="text-white text-sm font-semibold line-clamp-2 group-hover:text-red-300 transition-colors">{a.title}</p>
                    <p className="text-gray-400 text-xs mt-0.5">{a.category}</p>
                  </div>
                </Link>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Recent section ────────────────────────────────────────────────────────────
function RecentSection({ title, href, articles, loading }: { title: string; href: string; articles: Article[]; loading: boolean }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        <Link href={href} className="text-sm text-red-600 hover:underline flex items-center gap-1">
          View all <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      {loading ? (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      ) : articles.length === 0 ? (
        <p className="text-gray-500 text-sm py-8 text-center">No articles yet. Check back soon.</p>
      ) : (
        <div className="space-y-4">
          {articles.map(a => (
            <Link key={a._id} href={`/media/${a.type}/${a.slug}`}
              className="flex gap-4 group bg-white rounded-lg border border-gray-100 p-3 hover:shadow-sm hover:border-gray-200 transition-all"
            >
              {a.coverImage
                ? <img src={a.coverImage} alt={a.title} className="w-20 h-16 object-cover rounded-md shrink-0" />
                : <div className="w-20 h-16 bg-gray-100 rounded-md shrink-0 flex items-center justify-center"><Newspaper className="h-6 w-6 text-gray-300" /></div>}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 group-hover:text-red-600 transition-colors text-sm line-clamp-2 mb-1">{a.title}</p>
                <p className="text-xs text-gray-400">
                  {new Date(a.publishedAt || a.createdAt || Date.now()).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
