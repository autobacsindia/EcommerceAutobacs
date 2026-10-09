'use client';

import Link from 'next/link';
import { Pagination as PaginationType } from '@/lib/types';
import { getPageNumbers } from '@/lib/pagination';

interface PaginationProps {
  pagination: PaginationType;
  currentPage: number;
  basePath: string;
  searchParams?: URLSearchParams;
}

export default function Pagination({ pagination, currentPage, basePath, searchParams }: PaginationProps) {
  const totalPages = pagination && 'pages' in pagination ? pagination.pages : 0;
  const totalItems = pagination && 'total' in pagination ? pagination.total : 0;

  if (!totalPages || totalPages <= 1) return null;

  const createPageUrl = (page: number) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('page', page.toString());
    return `${basePath}?${params.toString()}`;
  };

  const pageNumbers = getPageNumbers(currentPage, totalPages);

  const btnBase = 'min-w-[40px] px-3 py-2 rounded-lg border transition-colors font-semibold text-sm text-center';
  const btnActive = `${btnBase} bg-gold text-white border-gold`;
  const btnInactive = `${btnBase} bg-white text-ink hover:border-gold hover:text-gold border-hairline`;
  const btnDisabled = `${btnBase} bg-white text-ink-muted/50 border-hairline cursor-not-allowed`;

  return (
    <div className="mt-8 flex flex-col items-center gap-4">
      <div className="text-sm text-ink-muted font-display">
        Page {currentPage} of {totalPages}{totalItems ? ` · ${totalItems} total items` : ''}
      </div>

      <div className="flex items-center gap-2">
        {currentPage > 1 ? (
          <Link href={createPageUrl(currentPage - 1)} className={btnInactive} aria-label="Previous page">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
        ) : (
          <button disabled className={btnDisabled} aria-label="Previous page">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        {pageNumbers.map((page, index) =>
          typeof page === 'string' ? (
            <span key={`dots-${index}`} className="px-3 py-2 text-ink-muted font-display">{page}</span>
          ) : (
            <Link
              key={page}
              href={createPageUrl(page as number)}
              className={page === currentPage ? btnActive : btnInactive}
              aria-current={page === currentPage ? 'page' : undefined}
            >
              {page}
            </Link>
          )
        )}

        {currentPage < totalPages ? (
          <Link href={createPageUrl(currentPage + 1)} className={btnInactive} aria-label="Next page">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        ) : (
          <button disabled className={btnDisabled} aria-label="Next page">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
