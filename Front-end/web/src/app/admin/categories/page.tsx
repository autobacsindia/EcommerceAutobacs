'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Edit, Trash2, FolderOpen, Package, Star, ChevronRight } from 'lucide-react';
import apiClient from '@/lib/api';

// Define the Category interface inline to avoid import issues
interface Category {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  parent?: any;
  image?: {
    url: string;
    alt?: string;
  };
  isActive: boolean;
  isFeatured?: boolean;
  order: number;
  productCount?: number;       // products tagged directly with this category
  totalProductCount?: number;  // products in this category and all its subcategories
  createdAt?: string;
  updatedAt?: string;
}

// The admin taxonomy is a two-level tree (hub → subcategory). This screen lists
// ONLY hubs (top-level categories); a hub's subcategories are managed on its own
// detail page (/admin/categories/[hubId]). "Add Category" here creates a new hub.
export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      setLoading(true);
      // Admin endpoint returns ALL categories (including inactive) so the
      // active/inactive state is manageable here; the public list filters them out.
      const response = await apiClient.get('/categories/admin/all') as { data?: Category[]; categories?: Category[] };
      setCategories(response.data || response.categories || []);
    } catch (err) {
      console.error('Failed to fetch categories:', err);
      setError('Failed to load categories. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this category?')) {
      return;
    }

    try {
      await apiClient.delete(`/categories/${id}`);
      // Refresh the list
      fetchCategories();
    } catch (err: any) {
      console.error('Failed to delete category:', err);
      // Surface backend integrity errors (e.g. category still has subcategories/products).
      alert(err?.message || 'Failed to delete category. Please try again.');
    }
  };

  // One-click featured toggle. Updates the row in place from the response so the
  // whole list doesn't refetch on every star click.
  const handleToggleFeature = async (id: string) => {
    try {
      const res = await apiClient.patch(`/categories/${id}/feature`) as { isFeatured?: boolean };
      setCategories(prev =>
        prev.map(c => (c._id === id ? { ...c, isFeatured: res.isFeatured ?? !c.isFeatured } : c))
      );
    } catch (err: any) {
      console.error('Failed to toggle featured:', err);
      alert(err?.message || 'Failed to update featured status. Please try again.');
    }
  };

  // parent may be a populated object or an id string.
  const parentIdOf = (c: Category): string | null => {
    const p = c.parent;
    if (!p) return null;
    return typeof p === 'object' ? (p._id ?? null) : p;
  };

  const byOrderThenName = (a: Category, b: Category) =>
    (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name);

  // Only top-level hubs are listed here; count each hub's subcategories for the badge.
  const hubs = categories.filter(c => !parentIdOf(c)).sort(byOrderThenName);
  const subCountByHub = new Map<string, number>();
  for (const c of categories) {
    const pid = parentIdOf(c);
    if (pid) subCountByHub.set(pid, (subCountByHub.get(pid) ?? 0) + 1);
  }

  const renderHub = (category: Category) => {
    const kidCount = subCountByHub.get(category._id) ?? 0;
    return (
      <div key={category._id} className="p-4 hover:bg-gray-50">
        <div className="flex items-center justify-between">
          {/* The info block navigates into the hub's subcategory detail page. */}
          <Link
            href={`/admin/categories/${category._id}`}
            className="flex items-center flex-1 min-w-0 group"
            title="Open subcategories"
          >
            {category.image?.url ? (
              <img
                src={category.image.url}
                alt={category.image.alt || category.name}
                className="h-10 w-10 rounded-md object-cover mr-3"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div className="h-10 w-10 rounded-md bg-gray-200 flex items-center justify-center mr-3">
                <FolderOpen className="h-5 w-5 text-gray-500" />
              </div>
            )}
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-gray-900 group-hover:text-blue-600">
                {category.name}
                <span className="ml-2 text-xs font-normal text-gray-400">
                  {kidCount} subcategor{kidCount === 1 ? 'y' : 'ies'}
                </span>
              </h3>
              {category.description && (
                <p className="text-gray-500 text-sm mt-1 truncate">{category.description}</p>
              )}
              <div className="flex items-center mt-1 flex-wrap gap-y-1">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${category.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                  {category.isActive ? 'Active' : 'Inactive'}
                </span>
                {category.isFeatured && (
                  <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                    <Star className="h-3 w-3 fill-current" /> Featured
                  </span>
                )}
                <span
                  className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700"
                  title={(category.totalProductCount ?? 0) !== (category.productCount ?? 0)
                    ? `${category.productCount ?? 0} directly, ${category.totalProductCount ?? 0} including subcategories`
                    : 'Products in this category'}
                >
                  {category.totalProductCount ?? category.productCount ?? 0} product{(category.totalProductCount ?? category.productCount ?? 0) === 1 ? '' : 's'}
                </span>
                <span className="ml-2 text-xs text-gray-400">Order: {category.order}</span>
              </div>
            </div>
          </Link>
          <div className="flex items-center space-x-2 flex-shrink-0">
            <button
              onClick={() => handleToggleFeature(category._id)}
              className={`p-2 ${category.isFeatured ? 'text-amber-500 hover:text-amber-600' : 'text-gray-400 hover:text-amber-500'}`}
              title={category.isFeatured ? 'Unfeature from homepage carousel' : 'Feature on homepage carousel'}
            >
              <Star className={`h-5 w-5 ${category.isFeatured ? 'fill-current' : ''}`} />
            </button>
            <Link
              href={`/admin/products?category=${category._id}&categoryName=${encodeURIComponent(category.name)}`}
              className="p-2 text-gray-500 hover:text-blue-600"
              title="View products in this category"
            >
              <Package className="h-5 w-5" />
            </Link>
            <Link href={`/admin/categories/edit/${category._id}`} className="p-2 text-gray-500 hover:text-gray-700" title="Edit hub">
              <Edit className="h-5 w-5" />
            </Link>
            <button onClick={() => handleDelete(category._id)} className="p-2 text-gray-500 hover:text-red-600" title="Delete">
              <Trash2 className="h-5 w-5" />
            </button>
            <Link
              href={`/admin/categories/${category._id}`}
              className="p-2 text-gray-400 hover:text-gray-700"
              title="Open subcategories"
            >
              <ChevronRight className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Categories</h1>
          <div className="h-10 w-32 bg-gray-200 rounded animate-pulse"></div>
        </div>

        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="divide-y divide-gray-200">
            {[...Array(5)].map((_, index) => (
              <div key={index} className="p-4 animate-pulse">
                <div className="flex items-center justify-between">
                  <div className="h-6 w-1/4 bg-gray-200 rounded"></div>
                  <div className="flex space-x-2">
                    <div className="h-8 w-8 bg-gray-200 rounded"></div>
                    <div className="h-8 w-8 bg-gray-200 rounded"></div>
                    <div className="h-8 w-8 bg-gray-200 rounded"></div>
                  </div>
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
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Categories</h1>
          <Link
            href="/admin/categories/create"
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center"
          >
            <Plus className="h-5 w-5 mr-2" />
            Add Category
          </Link>
        </div>

        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">{error}</p>
          <button
            onClick={fetchCategories}
            className="mt-2 bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-2xl font-bold text-gray-900">Categories</h1>
        <Link
          href="/admin/categories/create"
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center"
        >
          <Plus className="h-5 w-5 mr-2" />
          Add Category
        </Link>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Top-level categories (hubs). Click a hub to manage its subcategories.
      </p>

      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        {hubs.length === 0 ? (
          <div className="p-8 text-center">
            <FolderOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No categories found</h3>
            <p className="text-gray-500 mb-4">Get started by creating a new category.</p>
            <Link
              href="/admin/categories/create"
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
            >
              Create Category
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {hubs.map((category) => renderHub(category))}
          </div>
        )}
      </div>
    </div>
  );
}
