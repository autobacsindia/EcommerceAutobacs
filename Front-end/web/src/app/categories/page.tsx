'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import apiClient from '@/lib/api';
import OrganizedCategoryGrid from '@/components/categories/OrganizedCategoryGrid';
import { Category } from '@/lib/types';
import Eyebrow from '@/components/ui/Eyebrow';
import Reveal from '@/components/ui/Reveal';

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        setLoading(true);
        const response = await apiClient.get('/categories') as { data?: Category[]; categories?: Category[] };
        setCategories(response.data || response.categories || []);
      } catch (err) {
        console.error('Failed to fetch categories:', err);
        setError('Failed to load categories. Please try again later.');
      } finally {
        setLoading(false);
      }
    };
    fetchCategories();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-obsidian-deep py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-1">Browse</p>
            <h1 className="text-3xl font-display font-light text-ink tracking-[-0.01em] mb-4">Product Categories</h1>
            <p className="text-ink-muted font-display">Loading categories...</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {[...Array(6)].map((_, index) => (
              <div key={index} className="bg-obsidian border border-hairline rounded-sm overflow-hidden animate-pulse">
                <div className="h-48 bg-obsidian-raised" />
                <div className="p-6">
                  <div className="h-5 bg-obsidian-raised rounded-sm mb-3" />
                  <div className="h-4 bg-obsidian-raised rounded-sm w-3/4" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-obsidian-deep py-12 flex items-center justify-center">
        <div className="bg-red-500/10 border border-red-500/30 rounded-sm p-8 max-w-md mx-4 text-center">
          <svg className="w-14 h-14 mx-auto text-red-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h2 className="text-xl font-display font-light text-ink tracking-[-0.01em] mb-2">Error Loading Categories</h2>
          <p className="text-ink/70 font-display mb-6">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-gold text-obsidian font-display text-[10px] font-semibold uppercase tracking-[0.2em] px-6 py-3 transition-opacity hover:opacity-90"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-obsidian-deep">
      {/* Hero */}
      <div className="bg-obsidian border-b border-hairline px-5 py-16 sm:px-8">
        <Reveal className="mx-auto max-w-[1400px] text-center">
          <Eyebrow>Browse</Eyebrow>
          <h1 className="mx-auto mt-4 max-w-3xl text-[clamp(38px,6vw,72px)] font-light leading-[0.95] tracking-[-0.01em] text-ink">
            Product <em className="font-light not-italic text-gold">Categories</em>
          </h1>
          <p className="mx-auto mt-5 max-w-xl font-display text-[14px] font-light leading-relaxed text-ink-muted">
            Browse our collection of automotive products, organised by category.
          </p>
        </Reveal>
      </div>

      {/* Categories Grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {categories.length === 0 ? (
          <div className="text-center py-12">
            <h2 className="text-2xl font-display font-light text-ink tracking-[-0.01em] mb-4">No Categories Found</h2>
            <p className="text-ink/70 font-display mb-6">There are currently no categories available.</p>
            <Link href="/products" className="text-gold hover:text-ink font-display font-bold uppercase tracking-widest transition-colors">
              Browse All Products
            </Link>
          </div>
        ) : (
          <OrganizedCategoryGrid categories={categories} />
        )}
      </div>
    </div>
  );
}
