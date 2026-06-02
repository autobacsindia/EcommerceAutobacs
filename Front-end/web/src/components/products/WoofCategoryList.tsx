'use client';

import { useState, useEffect } from 'react';
import apiClient from '@/lib/api';

interface Category {
  _id: string;
  name: string;
  slug: string;
  parent?: string | null;
  children?: Category[];
}

interface WoofCategoryListProps {
  selectedCategories: string[];
  onCategoryChange: (selected: string[]) => void;
}

export default function WoofCategoryList({ selectedCategories, onCategoryChange }: WoofCategoryListProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  useEffect(() => {
    const controller = new AbortController();

    const fetchCategories = async () => {
      try {
        setLoading(true);
        const response = await apiClient.get('/categories', { signal: controller.signal });
        const allCategories = (response as any).data || (response as any).categories || [];

        const topLevel = allCategories.filter((cat: Category) => !cat.parent);
        const subCategories = allCategories.filter((cat: Category) => cat.parent);

        const categoriesWithChildren = topLevel.map((cat: Category) => ({
          ...cat,
          children: subCategories.filter((sub: Category) => sub.parent === cat._id),
        }));

        setCategories(categoriesWithChildren);
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.error('Failed to fetch categories:', err);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    fetchCategories();
    return () => controller.abort();
  }, []);

  const toggleExpand = (categoryId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const handleCategoryToggle = (categoryId: string) => {
    const newSelected = selectedCategories.includes(categoryId)
      ? selectedCategories.filter(id => id !== categoryId)
      : [...selectedCategories, categoryId];
    onCategoryChange(newSelected);
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-2 animate-pulse">
            <div className="h-4 w-4 bg-gray-200 rounded" />
            <div className="h-4 w-3/4 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (categories.length === 0) {
    return <p className="text-sm text-gray-500">No categories available</p>;
  }

  const renderCategory = (category: Category, level = 0) => {
    const hasChildren = category.children && category.children.length > 0;
    const isExpanded = expandedCategories.has(category._id);
    const isChecked = selectedCategories.includes(category._id);

    return (
      <li key={category._id} className={level > 0 ? 'ml-4' : ''}>
        <div className="flex items-center gap-2 py-1">
          <input
            type="checkbox"
            id={`cat-${category._id}`}
            checked={isChecked}
            onChange={() => handleCategoryToggle(category._id)}
            className="h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
          />
          <label
            htmlFor={`cat-${category._id}`}
            className="flex-1 text-sm text-gray-700 cursor-pointer select-none"
          >
            {category.name}
          </label>
          {hasChildren && (
            <button
              type="button"
              onClick={() => toggleExpand(category._id)}
              className="w-5 h-5 flex items-center justify-center text-gray-500 hover:text-gray-800 text-xs font-bold shrink-0"
              aria-label={isExpanded ? `Collapse ${category.name}` : `Expand ${category.name}`}
            >
              {isExpanded ? '−' : '+'}
            </button>
          )}
        </div>

        {hasChildren && isExpanded && (
          <ul className="mt-1 space-y-0.5">
            {category.children!.map(child => renderCategory(child, level + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="max-h-60 overflow-y-auto">
      <ul className="space-y-0.5">
        {categories.map(cat => renderCategory(cat))}
      </ul>
    </div>
  );
}
