'use client';

import Link from 'next/link';
import { Pagination as PaginationType } from '@/lib/types';

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

  const getPageNumbers = () => {
    const delta = 2;
    const range: number[] = [1];
    for (let i = Math.max(2, currentPage - delta); i <= Math.min(totalPages - 1, currentPage + delta); i++) {
      range.push(i);
    }
    if (totalPages > 1) range.push(totalPages);

    const rangeWithDots: (number | string)[] = [];
    let lastPage = 0;
    for (const page of range) {
      if (page - lastPage === 2) rangeWithDots.push(lastPage + 1);
      else if (page - lastPage !== 1) rangeWithDots.push('...');
      rangeWithDots.push(page);
      lastPage = page;
    }
    return rangeWithDots;
  };

  const createPageUrl = (page: number) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('page', page.toString());
    return `${basePath}?${params.toString()}`;
  };

  const pageNumbers = getPageNumbers();

  const btnBase = 'px-3 py-2 rounded-sm border transition-colors font-condensed font-bold text-sm';
  const btnActive = `${btnBase} bg-[#3B9EE8] text-white border-[#3B9EE8]`;
  const btnInactive = `${btnBase} bg-[#161616] text-[#C4C4C4] hover:bg-[#252525] hover:text-white border-[#252525]`;
  const btnDisabled = `${btnBase} bg-[#0E0E0E] text-[#555555] border-[#252525] cursor-not-allowed`;

  return (
    <div className="mt-8 flex flex-col items-center gap-4">
      <div className="text-sm text-[#555555] font-body">
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
          page === '...' ? (
            <span key={`dots-${index}`} className="px-3 py-2 text-[#555555] font-body">...</span>
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
