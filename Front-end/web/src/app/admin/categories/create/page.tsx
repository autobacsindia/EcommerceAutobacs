'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Upload } from 'lucide-react';
import apiClient from '@/lib/api';
import { revalidateHome } from '@/lib/revalidateHome';
import SeoPanel, { EMPTY_SEO, type SeoFormValue } from '@/components/admin/SeoPanel';

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
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

// Two creation modes, driven by the `?parent=<hubId>` query param:
//  - hub mode (no param): creates a top-level hub. No parent field.
//  - subcategory mode (param present): creates a subcategory under that hub. The
//    parent is fixed to the hub and shown read-only — you can't re-parent from here.
function CreateCategoryForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const parentId = searchParams.get('parent') || undefined;
  const isSubcategory = Boolean(parentId);

  const [parentHub, setParentHub] = useState<Category | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    description: '',
    isActive: true,
    isFeatured: false,
    order: 0,
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageAlt, setImageAlt] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seo, setSeo] = useState<SeoFormValue>(EMPTY_SEO);

  // In subcategory mode, resolve the parent hub so we can show its name and
  // validate that it's actually a top-level hub before letting the admin submit.
  useEffect(() => {
    if (!parentId) return;
    let cancelled = false;
    (async () => {
      try {
        const res: any = await apiClient.get(`/categories/${parentId}`);
        const hub: Category | undefined = res.category;
        if (cancelled) return;
        if (!hub) {
          setError('Parent hub not found. Go back and pick a hub.');
          return;
        }
        if (hub.parent) {
          setError('The selected parent is itself a subcategory. Subcategories can only live under a top-level hub.');
          return;
        }
        setParentHub(hub);
      } catch (err) {
        console.error('Failed to load parent hub:', err);
        if (!cancelled) setError('Failed to load the parent hub. Please try again.');
      }
    })();
    return () => { cancelled = true; };
  }, [parentId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = type === 'checkbox' ? (e.target as HTMLInputElement).checked : undefined;

    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Keep the real File for multipart upload; the blob URL is preview-only.
      setImagePreview(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
      setImageFile(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Basic validation
    if (!formData.name.trim()) {
      setError('Category name is required');
      return;
    }

    if (!formData.slug.trim()) {
      setError('Slug is required');
      return;
    }

    // In subcategory mode we must have a resolved, valid hub.
    if (isSubcategory && !parentHub) {
      setError('Parent hub is not ready yet. Please wait a moment and try again.');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Build multipart/form-data so the image file is actually uploaded to
      // Cloudinary by the backend (apiClient JSON-serializes, so we use raw fetch).
      const fd = new FormData();
      fd.append('name', formData.name.trim());
      fd.append('slug', formData.slug.trim());
      if (formData.description.trim()) fd.append('description', formData.description.trim());
      if (isSubcategory && parentId) fd.append('parent', parentId);
      fd.append('order', String(formData.order ?? 0));
      fd.append('isActive', String(formData.isActive));
      // Only hubs can be featured (the homepage carousel shows hubs only).
      fd.append('isFeatured', String(isSubcategory ? false : formData.isFeatured));
      fd.append('seo', JSON.stringify(seo));
      if (imageFile) {
        fd.append('image', imageFile);
        if (imageAlt.trim()) fd.append('imageAlt', imageAlt.trim());
      }

      const token = document.cookie.match(/(?:^|;\s*)token=([^;]*)/)?.[1] ?? '';
      const csrfToken = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/)?.[1] ?? '';

      const res = await fetch('/api/v1/categories', {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(csrfToken ? { 'X-XSRF-TOKEN': decodeURIComponent(csrfToken) } : {}),
        },
        credentials: 'include',
        body: fd,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Failed to create category');

      // Refresh the home page's cached categories section.
      revalidateHome('home:categories');

      // Back to where it belongs: the hub detail page for a subcategory, the hub
      // list otherwise.
      router.push(isSubcategory && parentId ? `/admin/categories/${parentId}` : '/admin/categories');
      router.refresh();
    } catch (err: any) {
      console.error('Failed to create category:', err);
      setError(err.message || 'Failed to create category. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const backHref = isSubcategory && parentId ? `/admin/categories/${parentId}` : '/admin/categories';

  return (
    <div className="p-6">
      <div className="mb-6">
        <button
          onClick={() => router.push(backHref)}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="h-5 w-5 mr-2" />
          {isSubcategory ? 'Back to hub' : 'Back to Categories'}
        </button>
        <h1 className="text-2xl font-bold text-gray-900">
          {isSubcategory ? 'Add Subcategory' : 'Create Category'}
        </h1>
        {isSubcategory && (
          <p className="text-sm text-gray-500 mt-1">
            {parentHub ? (
              <>Under hub: <span className="font-medium text-gray-700">{parentHub.name}</span></>
            ) : (
              'Loading parent hub…'
            )}
          </p>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-md p-6 max-w-2xl">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-700">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="space-y-6">
            {/* Parent context — read-only in subcategory mode, absent in hub mode. */}
            {isSubcategory && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Parent hub</label>
                <div className="w-full px-3 py-2 border border-gray-200 bg-gray-50 rounded-md text-gray-700">
                  {parentHub ? parentHub.name : 'Loading…'}
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  This subcategory belongs to the hub above. To move it later, use the hub selector on its edit screen.
                </p>
              </div>
            )}

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                Name *
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter category name"
              />
            </div>

            <div>
              <label htmlFor="slug" className="block text-sm font-medium text-gray-700 mb-1">
                Slug *
              </label>
              <input
                type="text"
                id="slug"
                name="slug"
                value={formData.slug}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter category slug (e.g., body-kits)"
              />
              <p className="mt-1 text-sm text-gray-500">
                Used in URLs. Should be lowercase with hyphens instead of spaces.
              </p>
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter category description"
              />
            </div>

            <div>
              <label htmlFor="image" className="block text-sm font-medium text-gray-700 mb-1">
                Category Image
              </label>
              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0">
                  {imagePreview ? (
                    <img
                      src={imagePreview}
                      alt="Preview"
                      className="h-16 w-16 rounded-md object-cover"
                    />
                  ) : (
                    <div className="h-16 w-16 rounded-md bg-gray-200 flex items-center justify-center">
                      <Upload className="h-6 w-6 text-gray-500" />
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <input
                    type="file"
                    id="image"
                    name="image"
                    accept="image/*"
                    onChange={handleImageChange}
                    className="block w-full text-sm text-gray-500
                      file:mr-4 file:py-2 file:px-4
                      file:rounded-md file:border-0
                      file:text-sm file:font-semibold
                      file:bg-blue-50 file:text-blue-700
                      hover:file:bg-blue-100"
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    PNG, JPG, GIF up to 5MB
                  </p>
                </div>
              </div>
            </div>

            {imagePreview && (
              <div>
                <label htmlFor="imageAlt" className="block text-sm font-medium text-gray-700 mb-1">
                  Image Alt Text
                </label>
                <input
                  type="text"
                  id="imageAlt"
                  name="imageAlt"
                  value={imageAlt}
                  onChange={(e) => setImageAlt(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter alternative text for the image"
                />
              </div>
            )}

            <div>
              <label htmlFor="order" className="block text-sm font-medium text-gray-700 mb-1">
                Order
              </label>
              <input
                type="number"
                id="order"
                name="order"
                value={formData.order}
                onChange={handleChange}
                min="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-sm text-gray-500">
                Categories will be ordered by this value (ascending).
              </p>
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="isActive"
                name="isActive"
                checked={formData.isActive}
                onChange={handleChange}
                className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="isActive" className="ml-2 block text-sm text-gray-700">
                Active
              </label>
              <p className="ml-2 text-sm text-gray-500">
                Inactive categories won't be displayed to users.
              </p>
            </div>

            {/* Featured only applies to hubs (homepage carousel shows hubs only). */}
            {!isSubcategory && (
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="isFeatured"
                  name="isFeatured"
                  checked={formData.isFeatured}
                  onChange={handleChange}
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="isFeatured" className="ml-2 block text-sm text-gray-700">
                  Featured
                </label>
                <p className="ml-2 text-sm text-gray-500">
                  Featured hubs lead the homepage categories carousel with a distinct badge.
                </p>
              </div>
            )}

            <SeoPanel
              value={seo}
              onChange={setSeo}
              defaults={{ title: formData.name, description: formData.description }}
            />

            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={() => router.push(backHref)}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                disabled={loading}
              >
                {loading ? 'Creating...' : isSubcategory ? 'Create Subcategory' : 'Create Category'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CreateCategoryPage() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<div className="p-6 text-gray-500">Loading…</div>}>
      <CreateCategoryForm />
    </Suspense>
  );
}
