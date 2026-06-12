'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Search, Calendar, Eye, Tag, ChevronLeft, ChevronRight, Newspaper, BookOpen } from 'lucide-react';
import { API_ENDPOINTS } from '@/lib/constants';

interface Article {
  _id: string;
  title: string;
  slug: string;
  type: 'news' | 'blog';
  coverImage: string;
  excerpt: string;
  category: string;
  tags: string[];
  author: string;
  views: number;
  publishedAt: string;
  createdAt?: string;
  featured: boolean;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

interface ArticleListPageProps {
  type: 'news' | 'blog';
}

function ArticleListContent({ type }: ArticleListPageProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [articles, setArticles] = useState<Article[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const page = parseInt(searchParams.get('page') || '1');
  const category = searchParams.get('category') || '';
  const search = searchParams.get('search') || '';

  const [searchInput, setSearchInput] = useState(search);

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        type,
        page: String(page),
        limit: '12',
        ...(category && { category }),
        ...(search && { search }),
      });
      const res = await fetch(`/api/v1${API_ENDPOINTS.MEDIA_ARTICLES}?${params}`);
      const data = await res.json();
      if (data.success) {
        setArticles(data.data);
        setPagination(data.pagination);
      }
    } catch (_) {}
    finally { setLoading(false); }
  }, [type, page, category, search]);

  useEffect(() => { fetchArticles(); }, [fetchArticles]);

  useEffect(() => {
    fetch(`/api/v1${API_ENDPOINTS.MEDIA_ARTICLE_CATEGORIES}?type=${type}`)
      .then(r => r.json())
      .then(d => { if (d.success) setCategories(d.data); })
      .catch(() => {});
  }, [type]);

  function updateParam(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (value) p.set(key, value); else p.delete(key);
    p.delete('page');
    router.push(`?${p.toString()}`);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    updateParam('search', searchInput);
  }

  const Icon = type === 'news' ? Newspaper : BookOpen;
  const color = type === 'news' ? 'blue' : 'green';
  const colorClasses = {
    badge: type === 'news' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700',
    btn: type === 'news' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700',
    active: type === 'news' ? 'bg-blue-600 text-white' : 'bg-green-600 text-white',
    hover: type === 'news' ? 'hover:text-blue-600' : 'hover:text-green-600',
  };

  const title = type === 'news' ? 'News' : 'Blog';
  const desc = type === 'news'
    ? 'Latest updates, product launches and company announcements'
    : 'Expert tips, guides and automotive insights';

  return (
    <div>
      {/* Header */}
      <div className={`bg-linear-to-r ${type === 'news' ? 'from-blue-700 to-blue-900' : 'from-green-700 to-green-900'} text-white py-14 px-4`}>
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-3">
            <Icon className="h-8 w-8 opacity-80" />
            <h1 className="text-4xl font-bold">{title}</h1>
          </div>
          <p className="text-white/80 text-lg">{desc}</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          {/* Search */}
          <form onSubmit={handleSearch} className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder={`Search ${title.toLowerCase()}...`}
                className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </form>

          {/* Category filter */}
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              <button
                onClick={() => updateParam('category', '')}
                className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${!category ? colorClasses.active + ' border-transparent' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
              >
                All
              </button>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => updateParam('category', cat)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${category === cat ? colorClasses.active + ' border-transparent' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Active filters */}
        {(search || category) && (
          <div className="flex items-center gap-2 mb-5 text-sm text-gray-600">
            <span>Showing results for:</span>
            {search && (
              <span className="flex items-center gap-1 bg-gray-100 px-2 py-0.5 rounded-full">
                <Search className="h-3 w-3" /> {search}
                <button onClick={() => { setSearchInput(''); updateParam('search', ''); }} className="ml-1 text-gray-400 hover:text-gray-700">×</button>
              </span>
            )}
            {category && (
              <span className="flex items-center gap-1 bg-gray-100 px-2 py-0.5 rounded-full">
                <Tag className="h-3 w-3" /> {category}
                <button onClick={() => updateParam('category', '')} className="ml-1 text-gray-400 hover:text-gray-700">×</button>
              </span>
            )}
          </div>
        )}

        {/* Articles grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 overflow-hidden animate-pulse">
                <div className="h-48 bg-gray-100" />
                <div className="p-4 space-y-3">
                  <div className="h-4 bg-gray-100 rounded w-1/3" />
                  <div className="h-5 bg-gray-100 rounded w-full" />
                  <div className="h-4 bg-gray-100 rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : articles.length === 0 ? (
          <div className="text-center py-20">
            <Icon className="h-16 w-16 text-gray-200 mx-auto mb-4" />
            <p className="text-gray-500 text-lg">No {title.toLowerCase()} articles found.</p>
            {(search || category) && (
              <button onClick={() => { setSearchInput(''); router.push('?'); }} className="mt-3 text-sm text-red-600 hover:underline">
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {articles.map(article => (
              <ArticleCard key={article._id} article={article} colorClasses={colorClasses} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.pages > 1 && (
          <div className="flex justify-center items-center gap-2 mt-10">
            <button
              disabled={page <= 1}
              onClick={() => updateParam('page', String(page - 1))}
              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {[...Array(pagination.pages)].map((_, i) => (
              <button
                key={i}
                onClick={() => updateParam('page', String(i + 1))}
                className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${page === i + 1 ? colorClasses.active + ' border-transparent' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >
                {i + 1}
              </button>
            ))}
            <button
              disabled={page >= pagination.pages}
              onClick={() => updateParam('page', String(page + 1))}
              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ArticleCard({ article, colorClasses }: { article: Article; colorClasses: Record<string, string> }) {
  return (
    <Link
      href={`/media/${article.type}/${article.slug}`}
      className="group bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
    >
      {article.coverImage ? (
        <img
          src={article.coverImage}
          alt={article.title}
          loading="lazy"
          className="w-full h-48 object-cover group-hover:scale-105 transition-transform duration-300"
        />
      ) : (
        <div className="w-full h-48 bg-linear-to-br from-gray-100 to-gray-200 flex items-center justify-center">
          {article.type === 'news' ? (
            <Newspaper className="h-12 w-12 text-gray-300" />
          ) : (
            <BookOpen className="h-12 w-12 text-gray-300" />
          )}
        </div>
      )}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          {article.featured && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Featured</span>
          )}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colorClasses.badge}`}>
            {article.category}
          </span>
        </div>
        <h3 className={`font-semibold text-gray-900 group-hover:text-red-600 transition-colors line-clamp-2 mb-2 text-sm`}>
          {article.title}
        </h3>
        {article.excerpt && (
          <p className="text-xs text-gray-500 line-clamp-2 mb-3">{article.excerpt}</p>
        )}
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {new Date(article.publishedAt || article.createdAt || Date.now()).toLocaleDateString('en-IN', {
              day: 'numeric', month: 'short', year: 'numeric',
            })}
          </span>
          <span className="flex items-center gap-1">
            <Eye className="h-3 w-3" />
            {article.views}
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function ArticleListPage({ type }: ArticleListPageProps) {
  return (
    <Suspense fallback={<div className="h-96 flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-red-600 border-t-transparent rounded-full" /></div>}>
      <ArticleListContent type={type} />
    </Suspense>
  );
}
