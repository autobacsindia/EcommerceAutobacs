'use client';

import { useState, useMemo } from 'react';
import DOMPurify from 'isomorphic-dompurify';
import Link from 'next/link';
import { ArrowLeft, Calendar, Eye, Tag, User, Newspaper, BookOpen, Flame } from 'lucide-react';

interface Article {
  _id: string;
  title: string;
  slug: string;
  type: 'news' | 'blog';
  coverImage: string;
  excerpt: string;
  content: string;
  category: string;
  tags: string[];
  author: string;
  views: number;
  publishedAt: string;
  featured: boolean;
  createdAt?: string;
}

interface Props {
  article: Article;
  related: Article[];
  type: string;
}

// Social share URLs
function shareLinks(url: string, title: string) {
  const encoded = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);
  return {
    whatsapp: `https://wa.me/?text=${encodedTitle}%20${encoded}`,
    twitter: `https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encoded}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encoded}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encoded}`,
  };
}

function ShareBar({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);

  function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const url = typeof window !== 'undefined' ? window.location.href : '';
  const links = shareLinks(url, title);

  return (
    <div className="flex flex-wrap items-center gap-2 mt-8 pt-6 border-t border-gray-100">
      <span className="text-sm font-medium text-gray-600 mr-1">Share:</span>

      {/* WhatsApp — important in India */}
      <a
        href={links.whatsapp}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-green-500 hover:bg-green-600 text-white transition-colors"
      >
        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
        WhatsApp
      </a>

      {/* Twitter/X */}
      <a
        href={links.twitter}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-black hover:bg-gray-800 text-white transition-colors"
      >
        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
        Tweet
      </a>

      {/* LinkedIn */}
      <a
        href={links.linkedin}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white transition-colors"
      >
        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
        </svg>
        LinkedIn
      </a>

      {/* Copy link */}
      <button
        onClick={copyLink}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
      >
        {copied ? (
          <>✓ Copied!</>
        ) : (
          <>
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Copy Link
          </>
        )}
      </button>
    </div>
  );
}

export default function ArticleDetailClient({ article, related, type }: Props) {
  const backHref = `/media/${article.type}`;
  const backLabel = article.type === 'news' ? 'Back to News' : 'Back to Blog';
  const Icon = article.type === 'news' ? Newspaper : BookOpen;

  // Sanitize HTML content to prevent XSS before rendering
  const safeContent = useMemo(
    () => DOMPurify.sanitize(article.content ?? ''),
    [article.content]
  );
  const colorBadge = article.type === 'news' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Main content */}
        <main className="flex-1 min-w-0">
          <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-6 transition-colors">
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </Link>

          <article className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {article.coverImage && (
              <img
                src={article.coverImage}
                alt={article.title}
                className="w-full h-72 md:h-96 object-cover"
              />
            )}

            <div className="p-6 md:p-8">
              {/* Badges */}
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${colorBadge}`}>
                  <Icon className="h-3 w-3 inline mr-1" />
                  {article.type === 'news' ? 'News' : 'Blog'}
                </span>
                <span className="text-xs text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">{article.category}</span>
                {article.featured && (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">⭐ Featured</span>
                )}
              </div>

              <h1 className="text-2xl md:text-3xl font-bold text-gray-900 leading-snug mb-4">{article.title}</h1>

              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 border-b border-gray-100 pb-5 mb-6">
                <span className="flex items-center gap-1.5"><User className="h-4 w-4" />{article.author}</span>
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />
                  {new Date(article.publishedAt || article.createdAt || Date.now()).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'long', year: 'numeric',
                  })}
                </span>
                <span className="flex items-center gap-1.5"><Eye className="h-4 w-4" />{article.views} views</span>
              </div>

              {/* Excerpt pull-quote */}
              {article.excerpt && (
                <p className="text-lg text-gray-600 font-medium mb-6 border-l-4 border-red-500 pl-4 italic">
                  {article.excerpt}
                </p>
              )}

              {/* Rich HTML content */}
              <div
                className="prose prose-gray max-w-none prose-headings:font-bold prose-a:text-red-600 prose-img:rounded-lg"
                dangerouslySetInnerHTML={{ __html: safeContent }}
              />

              {/* Tags */}
              {article.tags && article.tags.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mt-8 pt-6 border-t border-gray-100">
                  <Tag className="h-4 w-4 text-gray-400" />
                  {article.tags.map(tag => (
                    <Link
                      key={tag}
                      href={`/media/${article.type}?search=${tag}`}
                      className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2.5 py-1 rounded-full transition-colors"
                    >
                      #{tag}
                    </Link>
                  ))}
                </div>
              )}

              {/* Social share */}
              <ShareBar title={article.title} />
            </div>
          </article>
        </main>

        {/* Sidebar */}
        <aside className="w-full lg:w-80 flex-shrink-0">
          <div className="sticky top-20 space-y-6">
            {/* Related */}
            <div>
              <h3 className="font-bold text-gray-900 mb-4">Related Articles</h3>
              {related.length === 0 ? (
                <p className="text-sm text-gray-500">No related articles yet.</p>
              ) : (
                <div className="space-y-3">
                  {related.map(r => (
                    <Link
                      key={r._id}
                      href={`/media/${r.type}/${r.slug}`}
                      className="flex gap-3 group bg-white rounded-lg border border-gray-100 p-3 hover:shadow-sm hover:border-gray-200 transition-all"
                    >
                      {r.coverImage ? (
                        <img src={r.coverImage} alt={r.title} className="w-16 h-14 object-cover rounded-md flex-shrink-0" />
                      ) : (
                        <div className="w-16 h-14 bg-gray-100 rounded-md flex-shrink-0 flex items-center justify-center">
                          <Icon className="h-5 w-5 text-gray-300" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 group-hover:text-red-600 transition-colors line-clamp-2">
                          {r.title}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          {new Date(r.publishedAt || r.createdAt || Date.now()).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
