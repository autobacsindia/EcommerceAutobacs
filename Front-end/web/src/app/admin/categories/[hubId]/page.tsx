'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Plus, Edit, Trash2, FolderOpen, Package, Star } from 'lucide-react';
import apiClient from '@/lib/api';

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
  productCount?: number;
  totalProductCount?: number;
}

// Detail view for a single hub: shows the hub header and manages ONLY its direct
// subcategories. Reached by clicking a hub on /admin/categories. "Add Subcategory"
// pre-parents the new category to this hub.
export default function HubDetailPage() {
  const params = useParams();
  const hubId = params.hubId as string;

  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get('/categories/admin/all') as { data?: Category[]; categories?: Category[] };
      setCategories(response.data || response.categories || []);
    } catch (err) {
      console.error('Failed to fetch categories:', err);
      setError('Failed to load subcategories. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this subcategory?')) {
      return;
    }
    try {
      await apiClient.delete(`/categories/${id}`);
      fetchCategories();
    } catch (err: any) {
      console.error('Failed to delete category:', err);
      alert(err?.message || 'Failed to delete subcategory. Please try again.');
    }
  };

  const parentIdOf = (c: Category): string | null => {
    const p = c.parent;
    if (!p) return null;
    return typeof p === 'object' ? (p._id ?? null) : p;
  };
  const byOrderThenName = (a: Category, b: Category) =>
    (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name);

  const hub = categories.find(c => c._id === hubId) || null;
  const subcategories = categories
    .filter(c => parentIdOf(c) === hubId)
    .sort(byOrderThenName);

  if (loading) {
    return (
      <div className="p-6">
        <div className="h-6 w-40 bg-gray-200 rounded animate-pulse mb-4" />
        <div className="h-8 w-64 bg-gray-200 rounded animate-pulse mb-6" />
        <div className="bg-white rounded-lg shadow-md divide-y divide-gray-200">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="p-4 animate-pulse flex items-center justify-between">
              <div className="h-6 w-1/4 bg-gray-200 rounded" />
              <div className="flex space-x-2">
                <div className="h-8 w-8 bg-gray-200 rounded" />
                <div className="h-8 w-8 bg-gray-200 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !hub) {
    return (
      <div className="p-6">
        <Link href="/admin/categories" className="flex items-center text-gray-600 hover:text-gray-900 mb-4">
          <ArrowLeft className="h-5 w-5 mr-2" />
          Back to Categories
        </Link>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">{error || 'Hub not found.'}</p>
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

  // Guard: if someone lands here for a non-top-level category, redirect them mentally
  // by explaining. (A subcategory shouldn't have its own detail page in a 2-level tree.)
  const hubParent = parentIdOf(hub);

  return (
    <div className="p-6">
      <Link href="/admin/categories" className="flex items-center text-gray-600 hover:text-gray-900 mb-4">
        <ArrowLeft className="h-5 w-5 mr-2" />
        Back to Categories
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center min-w-0">
          {hub.image?.url ? (
            <img
              src={hub.image.url}
              alt={hub.image.alt || hub.name}
              className="h-12 w-12 rounded-md object-cover mr-4"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div className="h-12 w-12 rounded-md bg-gray-200 flex items-center justify-center mr-4">
              <FolderOpen className="h-6 w-6 text-gray-500" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900">{hub.name}</h1>
              <span className="text-xs font-medium text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">Hub</span>
              {hub.isFeatured && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                  <Star className="h-3 w-3 fill-current" /> Featured
                </span>
              )}
              {!hub.isActive && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Inactive</span>
              )}
            </div>
            {hub.description && <p className="text-gray-500 text-sm mt-1">{hub.description}</p>}
            {hubParent && (
              <p className="text-amber-600 text-xs mt-1">
                Note: this category has a parent, so it isn't a top-level hub.
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            href={`/admin/categories/edit/${hub._id}`}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 flex items-center"
          >
            <Edit className="h-4 w-4 mr-2" />
            Edit hub
          </Link>
          <Link
            href={`/admin/categories/create?parent=${hub._id}`}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center"
          >
            <Plus className="h-5 w-5 mr-2" />
            Add Subcategory
          </Link>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        {subcategories.length === 0 ? (
          <div className="p-8 text-center">
            <FolderOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No subcategories yet</h3>
            <p className="text-gray-500 mb-4">Add a subcategory under &ldquo;{hub.name}&rdquo;.</p>
            <Link
              href={`/admin/categories/create?parent=${hub._id}`}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
            >
              Add Subcategory
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {subcategories.map((sub) => (
              <div key={sub._id} className="p-4 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center min-w-0">
                    {sub.image?.url ? (
                      <img
                        src={sub.image.url}
                        alt={sub.image.alt || sub.name}
                        className="h-10 w-10 rounded-md object-cover mr-3"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div className="h-10 w-10 rounded-md bg-gray-200 flex items-center justify-center mr-3">
                        <FolderOpen className="h-5 w-5 text-gray-500" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium text-gray-800">{sub.name}</h3>
                      {sub.description && <p className="text-gray-500 text-sm mt-1 truncate">{sub.description}</p>}
                      <div className="flex items-center mt-1 flex-wrap gap-y-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${sub.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                          {sub.isActive ? 'Active' : 'Inactive'}
                        </span>
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                          {sub.totalProductCount ?? sub.productCount ?? 0} product{(sub.totalProductCount ?? sub.productCount ?? 0) === 1 ? '' : 's'}
                        </span>
                        <span className="ml-2 text-xs text-gray-400">Order: {sub.order}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 flex-shrink-0">
                    <Link
                      href={`/admin/products?category=${sub._id}&categoryName=${encodeURIComponent(sub.name)}`}
                      className="p-2 text-gray-500 hover:text-blue-600"
                      title="View products in this subcategory"
                    >
                      <Package className="h-5 w-5" />
                    </Link>
                    <Link href={`/admin/categories/edit/${sub._id}`} className="p-2 text-gray-500 hover:text-gray-700" title="Edit">
                      <Edit className="h-5 w-5" />
                    </Link>
                    <button onClick={() => handleDelete(sub._id)} className="p-2 text-gray-500 hover:text-red-600" title="Delete">
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
