'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Plus, Edit2, Trash2, Eye, EyeOff, Star, Search, BookOpen, Image as ImageIcon, Video, ChevronLeft, ChevronRight, TrendingUp, BarChart2, MessageSquare, CheckCircle, XCircle } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { articleHref } from '@/lib/articleRoutes';
import SeoPanel, { EMPTY_SEO, toSeoFormValue, type SeoFormValue } from '@/components/admin/SeoPanel';

type Tab = 'posts' | 'gallery' | 'videos' | 'comments';

interface Stats {
  articles: { total: number; published: number; news: number; blogs: number };
  media: { images: number; videos: number };
  topArticles: { _id: string; title: string; slug: string; type: string; views: number }[];
}

interface Article {
  _id: string;
  title: string;
  slug: string;
  type: 'news' | 'blog';
  category: string;
  status: 'draft' | 'published';
  featured: boolean;
  views: number;
  author: string;
  publishedAt: string;
  createdAt: string;
}

interface MediaItem {
  _id: string;
  type: 'image' | 'video';
  title: string;
  url: string;
  thumbnail: string;
  album: string;
  category: string;
  status: 'draft' | 'published';
  embedType: string;
  createdAt: string;
}

interface AdminComment {
  _id: string;
  name: string;
  email: string;
  comment: string;
  approved: boolean;
  parent: string | null;
  createdAt: string;
  article: { _id: string; title: string; slug: string; type: string } | null;
}

// ─── Blog Post Form ──────────────────────────────────────────────────────────
// Type is fixed to "blog" — News is managed in the Media/Press admin.
const EMPTY_POST = {
  title: '', coverImage: '', excerpt: '',
  content: '', category: '', tags: '', author: '', status: 'draft' as 'draft' | 'published', featured: false,
};

// ─── Media Item Form ───────────────────────────────────────────────────────────
const EMPTY_MEDIA = {
  type: 'image' as 'image' | 'video', title: '', description: '', url: '',
  thumbnail: '', album: '', category: '', tags: '', status: 'published' as 'draft' | 'published',
  featured: false, duration: '',
};

export default function AdminBlogPage() {
  const [tab, setTab] = useState<Tab>('posts');
  const [articles, setArticles] = useState<Article[]>([]);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, pages: 1 });
  const [stats, setStats] = useState<Stats | null>(null);
  const [showStats, setShowStats] = useState(false);

  // Post form state
  const [showPostForm, setShowPostForm] = useState(false);
  const [editingPost, setEditingPost] = useState<Article | null>(null);
  const [postForm, setPostForm] = useState({ ...EMPTY_POST });
  const [postSeo, setPostSeo] = useState<SeoFormValue>(EMPTY_SEO);
  const [postSaving, setPostSaving] = useState(false);

  // Media form state
  const [showMediaForm, setShowMediaForm] = useState(false);
  const [editingMedia, setEditingMedia] = useState<MediaItem | null>(null);
  const [mediaForm, setMediaForm] = useState({ ...EMPTY_MEDIA });
  const [mediaSaving, setMediaSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Comments tab state
  const [comments, setComments] = useState<AdminComment[]>([]);
  const [commentPage, setCommentPage] = useState(1);
  const [commentPages, setCommentPages] = useState(1);
  const [commentTotal, setCommentTotal] = useState(0);
  const [approvedFilter, setApprovedFilter] = useState('');

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(pagination.page), limit: '20', type: 'blog' };
      if (statusFilter) params.status = statusFilter;
      const res = await apiClient.get<any>(API_ENDPOINTS.ADMIN_MEDIA_ARTICLES, { params });
      if (res.success) {
        setArticles(res.data);
        setPagination(p => ({ ...p, pages: res.pagination.pages }));
      }
    } catch (_) {}
    finally { setLoading(false); }
  }, [pagination.page, statusFilter]);

  const fetchMediaItems = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(pagination.page), limit: '24' };
      params.type = tab === 'gallery' ? 'image' : 'video';
      const res = await apiClient.get<any>(API_ENDPOINTS.ADMIN_MEDIA_ITEMS, { params });
      if (res.success) {
        setMediaItems(res.data);
        setPagination(p => ({ ...p, pages: res.pagination.pages }));
      }
    } catch (_) {}
    finally { setLoading(false); }
  }, [tab, pagination.page]);

  const fetchComments = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(commentPage), limit: '50', type: 'blog' };
      if (approvedFilter !== '') params.approved = approvedFilter;
      const res = await apiClient.get<any>(API_ENDPOINTS.ADMIN_MEDIA_COMMENTS, { params });
      if (res.success) {
        setComments(res.data);
        setCommentPages(res.pagination.pages);
        setCommentTotal(res.pagination.total);
      }
    } catch (_) {}
    finally { setLoading(false); }
  }, [commentPage, approvedFilter]);

  useEffect(() => {
    setPagination(p => ({ ...p, page: 1 }));
  }, [tab, statusFilter]);

  useEffect(() => {
    if (tab === 'posts') fetchPosts();
    else if (tab === 'comments') fetchComments();
    else fetchMediaItems();
  }, [tab, fetchPosts, fetchMediaItems, fetchComments]);

  // Fetch analytics stats
  useEffect(() => {
    apiClient.get<any>(API_ENDPOINTS.MEDIA_STATS)
      .then(res => { if (res.success) setStats(res.data); })
      .catch(() => {});
  }, []);

  // ── Blog Post CRUD ────────────────────────────────────────────────────────────

  async function savePost(e: React.FormEvent) {
    e.preventDefault();
    setPostSaving(true);
    try {
      const payload = {
        ...postForm,
        type: 'blog',
        tags: postForm.tags.split(',').map(t => t.trim()).filter(Boolean),
        seo: postSeo,
      };
      if (editingPost) {
        await apiClient.put(API_ENDPOINTS.ADMIN_MEDIA_ARTICLE(editingPost._id), payload);
      } else {
        await apiClient.post(API_ENDPOINTS.ADMIN_MEDIA_ARTICLES, payload);
      }
      setShowPostForm(false);
      setEditingPost(null);
      setPostForm({ ...EMPTY_POST });
      setPostSeo(EMPTY_SEO);
      fetchPosts();
    } catch (_) {}
    finally { setPostSaving(false); }
  }

  async function deletePost(id: string) {
    if (!confirm('Delete this post?')) return;
    try {
      await apiClient.delete(API_ENDPOINTS.ADMIN_MEDIA_ARTICLE(id));
      fetchPosts();
    } catch (_) {}
  }

  async function togglePostStatus(article: Article) {
    try {
      await apiClient.put(API_ENDPOINTS.ADMIN_MEDIA_ARTICLE(article._id), {
        status: article.status === 'published' ? 'draft' : 'published',
      });
      fetchPosts();
    } catch (_) {}
  }

  function startEditPost(article: Article) {
    setEditingPost(article);
    apiClient.get<any>(API_ENDPOINTS.ADMIN_MEDIA_ARTICLE(article._id))
      .then(res => {
        if (res.success) {
          const a = res.data;
          setPostForm({
            title: a.title, coverImage: a.coverImage,
            excerpt: a.excerpt, content: a.content, category: a.category,
            tags: (a.tags || []).join(', '), author: a.author,
            status: a.status, featured: a.featured,
          });
          setPostSeo(toSeoFormValue(a.seo));
          setShowPostForm(true);
        }
      })
      .catch(() => {});
  }

  // ── Media CRUD ────────────────────────────────────────────────────────────────

  async function saveMedia(e: React.FormEvent) {
    e.preventDefault();
    setMediaSaving(true);
    try {
      const payload = {
        ...mediaForm,
        tags: mediaForm.tags.split(',').map(t => t.trim()).filter(Boolean),
      };
      if (editingMedia) {
        await apiClient.put(API_ENDPOINTS.ADMIN_MEDIA_ITEM(editingMedia._id), payload);
      } else {
        await apiClient.post(API_ENDPOINTS.ADMIN_MEDIA_ITEMS, payload);
      }
      setShowMediaForm(false);
      setEditingMedia(null);
      setMediaForm({ ...EMPTY_MEDIA });
      fetchMediaItems();
    } catch (_) {}
    finally { setMediaSaving(false); }
  }

  async function deleteMedia(id: string) {
    if (!confirm('Delete this item?')) return;
    try {
      await apiClient.delete(API_ENDPOINTS.ADMIN_MEDIA_ITEM(id));
      fetchMediaItems();
    } catch (_) {}
  }

  function startEditMedia(item: MediaItem) {
    setEditingMedia(item);
    setMediaForm({
      type: item.type, title: item.title, description: (item as any).description || '',
      url: item.url, thumbnail: item.thumbnail, album: item.album, category: item.category,
      tags: ((item as any).tags || []).join(', '), status: item.status,
      featured: (item as any).featured || false, duration: (item as any).duration || '',
    });
    setShowMediaForm(true);
  }

  // ── Comment moderation ────────────────────────────────────────────────────────

  async function deleteComment(id: string) {
    if (!confirm('Delete this comment and its replies?')) return;
    try {
      await apiClient.delete(API_ENDPOINTS.ADMIN_MEDIA_COMMENT(id));
      setComments(prev => prev.filter(c => c._id !== id && c.parent !== id));
      setCommentTotal(t => t - 1);
    } catch (_) {}
  }

  async function toggleCommentApproval(id: string) {
    try {
      const res = await apiClient.patch<any>(API_ENDPOINTS.ADMIN_MEDIA_COMMENT_APPROVE(id));
      if (res.success) {
        setComments(prev => prev.map(c => c._id === id ? { ...c, approved: res.data.approved } : c));
      }
    } catch (_) {}
  }

  const filteredPosts = articles.filter(a =>
    !search || a.title.toLowerCase().includes(search.toLowerCase()) || a.author.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Blog</h1>
        <div className="flex items-center gap-2">
          {stats && (
            <button
              onClick={() => setShowStats(s => !s)}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <BarChart2 className="h-4 w-4 text-gray-500" />
              Analytics
            </button>
          )}
          {tab !== 'comments' && (
            <button
              onClick={() => {
                if (tab === 'posts') { setEditingPost(null); setPostForm({ ...EMPTY_POST }); setPostSeo(EMPTY_SEO); setShowPostForm(true); }
                else { setEditingMedia(null); setMediaForm({ ...EMPTY_MEDIA, type: tab === 'gallery' ? 'image' : 'video' }); setShowMediaForm(true); }
              }}
              className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              {tab === 'posts' ? 'New Post' : tab === 'gallery' ? 'Add Image' : 'Add Video'}
            </button>
          )}
        </div>
      </div>

      {/* Analytics Stats Panel */}
      {showStats && stats && (
        <div className="mb-6 bg-gray-50 rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-5 w-5 text-red-600" />
            <h2 className="font-semibold text-gray-900">Analytics Overview</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Blog Posts', value: stats.articles.blogs, color: 'text-green-600' },
              { label: 'Images', value: stats.media.images, color: 'text-purple-600' },
              { label: 'Videos', value: stats.media.videos, color: 'text-red-600' },
              { label: 'Published Articles', value: stats.articles.published, color: 'text-gray-900' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white rounded-lg border border-gray-200 p-3 text-center">
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
          {stats.topArticles.filter(a => a.type === 'blog').length > 0 && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">🔥 Most Viewed Posts</p>
              <div className="space-y-1.5">
                {stats.topArticles.filter(a => a.type === 'blog').map((a, i) => (
                  <div key={a._id} className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-gray-100">
                    <span className="text-sm font-bold text-gray-300 w-5">{i + 1}</span>
                    <Link href={articleHref('blog', a.slug)} target="_blank" className="flex-1 text-sm text-gray-700 hover:text-red-600 line-clamp-1 transition-colors">{a.title}</Link>
                    <span className="text-xs font-medium text-gray-500 flex items-center gap-1"><Eye className="h-3 w-3" />{a.views}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
        {[
          { id: 'posts', label: 'Blog Posts', icon: BookOpen },
          { id: 'gallery', label: 'Gallery', icon: ImageIcon },
          { id: 'videos', label: 'Videos', icon: Video },
          { id: 'comments', label: `Comments${commentTotal > 0 ? ` (${commentTotal})` : ''}`, icon: MessageSquare },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id as Tab)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Posts Tab */}
      {tab === 'posts' && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search posts..."
                className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none"
            >
              <option value="">All Status</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
            </select>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />)}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Title</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Category</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Views</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Date</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredPosts.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-12 text-gray-400">No posts found</td></tr>
                  ) : filteredPosts.map(article => (
                    <tr key={article._id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {article.featured && <Star className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
                          <span className="font-medium text-gray-900 line-clamp-1">{article.title}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{article.category}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${article.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                          {article.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{article.views}</td>
                      <td className="px-4 py-3 text-gray-500">
                        {new Date(article.publishedAt || article.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => togglePostStatus(article)}
                            title={article.status === 'published' ? 'Unpublish' : 'Publish'}
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                          >
                            {article.status === 'published' ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                          <Link
                            href={articleHref('blog', article.slug)}
                            target="_blank"
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-blue-600 transition-colors"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>
                          <button
                            onClick={() => startEditPost(article)}
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => deletePost(article._id)}
                            className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Gallery / Videos Tab */}
      {(tab === 'gallery' || tab === 'videos') && (
        <>
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {[...Array(12)].map((_, i) => <div key={i} className="aspect-square bg-gray-100 rounded-lg animate-pulse" />)}
            </div>
          ) : mediaItems.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              {tab === 'gallery' ? <ImageIcon className="h-16 w-16 mx-auto mb-3" /> : <Video className="h-16 w-16 mx-auto mb-3" />}
              <p>No {tab === 'gallery' ? 'images' : 'videos'} yet. Add your first one!</p>
            </div>
          ) : tab === 'gallery' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {mediaItems.map(item => (
                <div key={item._id} className="group relative aspect-square rounded-lg overflow-hidden border border-gray-200">
                  <img src={item.thumbnail || item.url} alt={item.title} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                    <button onClick={() => startEditMedia(item)} className="p-1.5 bg-white rounded-full text-gray-700 hover:text-blue-600">
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button onClick={() => deleteMedia(item._id)} className="p-1.5 bg-white rounded-full text-gray-700 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-white text-xs truncate">{item.title}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {mediaItems.map(item => (
                <div key={item._id} className="group bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-sm transition-shadow">
                  <div className="relative h-40 bg-gray-100">
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt={item.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gray-900">
                        <Video className="h-10 w-10 text-gray-500" />
                      </div>
                    )}
                    <span className="absolute top-2 right-2 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded capitalize">
                      {item.embedType || 'video'}
                    </span>
                  </div>
                  <div className="p-3">
                    <p className="font-medium text-sm text-gray-900 line-clamp-1">{item.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{item.category}</p>
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => startEditMedia(item)} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                        <Edit2 className="h-3 w-3" /> Edit
                      </button>
                      <button onClick={() => deleteMedia(item._id)} className="text-xs text-red-600 hover:underline flex items-center gap-1">
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Comments Tab */}
      {tab === 'comments' && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-5">
            <select
              value={approvedFilter}
              onChange={e => { setApprovedFilter(e.target.value); setCommentPage(1); }}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none"
            >
              <option value="">All</option>
              <option value="true">Approved</option>
              <option value="false">Hidden</option>
            </select>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />)}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Commenter</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Comment</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Post</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Date</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {comments.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-12 text-gray-400">No comments yet</td></tr>
                  ) : comments.map(c => (
                    <tr key={c._id} className={`hover:bg-gray-50 transition-colors ${!c.approved ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{c.name}</p>
                        <p className="text-xs text-gray-400">{c.email}</p>
                        {c.parent && <span className="text-xs text-blue-500">↳ reply</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-700 max-w-xs">
                        <p className="line-clamp-2">{c.comment}</p>
                      </td>
                      <td className="px-4 py-3">
                        {c.article ? (
                          <Link
                            href={articleHref(c.article.type, c.article.slug)}
                            target="_blank"
                            className="text-xs text-blue-600 hover:underline line-clamp-2"
                          >
                            {c.article.title}
                          </Link>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.approved ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                          {c.approved ? 'Approved' : 'Hidden'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {new Date(c.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => toggleCommentApproval(c._id)}
                            title={c.approved ? 'Hide comment' : 'Approve comment'}
                            className={`p-1.5 rounded transition-colors ${c.approved ? 'text-green-500 hover:bg-red-50 hover:text-red-500' : 'text-gray-400 hover:bg-green-50 hover:text-green-600'}`}
                          >
                            {c.approved ? <XCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
                          </button>
                          <button
                            onClick={() => deleteComment(c._id)}
                            className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Comments pagination */}
          {commentPages > 1 && (
            <div className="flex justify-center gap-2 mt-6">
              <button
                disabled={commentPage <= 1}
                onClick={() => setCommentPage(p => p - 1)}
                className="p-2 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="flex items-center text-sm text-gray-600 px-3">Page {commentPage} of {commentPages}</span>
              <button
                disabled={commentPage >= commentPages}
                onClick={() => setCommentPage(p => p + 1)}
                className="p-2 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}

      {/* Pagination */}
      {pagination.pages > 1 && tab !== 'comments' && (
        <div className="flex justify-center gap-2 mt-6">
          <button
            disabled={pagination.page <= 1}
            onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
            className="p-2 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="flex items-center text-sm text-gray-600 px-3">Page {pagination.page} of {pagination.pages}</span>
          <button
            disabled={pagination.page >= pagination.pages}
            onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
            className="p-2 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Blog Post Form Modal */}
      {showPostForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl my-8">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold">{editingPost ? 'Edit Post' : 'New Post'}</h2>
            </div>
            <form onSubmit={savePost} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-sm font-medium text-gray-700 block mb-1">Title *</label>
                  <input
                    required
                    value={postForm.title}
                    onChange={e => setPostForm(f => ({ ...f, title: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Status</label>
                  <select
                    value={postForm.status}
                    onChange={e => setPostForm(f => ({ ...f, status: e.target.value as 'draft' | 'published' }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  >
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Category</label>
                  <input
                    value={postForm.category}
                    onChange={e => setPostForm(f => ({ ...f, category: e.target.value }))}
                    placeholder="e.g. Maintenance Tips"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Author</label>
                  <input
                    value={postForm.author}
                    onChange={e => setPostForm(f => ({ ...f, author: e.target.value }))}
                    placeholder="Autobacs Team"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2 self-end pb-2">
                  <input
                    type="checkbox"
                    id="featured"
                    checked={postForm.featured}
                    onChange={e => setPostForm(f => ({ ...f, featured: e.target.checked }))}
                    className="w-4 h-4 accent-red-600"
                  />
                  <label htmlFor="featured" className="text-sm font-medium text-gray-700">Featured post</label>
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium text-gray-700 block mb-1">Cover Image URL</label>
                  <input
                    value={postForm.coverImage}
                    onChange={e => setPostForm(f => ({ ...f, coverImage: e.target.value }))}
                    placeholder="https://..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium text-gray-700 block mb-1">Excerpt (max 500 chars)</label>
                  <textarea
                    value={postForm.excerpt}
                    onChange={e => setPostForm(f => ({ ...f, excerpt: e.target.value }))}
                    rows={2}
                    maxLength={500}
                    placeholder="Short summary..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium text-gray-700 block mb-1">Content * (HTML supported)</label>
                  <textarea
                    required
                    value={postForm.content}
                    onChange={e => setPostForm(f => ({ ...f, content: e.target.value }))}
                    rows={10}
                    placeholder="<p>Post content here...</p>"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none resize-y"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium text-gray-700 block mb-1">Tags (comma-separated)</label>
                  <input
                    value={postForm.tags}
                    onChange={e => setPostForm(f => ({ ...f, tags: e.target.value }))}
                    placeholder="cars, tips, products"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
              </div>

              <SeoPanel
                value={postSeo}
                onChange={setPostSeo}
                defaults={{ title: postForm.title, description: postForm.excerpt }}
              />

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => { setShowPostForm(false); setEditingPost(null); }} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={postSaving} className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60">
                  {postSaving ? 'Saving...' : editingPost ? 'Update Post' : 'Create Post'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Media Item Form Modal */}
      {showMediaForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold">{editingMedia ? 'Edit Media Item' : `Add ${mediaForm.type === 'image' ? 'Image' : 'Video'}`}</h2>
            </div>
            <form onSubmit={saveMedia} className="p-6 space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Title *</label>
                <input
                  required
                  value={mediaForm.title}
                  onChange={e => setMediaForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">URL * {mediaForm.type === 'video' && '(YouTube, Vimeo or direct link)'}</label>
                <input
                  required
                  value={mediaForm.url}
                  onChange={e => setMediaForm(f => ({ ...f, url: e.target.value }))}
                  placeholder={mediaForm.type === 'video' ? 'https://www.youtube.com/watch?v=...' : 'https://...'}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                />
              </div>
              {mediaForm.type === 'image' && (
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Thumbnail URL (optional, defaults to URL)</label>
                  <input
                    value={mediaForm.thumbnail}
                    onChange={e => setMediaForm(f => ({ ...f, thumbnail: e.target.value }))}
                    placeholder="https://..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">{mediaForm.type === 'image' ? 'Album' : 'Category'}</label>
                  <input
                    value={mediaForm.type === 'image' ? mediaForm.album : mediaForm.category}
                    onChange={e => setMediaForm(f => ({ ...f, [mediaForm.type === 'image' ? 'album' : 'category']: e.target.value }))}
                    placeholder={mediaForm.type === 'image' ? 'Events, Products...' : 'Tutorials, Promos...'}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
                {mediaForm.type === 'video' && (
                  <div>
                    <label className="text-sm font-medium text-gray-700 block mb-1">Duration</label>
                    <input
                      value={mediaForm.duration}
                      onChange={e => setMediaForm(f => ({ ...f, duration: e.target.value }))}
                      placeholder="3:45"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                    />
                  </div>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Description</label>
                <textarea
                  value={mediaForm.description}
                  onChange={e => setMediaForm(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Tags (comma-separated)</label>
                <input
                  value={mediaForm.tags}
                  onChange={e => setMediaForm(f => ({ ...f, tags: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="mfeatured"
                  checked={mediaForm.featured}
                  onChange={e => setMediaForm(f => ({ ...f, featured: e.target.checked }))}
                  className="w-4 h-4 accent-red-600"
                />
                <label htmlFor="mfeatured" className="text-sm text-gray-700">Featured</label>
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
                <button type="button" onClick={() => { setShowMediaForm(false); setEditingMedia(null); }} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={mediaSaving} className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60">
                  {mediaSaving ? 'Saving...' : editingMedia ? 'Update' : 'Add'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
