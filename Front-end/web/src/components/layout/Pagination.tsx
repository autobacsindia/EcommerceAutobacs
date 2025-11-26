'use client';

import Link from 'next/link';
import { Pagination as PaginationType } from '@/lib/types';

interface PaginationProps {
  pagination: PaginationType;
  currentPage: number;
  basePath: string;
  searchParams?: URLSearchParams;
}

export default function Pagination({ 
  pagination, 
  currentPage, 
  basePath,
  searchParams 
}: PaginationProps) {
  // Safely access pagination properties
  const totalPages = pagination && 'pages' in pagination ? pagination.pages : 0;
  const totalItems = pagination && 'total' in pagination ? pagination.total : 0;
  
  // If there's only one page or no pages, don't show pagination
  if (!totalPages || totalPages <= 1) {
    return null;
  }

  // Create array of page numbers to display
  const getPageNumbers = () => {
    const delta = 2; // Number of pages to show around current page
    const range = [];
    const rangeWithDots = [];

    // Always include first page
    range.push(1);

    // Add pages around current page
    for (let i = Math.max(2, currentPage - delta); i <= Math.min(totalPages - 1, currentPage + delta); i++) {
      range.push(i);
    }

    // Always include last page
    if (totalPages > 1) {
      range.push(totalPages);
    }

    // Add dots where needed
    let lastPage = 0;
    for (const page of range) {
      if (page - lastPage === 2) {
        // Add single page
        rangeWithDots.push(lastPage + 1);
      } else if (page - lastPage !== 1) {
        // Add dots
        rangeWithDots.push('...');
      }
      rangeWithDots.push(page);
      lastPage = page;
    }

    return rangeWithDots;
  };

  const pageNumbers = getPageNumbers();

  // Create URL for a specific page
  const createPageUrl = (page: number) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('page', page.toString());
    return `${basePath}?${params.toString()}`;
  };

  return (
    <div className="mt-8 flex flex-col items-center gap-4">
      <div className="text-sm text-gray-600">
        Showing page {currentPage} of {totalPages}
        {totalItems && ` (${totalItems} total items)`}
      </div>
      
      <div className="flex items-center gap-2">
        {/* Previous button */}
        {currentPage > 1 ? (
          <Link
            href={createPageUrl(currentPage - 1)}
            className="px-3 py-2 rounded-md bg-white text-gray-700 hover:bg-gray-100 border border-gray-300"
            aria-label="Previous page"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
        ) : (
          <button
            disabled
            className="px-3 py-2 rounded-md bg-gray-100 text-gray-400 border border-gray-300 cursor-not-allowed"
            aria-label="Previous page"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        {/* Page numbers */}
        {pageNumbers.map((page, index) => {
          if (page === '...') {
            return (
              <span 
                key={`dots-${index}`} 
                className="px-3 py-2 text-gray-400"
              >
                ...
              </span>
            );
          }

          return (
            <Link
              key={page}
              href={createPageUrl(page as number)}
              className={`px-4 py-2 rounded-md border ${
                page === currentPage
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 hover:bg-gray-100 border-gray-300'
              }`}
              aria-current={page === currentPage ? 'page' : undefined}
            >
              {page}
            </Link>
          );
        })}

        {/* Next button */}
        {currentPage < totalPages ? (
          <Link
            href={createPageUrl(currentPage + 1)}
            className="px-3 py-2 rounded-md bg-white text-gray-700 hover:bg-gray-100 border border-gray-300"
            aria-label="Next page"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        ) : (
          <button
            disabled
            className="px-3 py-2 rounded-md bg-gray-100 text-gray-400 border border-gray-300 cursor-not-allowed"
            aria-label="Next page"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}