'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import apiClient from '@/lib/api';
import { revalidateHome } from '@/lib/revalidateHome';
import { parseApiResponse, errorMessage, submitMultipart } from '@/lib/multipartResponse';
import { API_ENDPOINTS } from '@/lib/constants';
import { ArrowLeft, Save, Loader2, Package } from 'lucide-react';
import Link from 'next/link';
import SeoPanel, { EMPTY_SEO, toSeoFormValue, type SeoFormValue } from '@/components/admin/SeoPanel';
import ImageUploader from '@/components/ui/ImageUploader';

interface Brand {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  description?: string;
  isActive: boolean;
  productCount: number;
  seo?: Partial<SeoFormValue>;
}

export default function EditBrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    logo: '',
    description: '',
    isActive: true,
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [seo, setSeo] = useState<SeoFormValue>(EMPTY_SEO);

  useEffect(() => {
    fetchBrand();
  }, [id]);

  const fetchBrand = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<{ success: boolean; brand: Brand }>(
        API_ENDPOINTS.BRAND_DETAIL(id)
      );
      
      if (response.brand) {
        setBrand(response.brand);
        setFormData({
          name: response.brand.name,
          logo: response.brand.logo || '',
          description: response.brand.description || '',
          isActive: response.brand.isActive,
        });
        setSeo(toSeoFormValue(response.brand.seo));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch brand');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      setError('Brand name is required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Multipart so a newly chosen logo file reaches Cloudinary via the backend.
      const fd = new FormData();
      fd.append('name', formData.name.trim());
      fd.append('description', formData.description.trim());
      fd.append('isActive', String(formData.isActive));
      fd.append('seo', JSON.stringify(seo));
      // Only send `logo` when the admin picked a new file — omitting it keeps
      // the existing logo untouched on the backend.
      if (logoFile) fd.append('logo', logoFile);

      const res = await submitMultipart(`/api/v1/brands/${id}`, 'PUT', fd);
      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(errorMessage(res, data, 'Failed to update brand'));

      revalidateHome('home:brands');
      alert('Brand updated successfully!');
      router.push('/admin/brands');
    } catch (err: any) {
      setError(err.message || 'Failed to update brand');
    } finally {
      setSaving(false);
    }
  };

  // Generate slug preview
  const slugPreview = formData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
        <Link 
          href="/admin/brands" 
          className="mt-4 inline-flex items-center gap-2 text-blue-600 hover:text-blue-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Brands
        </Link>
      </div>
    );
  }

  if (!brand) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          Brand not found
        </div>
        <Link 
          href="/admin/brands" 
          className="mt-4 inline-flex items-center gap-2 text-blue-600 hover:text-blue-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Brands
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <Link 
          href="/admin/brands" 
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Brands
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Edit Brand: {brand.name}</h1>
          <Link
            href={`/admin/brands/${id}/products`}
            className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700"
          >
            <Package className="h-4 w-4" />
            Manage Products ({brand.productCount})
          </Link>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="max-w-2xl">
        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          {/* Name */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
              Brand Name *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g., Profender"
              required
            />
            {formData.name && (
              <p className="mt-1 text-sm text-gray-500">
                Slug will be: <span className="font-mono text-blue-600">{slugPreview}</span>
              </p>
            )}
          </div>

          {/* Logo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Logo
            </label>
            {formData.logo && !logoFile && (
              <div className="mb-2">
                <p className="text-sm text-gray-500 mb-1">Current logo:</p>
                <div className="h-16 w-32 bg-gray-100 rounded border overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={formData.logo}
                    alt="Current logo"
                    className="h-full w-full object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              </div>
            )}
            <ImageUploader
              label=""
              maxFiles={1}
              onFilesChange={(files) => setLogoFile(files[0] ?? null)}
              disabled={saving}
            />
            <p className="mt-1 text-sm text-gray-500">
              {formData.logo ? 'Upload a new image to replace the current logo.' : 'Upload a brand logo.'}
            </p>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              rows={4}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter a description for this brand..."
            />
          </div>

          <SeoPanel
            value={seo}
            onChange={setSeo}
            defaults={{
              title: formData.name,
              description: formData.description,
              url: brand?.slug ? `https://autobacsindia.com/brands/${brand.slug}` : undefined,
            }}
          />

          {/* Active Status */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="isActive"
              name="isActive"
              checked={formData.isActive}
              onChange={handleChange}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="isActive" className="text-sm font-medium text-gray-700">
              Brand is active
            </label>
          </div>

          {/* Actions */}
          <div className="flex gap-4 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Changes
                </>
              )}
            </button>
            <Link
              href="/admin/brands"
              className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </Link>
          </div>
        </div>
      </form>
    </div>
  );
}
