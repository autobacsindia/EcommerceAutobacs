'use client';

import { type StockStatus, getStockStatus } from '@/lib/stock';
import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'react-hot-toast';
import ImageUploader, { CloudinaryImage } from '@/components/ui/ImageUploader';
import RichTextEditor from '@/components/ui/RichTextEditor';
import SeoScorePanel from '@/components/ui/SeoScorePanel';
import { generateSlug } from '@/lib/utils';

interface Category {
  _id: string;
  name: string;
}

interface Vehicle {
  _id: string;
  make: string;
  model: string;
}

interface Brand {
  _id: string;
  name: string;
  slug?: string;
}

interface Product {
  _id: string;
  name: string;
  slug?: string;
  description: string;
  shortDescription: string;
  price: number;
  originalPrice: number;
  category?: string; // Keep for backward compatibility if needed, but we'll use categories
  categories?: string[] | Category[];
  brand: string;
  stock: StockStatus;
  sku: string;
  isFeatured: boolean;
  isOfferFeatured?: boolean;
  offerStartDate?: string;
  offerEndDate?: string;
  isActive: boolean;
  images: { url: string; public_id: string; alt: string; isPrimary: boolean }[];
  features?: string[];
  whyChoose?: string[];
  specifications?: Array<{ key: string; value: string }>;
  compatibleVehicles?: Vehicle[];
  tags?: string[];
}

export default function EditProductPage() {
  const router = useRouter();
  const params = useParams();
  const productId = params.id as string;
  
  const [categories, setCategories] = useState<Category[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  // Category Multi-select state
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [categorySearch, setCategorySearch] = useState('');
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);

  // Tags state
  const [tagsInput, setTagsInput] = useState('');

  // Permalink / slug state
  const [slug, setSlug] = useState('');
  const [isEditingSlug, setIsEditingSlug] = useState(false);
  const [editingSlugValue, setEditingSlugValue] = useState('');
  const [slugCustomized, setSlugCustomized] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    shortDescription: '',
    price: '',
    originalPrice: '',
    // category: '', // Removed in favor of selectedCategories
    brand: '',
    stock: '',
    sku: '',
    isFeatured: false,
    isFastMoving: false,
    isOfferFeatured: false,
    offerStartDate: '',
    offerEndDate: '',
    isActive: true,
  });
  
  const [newImageFiles, setNewImageFiles] = useState<File[]>([]);
  const [existingImages, setExistingImages] = useState<CloudinaryImage[]>([]);
  // Track pending deletions — applied atomically on submit (avoids race conditions)
  const [pendingDeletes, setPendingDeletes] = useState<string[]>([]);
  // Replace mode: when true, existing gallery is wiped and replaced by new uploads
  const [replaceMode, setReplaceMode] = useState(false);
  const [features, setFeatures] = useState<string[]>([]);
  const [whyChoose, setWhyChoose] = useState<string[]>([]);
  const [specifications, setSpecifications] = useState<{ key: string; value: string }[]>([]);
  const [selectedVehicles, setSelectedVehicles] = useState<string[]>([]);

  useEffect(() => {
    fetchCategories();
    fetchVehicles();
    fetchBrands();
    if (productId) {
      fetchProduct();
    }
  }, [productId]);

  const fetchBrands = async () => {
    try {
      const response = await apiClient.get<{ data?: Brand[]; brands?: Brand[] }>('/brands?limit=500');
      const list = response.data || response.brands || [];
      setBrands([...list].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      console.error('Failed to fetch brands:', err);
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await apiClient.get('/categories') as { data?: Category[]; categories?: Category[] };
      const fetchedCategories = response.data || response.categories || [];
      console.log('Fetched categories:', fetchedCategories.length);
      setCategories(fetchedCategories);
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    }
  };

  const fetchVehicles = async () => {
    try {
      const response = await apiClient.get<{ vehicles: Vehicle[] }>('/vehicles');
      setVehicles(response.vehicles || []);
    } catch (err) {
      console.error('Failed to fetch vehicles:', err);
    }
  };

  const fetchProduct = async () => {
    try {
      console.log('Product ID:', productId);
        
      // Use admin-fetch endpoint — bypasses the public SEO redirect and includes inactive products
      const response = await fetch(`/api/v1/products/${productId}/admin-fetch`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });
        
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Error response:', response.status, errorText);
        throw new Error(`HTTP error! status: ${response.status}`);
      }
            
      const data = await response.json();
      console.log('Raw API response:', data);
            
      // Try multiple ways to extract product data
      let productData;
      if (data?.product) {
        productData = data.product;
        console.log('Using data.product');
      } else if (data?.data) {
        productData = data.data;
        console.log('Using data.data');
      } else if (data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length > 0) {
        productData = data;
        console.log('Using raw data object');
      } else {
        console.error('Unexpected API response format:', data);
        throw new Error('API returned unexpected response format');
      }
            
      if (!productData) {
        console.error('Product not found. Response:', data);
        alert('Product not found or may have been deleted');
        return;
      }
        
      console.log('Product loaded:', productData.name);
      console.log('Product price:', productData.price);
      console.log('Product categories:', productData.categories);
      console.log('Product full data:', productData);
      setProduct(productData);
      setSlug(productData.slug || generateSlug(productData.name || ''));
      // Normalise to CloudinaryImage shape (old images may have no public_id)
      const imgs: CloudinaryImage[] = (productData.images || []).map((img: any) => ({
        url:       img?.url || '',
        public_id: img?.public_id || '',
        alt:       img?.alt || '',
        isPrimary: img?.isPrimary || false,
      }));
      setExistingImages(imgs);
      setFeatures(productData.features || []);
      setWhyChoose(productData.whyChoose || []);
      setSpecifications(productData.specifications || []);

      if (productData.compatibleVehicles && Array.isArray(productData.compatibleVehicles)) {
        // Handle both populated (objects) and unpopulated (strings) arrays
        const vehicleIds = productData.compatibleVehicles.map((v: any) => 
          typeof v === 'object' ? v._id : v
        );
        setSelectedVehicles(vehicleIds);
      }
          
      // Populate form with product data
      setFormData({
        name: productData.name || '',
        description: productData.description || '',
        shortDescription: productData.shortDescription || '',
        price: productData.price?.toString() || '',
        originalPrice: productData.originalPrice?.toString() || '',
        brand: productData.brand || '',
        // Normalize legacy numeric stock (e.g. 999) to a valid status so the
        // dropdown shows a real option and saving sends a valid enum value.
        stock: getStockStatus(productData),
        sku: productData.sku || '',
        isFeatured: productData.isFeatured || false,
        isFastMoving: productData.isFastMoving || false,
        isOfferFeatured: productData.isOfferFeatured || false,
        offerStartDate: productData.offerStartDate ? new Date(productData.offerStartDate).toISOString().slice(0, 16) : '',
        offerEndDate: productData.offerEndDate ? new Date(productData.offerEndDate).toISOString().slice(0, 16) : '',
        isActive: productData.isActive !== undefined ? productData.isActive : true,
      });
  
      // Handle categories
      if (productData.categories && Array.isArray(productData.categories)) {
        const categoryIds = productData.categories.map((c: any) => 
          typeof c === 'object' ? c._id : c
        );
        setSelectedCategories(categoryIds);
      } else if (productData.category) {
        // Fallback for single category
        const catId = typeof productData.category === 'object' ? productData.category._id : productData.category;
        setSelectedCategories([catId]);
      } else {
        setSelectedCategories([]);
      }
  
      // Handle tags
      if (productData.tags && Array.isArray(productData.tags)) {
        setTagsInput(productData.tags.join(', '));
      }
    } catch (err: any) {
      console.error('Failed to fetch product:', err);
      if (err.message.includes('Failed to fetch')) {
        alert("Failed to connect to backend server. Please ensure it's running and accessible.");
      } else {
        alert(`Failed to load product: ${err.message}`);
      }
      router.push('/admin/products');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = type === 'checkbox' ? (e.target as HTMLInputElement).checked : undefined;

    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));

    if (name === 'name' && !slugCustomized) {
      setSlug(generateSlug(value));
    }
  };

  /**
   * Called by ImageUploader when admin removes an existing image.
   *
   * Design: deferred deletion — we DON'T call the API immediately.
   * Instead we queue the public_id into pendingDeletes and remove from UI.
   * The actual Cloudinary DELETE fires inside handleSubmit after the PUT
   * succeeds, which means:
   *   ✅ No race condition between delete and submit
   *   ✅ Atomic — if submit fails, images are never deleted
   *   ✅ Single mutation path (one source of truth)
   *
   * If the image has no public_id (legacy migrated images), it is simply
   * dropped from the form — it will be absent from the next PUT payload.
   */
  const handleRemoveExisting = (publicId: string, index: number) => {
    // Remove from UI immediately
    setExistingImages((prev) => prev.filter((_, i) => i !== index));
    // Queue for deletion after submit succeeds
    if (publicId) {
      setPendingDeletes((prev) => [...prev, publicId]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    
    // Validation
    if (formData.isOfferFeatured && formData.offerStartDate && formData.offerEndDate) {
      const startDate = new Date(formData.offerStartDate);
      const endDate = new Date(formData.offerEndDate);
      
      if (endDate <= startDate) {
        alert('Offer End Date must be after Offer Start Date');
        setSubmitting(false);
        return;
      }
    }

    const price = parseFloat(formData.price);
    if (isNaN(price)) {
      alert('Please enter a valid price');
      setSubmitting(false);
      return;
    }

    const stock = formData.stock;
    if (!['in', 'low', 'out'].includes(stock)) {
      alert('Please select a valid stock status');
      setSubmitting(false);
      return;
    }
    
    try {
      // Build multipart FormData so new image files travel as binary
      const fd = new FormData();

      // ── Scalar fields ──────────────────────────────────────────────────────
      fd.append('name',             formData.name);
      fd.append('description',      formData.description);
      fd.append('shortDescription', formData.shortDescription);
      fd.append('price',            String(price));
      if (formData.originalPrice) fd.append('originalPrice', formData.originalPrice);
      fd.append('stock',      String(stock));
      if (formData.sku) fd.append('sku', formData.sku);
      fd.append('brand',      formData.brand);
      fd.append('isActive',   String(formData.isActive));
      fd.append('isFeatured', String(formData.isFeatured));
      fd.append('isFastMoving',    String(formData.isFastMoving));
      fd.append('isOfferFeatured', String(formData.isOfferFeatured));
      if (formData.offerStartDate) fd.append('offerStartDate', formData.offerStartDate);
      if (formData.offerEndDate)   fd.append('offerEndDate',   formData.offerEndDate);

      // Use slug from state (auto-generated from name or manually customized)
      if (slug) {
        fd.append('slug', slug);
        console.log('Using slug:', slug);
      }

      // ── JSON-encoded arrays ────────────────────────────────────────────────
      fd.append('categories',      JSON.stringify(selectedCategories));
      fd.append('tags',            JSON.stringify(tagsInput.split(',').map(t => t.trim()).filter(Boolean)));
      fd.append('compatibleVehicles', JSON.stringify(selectedVehicles));
      const validFeatures = features.filter(f => f.trim());
      fd.append('features', JSON.stringify(validFeatures));
      const validWhyChoose = whyChoose.filter(w => w.trim());
      fd.append('whyChoose', JSON.stringify(validWhyChoose));
      const validSpecs = specifications.filter(s => s.key.trim() && s.value.trim());
      fd.append('specifications', JSON.stringify(validSpecs));

      // ── Existing images (keep them as-is, append mode) ────────────────────
      // replaceMode=true → controller deletes old gallery and uses only new uploads
      // replaceMode=false (default) → controller appends new files to existing gallery
      fd.append('replaceImages', String(replaceMode));

      // ── Deferred deletes ──────────────────────────────────────
      // Images the admin removed from UI are sent here so the BACKEND deletes
      // them from Cloudinary AFTER the DB save succeeds.
      // This way:
      //   ✅ If PUT fails   → images are never deleted (DB + Cloudinary stay in sync)
      //   ✅ If DELETE fails → backend logs [CLEANUP_REQUIRED] for later retry
      //   ✅ No orphan risk from in-flight frontend fetch racing the submit
      if (pendingDeletes.length > 0) {
        fd.append('deletePublicIds', JSON.stringify(pendingDeletes));
      }

      // ── New image files (binary) ───────────────────────────────────────────
      newImageFiles.forEach((file) => fd.append('images', file));

      // ── Send ──────────────────────────────────────────────────────────────
      // Use the relative /api/v1 path so the request goes through the Next.js
      // rewrite proxy → avoids CORS and works in all environments.
      // apiClient cannot be used here because it JSON.stringify()s the body,
      // which would corrupt the multipart FormData stream.
      const csrfToken = document.cookie
        .split('; ')
        .find((c) => c.startsWith('XSRF-TOKEN='))
        ?.split('=')[1] || '';

      // Build headers - only add Authorization if token exists
      // With httpOnly cookies, the browser automatically sends cookies
      // when credentials: 'include' is set
      const headers: Record<string, string> = {
        'X-XSRF-TOKEN': csrfToken,
      };

      // Try to get token from apiClient or localStorage (fallback for older sessions)
      const authToken = apiClient.getAuthToken() || localStorage.getItem('authToken');
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
        console.log('Adding Authorization header');
      } else {
        console.log('Using httpOnly cookies for authentication');
      }

      const res = await fetch(
        `/api/v1/products/${productId}`,
        {
          method: 'PUT',
          headers,
          credentials: 'include',
          body: fd,
        }
      );

      console.log('Response status:', res.status);
      console.log('Response headers:', Object.fromEntries(res.headers.entries()));
      
      let data;
      try {
        const text = await res.text();
        console.log('Raw response:', text);
        data = text ? JSON.parse(text) : {};
      } catch (parseError) {
        console.error('Failed to parse response:', parseError);
        throw new Error(`Server returned invalid response (${res.status})`);
      }
      
      console.log('Update response:', res.status, data);
      
      if (!res.ok) {
        console.error('Update failed:', data);
        console.error('Error details:', JSON.stringify(data, null, 2));
        throw new Error(data.message || data.error || `Failed to update product (${res.status})`);
      }

      alert('Product updated successfully');
      router.push('/admin/products');
    } catch (err: any) {
      alert(err.message || 'Failed to update product');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-4 mb-8">
          <button 
            onClick={() => router.back()}
            className="p-2 rounded-lg hover:bg-gray-100"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-3xl font-bold">Edit Product</h1>
        </div>
        
        <div className="bg-white rounded-lg shadow p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-1/4"></div>
            <div className="h-10 bg-gray-200 rounded"></div>
            <div className="h-4 bg-gray-200 rounded w-1/4 mt-6"></div>
            <div className="h-20 bg-gray-200 rounded"></div>
            <div className="h-4 bg-gray-200 rounded w-1/4 mt-6"></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="h-10 bg-gray-200 rounded"></div>
              <div className="h-10 bg-gray-200 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center gap-4 mb-8">
        <button 
          onClick={() => router.back()}
          className="p-2 rounded-lg hover:bg-gray-100"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-3xl font-bold">Edit Product <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded ml-2">New</span></h1>
      </div>
      
      <div className="flex gap-6 items-start">
      <form onSubmit={handleSubmit} className="flex-1 min-w-0 bg-white rounded-lg shadow p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Product Information */}
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-4">Product Information</h2>
            
            <div className="mb-4">
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                Product Name *
              </label>
              <input
                id="name"
                type="text"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              {/* Permalink bar */}
              <div className="mt-2 flex items-center flex-wrap gap-1 text-sm text-gray-600">
                <span className="font-medium text-gray-500">Permalink:</span>
                {isEditingSlug ? (
                  <>
                    <span className="text-gray-400">
                      {typeof window !== 'undefined' ? window.location.origin : ''}/products/
                    </span>
                    <input
                      type="text"
                      value={editingSlugValue}
                      onChange={(e) => setEditingSlugValue(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))}
                      className="px-2 py-0.5 border border-blue-400 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 min-w-50"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setSlug(editingSlugValue);
                        setSlugCustomized(true);
                        setIsEditingSlug(false);
                      }}
                      className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                    >
                      OK
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditingSlug(false)}
                      className="px-2 py-0.5 border border-gray-300 text-gray-600 rounded text-xs hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <a
                      href={`/products/${slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline break-all"
                    >
                      {typeof window !== 'undefined' ? window.location.origin : ''}/products/{slug}
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSlugValue(slug);
                        setIsEditingSlug(true);
                      }}
                      className="px-2 py-0.5 border border-gray-300 text-gray-600 rounded text-xs hover:bg-gray-50"
                    >
                      Edit
                    </button>
                    {slugCustomized && (
                      <span className="text-xs text-amber-600">(customized)</span>
                    )}
                  </>
                )}
              </div>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Short Description
              </label>
              <input
                type="text"
                name="shortDescription"
                value={formData.shortDescription}
                onChange={handleInputChange}
                maxLength={200}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                {formData.shortDescription.length}/200 characters
              </p>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description *
              </label>
              <RichTextEditor
                value={formData.description}
                onChange={(html) => setFormData((prev) => ({ ...prev, description: html }))}
                placeholder="Enter product description…"
                minHeight="220px"
              />
            </div>
          </div>
          
          {/* Pricing & Inventory */}
          <div>
            <h2 className="text-xl font-semibold mb-4">Pricing & Inventory</h2>
            
            <div className="mb-4">
              <label htmlFor="price" className="block text-sm font-medium text-gray-700 mb-1">
                Price (₹) *
              </label>
              <input
                id="price"
                type="number"
                name="price"
                value={formData.price}
                onChange={handleInputChange}
                required
                min="0"
                step="0.01"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Original Price (₹)
              </label>
              <input
                type="number"
                name="originalPrice"
                value={formData.originalPrice}
                onChange={handleInputChange}
                min="0"
                step="0.01"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div className="mb-4">
              <label htmlFor="stock" className="block text-sm font-medium text-gray-700 mb-1">
                Stock Status *
              </label>
              <select
                id="stock"
                name="stock"
                value={formData.stock}
                onChange={handleInputChange}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="in">In Stock</option>
                <option value="low">Low Stock</option>
                <option value="out">Out of Stock</option>
              </select>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                SKU
              </label>
              <input
                type="text"
                name="sku"
                value={formData.sku}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          
          {/* Organization */}
          <div>
            <h2 className="text-xl font-semibold mb-4">Organization</h2>
            
            <div className="mb-4 relative" style={{ zIndex: isCategoryDropdownOpen ? 50 : 1 }}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Categories
              </label>
              <div 
                className="w-full px-3 py-2 border border-gray-300 rounded-md cursor-pointer bg-white min-h-10.5 flex items-center flex-wrap gap-1"
                onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)}
              >
                {selectedCategories.length > 0 
                  ? (
                    <div className="flex flex-wrap gap-1">
                      {selectedCategories.map(catId => {
                        const cat = categories.find(c => c._id === catId);
                        return (
                          <span key={catId} className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full flex items-center">
                            {cat ? (cat.name === 'Suspension' ? 'SUSPENSION' : cat.name) : catId}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedCategories(prev => prev.filter(id => id !== catId));
                              }}
                              className="ml-1 hover:text-blue-900"
                            >
                              &times;
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )
                  : <span className="text-gray-500">Select categories</span>}
              </div>
              
              {isCategoryDropdownOpen && (
                <div className="absolute z-100 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-2xl max-h-60 overflow-y-auto p-2">
                  <input
                    type="text"
                    placeholder="Search categories..."
                    className="w-full px-2 py-1 mb-2 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                    value={categorySearch}
                    onChange={(e) => setCategorySearch(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                  {categories.length === 0 ? (
                    <div className="p-2 text-gray-500 text-center text-sm">Loading categories...</div>
                  ) : (
                    <>
                      {categories
                        .filter(c => c.name.toLowerCase().includes(categorySearch.toLowerCase()))
                        .map(category => (
                        <div 
                          key={category._id} 
                          className="flex items-center p-2 hover:bg-gray-100 cursor-pointer rounded"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (selectedCategories.includes(category._id)) {
                              setSelectedCategories(prev => prev.filter(id => id !== category._id));
                            } else {
                              setSelectedCategories(prev => [...prev, category._id]);
                            }
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedCategories.includes(category._id)}
                            readOnly
                            className="mr-2 h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                          />
                          <span className="text-gray-900">{category.name === 'Suspension' ? 'SUSPENSION' : category.name}</span>
                        </div>
                      ))}
                      {categories.filter(c => c.name.toLowerCase().includes(categorySearch.toLowerCase())).length === 0 && (
                        <div className="p-2 text-gray-500 text-center text-sm">No matching categories found</div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="mb-4 p-3 bg-gray-50 rounded-md border border-gray-200">
              <label htmlFor="tags" className="block text-sm font-medium text-gray-700 mb-1">
                Tags
              </label>
              <textarea
                id="tags"
                rows={3}
                placeholder="Paste tags here (comma separated), e.g., tag1, tag2, tag3"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">
                Copy and paste tags from WordPress or enter manually separated by commas.
              </p>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Brand
              </label>
              <select
                name="brand"
                value={formData.brand}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Select a brand —</option>
                {/* Preserve a legacy brand value that isn't in the Brand list yet */}
                {formData.brand && !brands.some(b => b.name === formData.brand) && (
                  <option value={formData.brand}>{formData.brand} (unlisted)</option>
                )}
                {brands.map((b) => (
                  <option key={b._id} value={b.name}>{b.name}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Brands are managed in <Link href="/admin/brands" className="text-blue-600 hover:underline">Admin → Brands</Link>.
              </p>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <div className="flex items-center">
                <input
                  id="isActive"
                  type="checkbox"
                  name="isActive"
                  checked={formData.isActive}
                  onChange={handleInputChange}
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="isActive" className="ml-2 text-sm text-gray-700">Active</label>
              </div>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Featured Product
              </label>
              <div className="flex items-center">
                <input
                  id="isFeatured"
                  type="checkbox"
                  name="isFeatured"
                  checked={formData.isFeatured}
                  onChange={handleInputChange}
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="isFeatured" className="ml-2 text-sm text-gray-700">Mark as featured</label>
              </div>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fast Moving
              </label>
              <div className="flex items-center">
                <input
                  id="isFastMoving"
                  type="checkbox"
                  name="isFastMoving"
                  checked={formData.isFastMoving}
                  onChange={handleInputChange}
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="isFastMoving" className="ml-2 text-sm text-gray-700">Mark as fast moving</label>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Show on Offers Page
              </label>
              <div className="flex items-center">
                <input
                  id="isOfferFeatured"
                  type="checkbox"
                  name="isOfferFeatured"
                  checked={formData.isOfferFeatured}
                  onChange={handleInputChange}
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="isOfferFeatured" className="ml-2 text-sm text-gray-700">Feature on offers page</label>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                If original price is higher than current price, discount will be shown automatically.
              </p>

              {formData.isOfferFeatured && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="offerStartDate" className="block text-sm font-medium text-gray-700 mb-1">
                      Offer Start Date
                    </label>
                    <input
                      id="offerStartDate"
                      type="datetime-local"
                      name="offerStartDate"
                      value={formData.offerStartDate || ''}
                      onChange={handleInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="offerEndDate" className="block text-sm font-medium text-gray-700 mb-1">
                      Offer End Date
                    </label>
                    <input
                      id="offerEndDate"
                      type="datetime-local"
                      name="offerEndDate"
                      value={formData.offerEndDate || ''}
                      onChange={handleInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Compatible Vehicles */}
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-4">
              Compatible Vehicles
              {selectedVehicles.length > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-500">({selectedVehicles.length} selected)</span>
              )}
            </h2>
            {vehicles.length === 0 ? (
              <p className="text-gray-500">No vehicles available. Create vehicles first.</p>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="Search make or model…"
                  value={vehicleSearch}
                  onChange={(e) => setVehicleSearch(e.target.value)}
                  className="w-full mb-2 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="border border-gray-300 rounded-md p-4 max-h-60 overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {vehicles
                    .filter(v => {
                      const q = vehicleSearch.trim().toLowerCase();
                      if (!q) return true;
                      return `${v.make} ${v.model}`.toLowerCase().includes(q);
                    })
                    .map(vehicle => (
                    <div key={vehicle._id} className="flex items-center">
                      <input
                        type="checkbox"
                        id={`vehicle-${vehicle._id}`}
                        checked={selectedVehicles.includes(vehicle._id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedVehicles([...selectedVehicles, vehicle._id]);
                          } else {
                            setSelectedVehicles(selectedVehicles.filter(id => id !== vehicle._id));
                          }
                        }}
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <label htmlFor={`vehicle-${vehicle._id}`} className="ml-2 text-sm text-gray-700">
                        {vehicle.make} {vehicle.model}
                      </label>
                    </div>
                  ))}
                </div>
                </div>
              </>
              )}
          </div>

          {/* Technical Specifications (key / value) */}
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-4">Technical Specifications</h2>
            <div className="space-y-3">
              {specifications.map((spec, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="text"
                    value={spec.key}
                    onChange={(e) => {
                      const next = [...specifications];
                      next[index] = { ...next[index], key: e.target.value };
                      setSpecifications(next);
                    }}
                    className="w-1/3 px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="Name (e.g. Material)"
                  />
                  <input
                    type="text"
                    value={spec.value}
                    onChange={(e) => {
                      const next = [...specifications];
                      next[index] = { ...next[index], value: e.target.value };
                      setSpecifications(next);
                    }}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="Value (e.g. Powder-coated steel)"
                  />
                  <button
                    type="button"
                    onClick={() => setSpecifications(specifications.filter((_, i) => i !== index))}
                    className="px-3 py-2 border border-red-300 text-red-600 rounded-md hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setSpecifications([...specifications, { key: '', value: '' }])}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Add Specification
              </button>
            </div>
          </div>

          {/* Features */}
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-1">Key Features</h2>
            <p className="text-sm text-gray-500 mb-4">
              One feature per box. Format: <strong>Title – description</strong> — the text before the dash shows as a bold title. (Plain text, no HTML.)
            </p>
            <div className="space-y-4">
              {features.map((feature, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="text"
                    value={feature}
                    onChange={(e) => {
                      const newFeatures = [...features];
                      newFeatures[index] = e.target.value;
                      setFeatures(newFeatures);
                    }}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="e.g. Advanced Foam Cell Technology – Reduces shock fade on long off-road runs"
                  />
                  <button
                    type="button"
                    onClick={() => setFeatures(features.filter((_, i) => i !== index))}
                    className="px-3 py-2 border border-red-300 text-red-600 rounded-md hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setFeatures([...features, ''])}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Add Feature
              </button>
            </div>
          </div>

          {/* Why Choose */}
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-1">Why Choose</h2>
            <p className="text-sm text-gray-500 mb-4">
              One reason per box. Format: <strong>Title – description</strong> — the text before the dash shows as a bold title. (Plain text, no HTML.)
            </p>
            <div className="space-y-4">
              {whyChoose.map((item, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="text"
                    value={item}
                    onChange={(e) => {
                      const next = [...whyChoose];
                      next[index] = e.target.value;
                      setWhyChoose(next);
                    }}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="e.g. Built for Adventure – Handles demanding off-road while staying road-comfortable"
                  />
                  <button
                    type="button"
                    onClick={() => setWhyChoose(whyChoose.filter((_, i) => i !== index))}
                    className="px-3 py-2 border border-red-300 text-red-600 rounded-md hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setWhyChoose([...whyChoose, ''])}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Add Reason
              </button>
            </div>
          </div>

          {/* Images */}
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-4">Product Images</h2>

            {/* Replace mode toggle */}
            <div className="mb-3 flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <input
                id="replaceMode"
                type="checkbox"
                checked={replaceMode}
                onChange={(e) => setReplaceMode(e.target.checked)}
                className="h-4 w-4 text-amber-600 border-gray-300 rounded"
              />
              <label htmlFor="replaceMode" className="text-sm text-amber-800 font-medium cursor-pointer">
                Replace entire gallery
                <span className="ml-1 font-normal text-amber-600">
                  — all existing images will be removed and replaced by new uploads
                </span>
              </label>
            </div>

            <ImageUploader
              value={replaceMode ? [] : existingImages}
              onRemoveExisting={handleRemoveExisting}
              onFilesChange={(files) => setNewImageFiles(files)}
              maxFiles={8}
              label=""
            />
            <p className="mt-2 text-xs text-gray-500">
              {replaceMode
                ? 'Replace mode: upload new images above — existing gallery will be cleared on save.'
                : 'Existing images can be removed individually. New images are appended on save.'}
            </p>
          </div>
        </div>
        
        <div className="mt-8 flex justify-end gap-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Updating...' : 'Update Product'}
          </button>
        </div>
      </form>

      {/* Sticky SEO Score sidebar */}
      <aside className="w-72 shrink-0 sticky top-6 self-start">
        <SeoScorePanel
          data={{
            name: formData.name,
            description: formData.description,
            shortDescription: formData.shortDescription,
            brand: formData.brand,
            slug,
            existingImages,
            newImageCount: newImageFiles.length,
            selectedCategories,
            tagsInput,
            features,
            whyChoose,
          }}
        />
      </aside>
      </div>
    </div>
  );
}
