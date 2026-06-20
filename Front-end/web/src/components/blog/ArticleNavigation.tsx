'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface AdjacentArticle {
  title: string;
  slug: string;
  coverImage?: string;
}

interface Props {
  slug: string;
  type: 'news' | 'blog';
}

const TYPE_ROUTE: Record<string, string> = { blog: 'blogs', news: 'news' };

export default function ArticleNavigation({ slug, type }: Props) {
  const [prev, setPrev] = useState<AdjacentArticle | null>(null);
  const [next, setNext] = useState<AdjacentArticle | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/media/articles/${slug}/adjacent`)
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setPrev(data.prev);
          setNext(data.next);
        }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, [slug]);

  if (!ready || (!prev && !next)) return null;

  const route = TYPE_ROUTE[type] ?? type;

  return (
    <nav aria-label="Article navigation" className="mt-6 grid grid-cols-2 gap-3">
      {prev ? (
        <Link
          href={`/media/${route}/${prev.slug}`}
          className="group bg-white rounded-xl border border-gray-200 p-4 hover:border-red-200 hover:shadow-sm transition-all flex flex-col"
        >
          <span className="flex items-center gap-1 text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">
            <ChevronLeft className="h-3.5 w-3.5" />
            Previous
          </span>
          <span className="text-sm font-semibold text-gray-800 group-hover:text-red-600 transition-colors line-clamp-2 leading-snug">
            {prev.title}
          </span>
        </Link>
      ) : (
        <div />
      )}

      {next ? (
        <Link
          href={`/media/${route}/${next.slug}`}
          className="group bg-white rounded-xl border border-gray-200 p-4 hover:border-red-200 hover:shadow-sm transition-all flex flex-col items-end text-right"
        >
          <span className="flex items-center gap-1 text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
          <span className="text-sm font-semibold text-gray-800 group-hover:text-red-600 transition-colors line-clamp-2 leading-snug">
            {next.title}
          </span>
        </Link>
      ) : (
        <div />
      )}
    </nav>
  );
}
