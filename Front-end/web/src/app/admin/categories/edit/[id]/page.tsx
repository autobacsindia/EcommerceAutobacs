'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Upload } from 'lucide-react';
import apiClient from '@/lib/api';
import SeoPanel, { EMPTY_SEO, toSeoFormValue, type SeoFormValue } from '@/components/admin/SeoPanel';

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
  createdAt?: string;
  updatedAt?: string;
}

export default function EditCategoryPage() {
  const router = useRouter();
  const params = useParams();
  const categoryId = params.id as string;
  
  const [category, setCategory] = useState<Category | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  // Original nature of the category: a hub (top-level) has no parent selector and
  // can be featured; a subcategory gets a hub-only selector and can't be featured.
  const [isSubcategory, setIsSubcategory] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    description: '',
    parent: undefined as string | undefined,
    isActive: true,
    isFeatured: false,
    order: 0,
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageAlt, setImageAlt] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seo, setSeo] = useState<SeoFormValue>(EMPTY_SEO);

  // Fetch all categories for parent selection
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        setLoadingCategories(true);
        const response = await apiClient.get('/categories') as { data?: Category[]; categories?: Category[] };
        setCategories(response.data || response.categories || []);
      } catch (err) {
        console.error('Failed to fetch categories:', err);
      } finally {
        setLoadingCategories(false);
      }
    };

    fetchCategories();
  }, []);

  useEffect(() => {
    if (categoryId) {
      fetchCategory();
    }
  }, [categoryId]);

  const fetchCategory = async () => {
    try {
      setLoading(true);
      const response: any = await apiClient.get(`/categories/${categoryId}`);
      const categoryData = response.category;
      
      setCategory(categoryData);
      setIsSubcategory(Boolean(categoryData.parent));
      setFormData({
        name: categoryData.name || '',
        slug: categoryData.slug || '',
        description: categoryData.description || '',
        parent: categoryData.parent?._id || categoryData.parent || undefined,
        isActive: categoryData.isActive !== undefined ? categoryData.isActive : true,
        isFeatured: !!categoryData.isFeatured,
        order: categoryData.order || 0,
      });
      setSeo(toSeoFormValue(categoryData.seo));
      setImageAlt(categoryData.image?.alt || '');

      // Set image preview if there's an existing image
      if (categoryData.image?.url) {
        setImagePreview(categoryData.image.url);
      }
    } catch (err: any) {
      console.error('Failed to fetch category:', err);
      setError(err.message || 'Failed to load category. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
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

    try {
      setSaving(true);
      setError(null);

      // Multipart so a newly chosen image file reaches Cloudinary via the backend.
      const fd = new FormData();
      fd.append('name', formData.name.trim());
      fd.append('slug', formData.slug.trim());
      fd.append('description', formData.description.trim());
      // Hub stays top-level (empty parent); a subcategory keeps/moves to a hub.
      fd.append('parent', isSubcategory ? (formData.parent ?? '') : '');
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

      const res = await fetch(`/api/v1/categories/${categoryId}`, {
        method: 'PUT',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(csrfToken ? { 'X-XSRF-TOKEN': decodeURIComponent(csrfToken) } : {}),
        },
        credentials: 'include',
        body: fd,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Failed to update category');

      // Redirect to categories list
      router.push('/admin/categories');
      router.refresh();
    } catch (err: any) {
      console.error('Failed to update category:', err);
      setError(err.message || 'Failed to update category. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <div className="h-6 w-32 bg-gray-200 rounded animate-pulse mb-4"></div>
          <div className="h-8 w-48 bg-gray-200 rounded animate-pulse"></div>
        </div>
        
        <div className="bg-white rounded-lg shadow-md p-6 max-w-2xl">
          <div className="space-y-6">
            {[...Array(5)].map((_, index) => (
              <div key={index} className="animate-pulse">
                <div className="h-4 w-1/4 bg-gray-200 rounded mb-2"></div>
                <div className="h-10 w-full bg-gray-200 rounded"></div>
              </div>
            ))}
            <div className="flex justify-end space-x-3 pt-4">
              <div className="h-10 w-20 bg-gray-200 rounded"></div>
              <div className="h-10 w-32 bg-gray-200 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <button 
            onClick={() => router.back()}
            className="flex items-center text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft className="h-5 w-5 mr-2" />
            Back to Categories
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Edit Category</h1>
        </div>
        
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">{error}</p>
          <button 
            onClick={fetchCategory}
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
      <div className="mb-6">
        <button 
          onClick={() => router.back()}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="h-5 w-5 mr-2" />
          Back
        </button>
        <h1 className="text-2xl font-bold text-gray-900">
          {isSubcategory ? 'Edit Subcategory' : 'Edit Hub'}
        </h1>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6 max-w-2xl">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-700">{error}</p>
          </div>
        )}
        
        <form onSubmit={handleSubmit}>
          <div className="space-y-6">
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
            
            {/* Hubs have no parent selector — they ARE the top level. Subcategories
                get a hub-only selector so they can be moved between hubs. */}
            {isSubcategory ? (
              <div>
                <label htmlFor="parent" className="block text-sm font-medium text-gray-700 mb-1">
                  Parent hub
                </label>
                {loadingCategories ? (
                  <div className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-100 animate-pulse">
                    Loading hubs...
                  </div>
                ) : (
                  <select
                    id="parent"
                    name="parent"
                    value={formData.parent ?? ''}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {categories
                      // 2-level taxonomy: a subcategory must live under a top-level hub,
                      // and cannot be its own parent.
                      .filter(cat => cat._id !== categoryId && !cat.parent)
                      .map((hub) => (
                        <option key={hub._id} value={hub._id}>
                          {hub.name}
                        </option>
                      ))}
                  </select>
                )}
                <p className="mt-1 text-sm text-gray-500">
                  Move this subcategory to a different hub. The catalog uses a two-level
                  structure (hub → subcategory).
                </p>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Level</label>
                <div className="w-full px-3 py-2 border border-gray-200 bg-gray-50 rounded-md text-gray-700">
                  Top-level hub
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  This is a top-level hub, so it has no parent. Its subcategories are
                  managed from its detail page.
                </p>
              </div>
            )}
            
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
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                      }}
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

            {/* Featured applies to hubs only (homepage carousel shows hubs). */}
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
              defaults={{
                title: formData.name,
                description: formData.description,
                url: formData.slug ? `https://autobacsindia.com/categories/${formData.slug}` : undefined,
              }}
            />

            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={() => router.back()}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}