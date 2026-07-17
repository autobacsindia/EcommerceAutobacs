'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { revalidateHome } from '@/lib/revalidateHome';
import { parseApiResponse, errorMessage, submitMultipart } from '@/lib/multipartResponse';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import Link from 'next/link';
import SeoPanel, { EMPTY_SEO, type SeoFormValue } from '@/components/admin/SeoPanel';
import ImageUploader from '@/components/ui/ImageUploader';

export default function CreateBrandPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [seo, setSeo] = useState<SeoFormValue>(EMPTY_SEO);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      setError('Brand name is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Multipart so the logo file reaches Cloudinary via the backend.
      const fd = new FormData();
      fd.append('name', formData.name.trim());
      if (formData.description.trim()) fd.append('description', formData.description.trim());
      fd.append('seo', JSON.stringify(seo));
      if (logoFile) fd.append('logo', logoFile);

      const res = await submitMultipart('/api/v1/brands', 'POST', fd);
      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(errorMessage(res, data, 'Failed to create brand'));

      revalidateHome('home:brands');
      alert('Brand created successfully!');
      router.push('/admin/brands');
    } catch (err: any) {
      setError(err.message || 'Failed to create brand');
    } finally {
      setLoading(false);
    }
  };

  // Generate slug preview
  const slugPreview = formData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

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
        <h1 className="text-3xl font-bold">Create New Brand</h1>
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
            <ImageUploader
              label=""
              maxFiles={1}
              onFilesChange={(files) => setLogoFile(files[0] ?? null)}
              disabled={loading}
            />
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
            defaults={{ title: formData.name, description: formData.description }}
          />

          {/* Actions */}
          <div className="flex gap-4 pt-4">
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Create Brand
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
