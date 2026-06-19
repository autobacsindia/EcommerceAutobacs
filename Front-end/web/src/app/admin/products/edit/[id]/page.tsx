'use client';

import { type StockStatus, getStockStatus } from '@/lib/stock';
import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
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
  year: number;
  variant?: string;
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
  packageContents?: string[];
  variableSpecs?: Array<{ key: string; options: Array<{ label: string; price: number; image?: string }> }>;
  compatibleVehicles?: Vehicle[];
  qna?: Array<{ question: string; answer: string }>;
  tags?: string[];
}

export default function EditProductPage() {
  const router = useRouter();
  const params = useParams();
  const productId = params.id as string;
  
  const [categories, setCategories] = useState<Category[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
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
  const [variableSpecs, setVariableSpecs] = useState<Array<{ key: string; options: Array<{ label: string; price: number; image?: string; images?: string[] }> }>>([]);
  const [features, setFeatures] = useState<string[]>([]);
  const [packageContents, setPackageContents] = useState<string[]>([]);
  const [qna, setQna] = useState<{ question: string; answer: string }[]>([]);
  const [selectedVehicles, setSelectedVehicles] = useState<string[]>([]);
  const [productStoryText, setProductStoryText] = useState('');
  const [productStoryCards, setProductStoryCards] = useState<{ title: string; description: string }[]>([]);
  const [installationSteps, setInstallationSteps] = useState<{ title: string; description: string }[]>([]);
  const [indianRoadsText, setIndianRoadsText] = useState('');
  const [indianRoadsCards, setIndianRoadsCards] = useState<{ title: string; description: string }[]>([]);

  useEffect(() => {
    fetchCategories();
    fetchVehicles();
    if (productId) {
      fetchProduct();
    }
  }, [productId]);

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
      setVariableSpecs(productData.variableSpecs || []);
      setFeatures(productData.features || []);
      setPackageContents(productData.packageContents || []);
      setQna(productData.qna || []);
      setProductStoryText(productData.productStoryText || '');
      setProductStoryCards(productData.productStoryCards || []);
      setInstallationSteps(productData.installationSteps || []);
      setIndianRoadsText(productData.indianRoadsText || '');
      setIndianRoadsCards(productData.indianRoadsCards || []);
        
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
      const validQna = qna.filter(item => item.question.trim() !== '' && item.answer.trim() !== '');

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
      if (features.length)       fd.append('features',       JSON.stringify(features));
      if (packageContents.length) fd.append('packageContents', JSON.stringify(packageContents));
      if (variableSpecs.length)  fd.append('variableSpecs',  JSON.stringify(variableSpecs));
      if (validQna.length)       fd.append('qna',            JSON.stringify(validQna));
      if (productStoryText)      fd.append('productStoryText', productStoryText);
      const validStoryCards = productStoryCards.filter(c => c.title.trim() && c.description.trim());
      if (validStoryCards.length) fd.append('productStoryCards', JSON.stringify(validStoryCards));
      const validSteps = installationSteps.filter(s => s.title.trim() && s.description.trim());
      if (validSteps.length)     fd.append('installationSteps', JSON.stringify(validSteps));
      if (indianRoadsText)       fd.append('indianRoadsText', indianRoadsText);
      const validRoadsCards = indianRoadsCards.filter(c => c.title.trim() && c.description.trim());
      if (validRoadsCards.length) fd.append('indianRoadsCards', JSON.stringify(validRoadsCards));

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
              <input
                type="text"
                name="brand"
                value={formData.brand}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
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
            <h2 className="text-xl font-semibold mb-4">Compatible Vehicles</h2>
            <div className="border border-gray-300 rounded-md p-4 max-h-60 overflow-y-auto">
              {vehicles.length === 0 ? (
                <p className="text-gray-500">No vehicles available. Create vehicles first.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {vehicles.map(vehicle => (
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
                        {vehicle.make} {vehicle.model} ({vehicle.year}) {vehicle.variant ? `- ${vehicle.variant}` : ''}
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Variable Specifications */}
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-4">Variable Specifications</h2>
            <div className="space-y-4">
              {variableSpecs.map((spec, si) => (
                <div key={si} className="border rounded-lg p-4 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Specification Name</label>
                    <input
                      type="text"
                      value={spec.key}
                      onChange={(e) => {
                        const v = [...variableSpecs];
                        v[si] = { ...v[si], key: e.target.value };
                        setVariableSpecs(v);
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Options</label>
                    <div className="space-y-2">
                      {spec.options.map((opt, oi) => (
                        <div key={oi} className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 bg-gray-50 rounded">
                          <input
                            type="text"
                            placeholder="Label"
                            value={opt.label}
                            onChange={(e) => {
                              const v = [...variableSpecs];
                              const opts = [...v[si].options];
                              opts[oi] = { ...opts[oi], label: e.target.value };
                              v[si] = { ...v[si], options: opts };
                              setVariableSpecs(v);
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                          />
                          <input
                            type="number"
                            placeholder="Price"
                            min="0"
                            step="0.01"
                            value={opt.price}
                            onChange={(e) => {
                              const v = [...variableSpecs];
                              const opts = [...v[si].options];
                              opts[oi] = { ...opts[oi], price: parseFloat(e.target.value || '0') };
                              v[si] = { ...v[si], options: opts };
                              setVariableSpecs(v);
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                          />
                          
                          {/* Image Selection */}
                          <div className="md:col-span-2">
                            <label className="block text-xs font-medium text-gray-700 mb-1">Option Images (Select multiple)</label>
                            {existingImages.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {existingImages.map((img, imgIdx) => {
                                  // Check if this image is selected (either via image property or images array)
                                  const isSelected = opt.images?.includes(img.url) || opt.image === img.url;
                                  
                                  return (
                                    <div 
                                      key={imgIdx}
                                      className={`relative w-12 h-12 border-2 rounded cursor-pointer ${isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:border-gray-300'}`}
                                      onClick={() => {
                                        const v = [...variableSpecs];
                                        const currentOption = v[si].options[oi];
                                        
                                        // Initialize images array if needed, including legacy image if present
                                        let currentImages = currentOption.images ? [...currentOption.images] : [];
                                        if (currentOption.image && !currentImages.includes(currentOption.image)) {
                                          currentImages.push(currentOption.image);
                                        }
                                        
                                        if (isSelected) {
                                          // Deselect: remove from images array
                                          currentImages = currentImages.filter(url => url !== img.url);
                                          // Also clear legacy image field if it matches
                                          if (currentOption.image === img.url) {
                                            v[si].options[oi].image = undefined;
                                          }
                                        } else {
                                          // Select: add to images array
                                          if (!currentImages.includes(img.url)) {
                                            currentImages.push(img.url);
                                          }
                                        }
                                        
                                        // Update images array
                                        v[si].options[oi].images = currentImages;
                                        // For backward compatibility/UI logic, set the first image as 'image'
                                        v[si].options[oi].image = currentImages.length > 0 ? currentImages[0] : undefined;
                                        
                                        setVariableSpecs(v);
                                      }}
                                      title={img.alt || 'Product Image'}
                                    >
                                      <img src={img.url} alt={img.alt} className="w-full h-full object-cover rounded-sm" />
                                      {isSelected && (
                                        <div className="absolute -top-1 -right-1 bg-blue-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]">
                                          ✓
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="text-xs text-gray-500 italic">Upload product images first to assign them to options.</p>
                            )}
                            <p className="text-[10px] text-gray-500 mt-1">Click to select/deselect images. Selected images will be displayed when this variant is chosen.</p>
                            
                            {/* Selected Images Preview with Remove Option */}
                            {((opt.images && opt.images.length > 0) || opt.image) && (
                              <div className="mt-3 p-2 bg-blue-50 rounded-md border border-blue-100">
                                <label className="block text-xs font-medium text-blue-800 mb-2">Selected for this Variant:</label>
                                <div className="flex flex-wrap gap-2">
                                  {/* Combine and deduplicate images */}
                                  {Array.from(new Set([...(opt.images || []), ...(opt.image ? [opt.image] : [])])).map((imgUrl, idx) => {
                                    // Find matching existing image for details, or fallback
                                    const imgDetails = existingImages.find(ei => ei.url === imgUrl);
                                    
                                    return (
                                      <div key={idx} className="relative w-14 h-14 border border-blue-200 rounded bg-white group">
                                        <img 
                                          src={imgUrl} 
                                          alt={imgDetails?.alt || 'Variant Image'} 
                                          className="w-full h-full object-cover rounded-sm" 
                                        />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const v = [...variableSpecs];
                                            const currentOption = v[si].options[oi];
                                            let currentImages = currentOption.images ? [...currentOption.images] : [];
                                            
                                            // Ensure we have the current state captured
                                            if (currentOption.image && !currentImages.includes(currentOption.image)) {
                                              currentImages.push(currentOption.image);
                                            }
                                            
                                            // Remove the specific image
                                            currentImages = currentImages.filter(url => url !== imgUrl);
                                            
                                            // Update legacy field if needed
                                            if (currentOption.image === imgUrl) {
                                              v[si].options[oi].image = undefined;
                                            }
                                            
                                            v[si].options[oi].images = currentImages;
                                            // If legacy was cleared, try to set it to next available
                                            if (!v[si].options[oi].image && currentImages.length > 0) {
                                              v[si].options[oi].image = currentImages[0];
                                            }
                                            
                                            setVariableSpecs(v);
                                          }}
                                          className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-md hover:bg-red-600 transition-all z-10"
                                          title="Remove from variant"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="md:col-span-2 flex justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                const v = [...variableSpecs];
                                const opts = [...v[si].options];
                                v[si] = { ...v[si], options: opts.filter((_, idx) => idx !== oi) };
                                setVariableSpecs(v);
                              }}
                              className="px-3 py-2 border rounded-md text-red-600 hover:bg-red-50"
                            >
                              Remove Option
                            </button>
                          </div>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          const v = [...variableSpecs];
                          v[si] = { ...v[si], options: [...v[si].options, { label: '', price: 0 }] };
                          setVariableSpecs(v);
                        }}
                        className="px-3 py-2 border rounded-md"
                      >
                        Add Option
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setVariableSpecs(variableSpecs.filter((_, idx) => idx !== si))}
                      className="px-3 py-2 border rounded-md"
                    >
                      Remove Specification
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setVariableSpecs([...variableSpecs, { key: '', options: [{ label: '', price: 0 }] }])}
                className="px-4 py-2 border rounded-md"
              >
                Add Specification
              </button>
            </div>
          </div>

          {/* Features */}
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-4">Features</h2>
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
                    placeholder="Feature description"
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

          {/* Package Contents */}
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-4">Package Contents</h2>
            <div className="space-y-4">
              {packageContents.map((item, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="text"
                    value={item}
                    onChange={(e) => {
                      const newContents = [...packageContents];
                      newContents[index] = e.target.value;
                      setPackageContents(newContents);
                    }}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="Package item"
                  />
                  <button
                    type="button"
                    onClick={() => setPackageContents(packageContents.filter((_, i) => i !== index))}
                    className="px-3 py-2 border border-red-300 text-red-600 rounded-md hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setPackageContents([...packageContents, ''])}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Add Package Item
              </button>
            </div>
          </div>

          {/* Q&A */}
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-4">Questions & Answers</h2>
            <div className="space-y-6">
              {qna.map((item, index) => (
                <div key={index} className="border p-4 rounded-lg space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Question</label>
                    <input
                      type="text"
                      value={item.question}
                      onChange={(e) => {
                        const newQna = [...qna];
                        newQna[index] = { ...newQna[index], question: e.target.value };
                        setQna(newQna);
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="Question"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Answer</label>
                    <textarea
                      value={item.answer}
                      onChange={(e) => {
                        const newQna = [...qna];
                        newQna[index] = { ...newQna[index], answer: e.target.value };
                        setQna(newQna);
                      }}
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="Answer"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setQna(qna.filter((_, i) => i !== index))}
                      className="px-3 py-2 border border-red-300 text-red-600 rounded-md hover:bg-red-50"
                    >
                      Remove Q&A
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setQna([...qna, { question: '', answer: '' }])}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Add Q&A
              </button>
            </div>
          </div>

          {/* ── Engineered for Indian Trails — Subtitle ──────────────────────── */}
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-1">Engineered for Indian Trails — Subtitle</h2>
            <p className="text-sm text-gray-500 mb-4">Paragraph shown under the section heading. Leave blank to use the default text.</p>
            <textarea
              rows={3}
              placeholder="e.g. Built specifically for the demands of Indian terrain — from potholed city roads to rugged mountain passes..."
              value={productStoryText}
              onChange={(e) => setProductStoryText(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
            />
          </div>

          {/* ── Engineered for Indian Trails — Condition Cards ───────────────── */}
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-1">Engineered for Indian Trails — Condition Cards</h2>
            <p className="text-sm text-gray-500 mb-4">Up to 4 cards shown in the section. Leave empty to use the default cards (Monsoon Durability, Heat Resistant, Off-Road Toughness, Highway Performance).</p>
            <div className="space-y-3">
              {productStoryCards.map((card, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-600">Card {index + 1}</span>
                    <button
                      type="button"
                      onClick={() => setProductStoryCards(productStoryCards.filter((_, i) => i !== index))}
                      className="px-2 py-1 text-xs border border-red-300 text-red-600 rounded-md hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="Card title, e.g. Monsoon Durability"
                    value={card.title}
                    onChange={(e) => {
                      const updated = [...productStoryCards];
                      updated[index] = { ...updated[index], title: e.target.value };
                      setProductStoryCards(updated);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <textarea
                    rows={2}
                    placeholder="Card description..."
                    value={card.description}
                    onChange={(e) => {
                      const updated = [...productStoryCards];
                      updated[index] = { ...updated[index], description: e.target.value };
                      setProductStoryCards(updated);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
              {productStoryCards.length < 4 && (
                <button
                  type="button"
                  onClick={() => setProductStoryCards([...productStoryCards, { title: '', description: '' }])}
                  className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 text-sm"
                >
                  Add Card
                </button>
              )}
            </div>
          </div>

          {/* ── Easy DIY Installation ────────────────────────────────────────── */}
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-1">Easy DIY Installation Steps</h2>
            <p className="text-sm text-gray-500 mb-4">Step-by-step instructions shown in the installation section. Leave empty to show generic default steps.</p>
            <div className="space-y-4">
              {installationSteps.map((step, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-7 h-7 rounded-full bg-orange-500 text-white flex items-center justify-center text-sm font-bold shrink-0">{index + 1}</span>
                    <span className="text-sm font-medium text-gray-600">Step {index + 1}</span>
                  </div>
                  <input
                    type="text"
                    placeholder="Step title, e.g. Unpack & Inspect"
                    value={step.title}
                    onChange={(e) => {
                      const updated = [...installationSteps];
                      updated[index] = { ...updated[index], title: e.target.value };
                      setInstallationSteps(updated);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <textarea
                    rows={2}
                    placeholder="Step description..."
                    value={step.description}
                    onChange={(e) => {
                      const updated = [...installationSteps];
                      updated[index] = { ...updated[index], description: e.target.value };
                      setInstallationSteps(updated);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setInstallationSteps(installationSteps.filter((_, i) => i !== index))}
                      className="px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded-md hover:bg-red-50"
                    >
                      Remove Step
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setInstallationSteps([...installationSteps, { title: '', description: '' }])}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 text-sm"
              >
                Add Step
              </button>
            </div>
          </div>

          {/* ── Perfect for Indian Roads & Climate — Description ──────────────── */}
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-1">Perfect for Indian Roads &amp; Climate — Description</h2>
            <p className="text-sm text-gray-500 mb-4">Paragraph shown under the section heading. Leave blank to use the default text.</p>
            <textarea
              rows={3}
              placeholder="e.g. Engineered to handle the unique challenges of Indian roads and climate year-round..."
              value={indianRoadsText}
              onChange={(e) => setIndianRoadsText(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
            />
          </div>

          {/* ── Perfect for Indian Roads & Climate — Cards ───────────────────── */}
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-1">Perfect for Indian Roads &amp; Climate — Condition Cards</h2>
            <p className="text-sm text-gray-500 mb-4">Up to 4 cards shown in the section. Leave empty to use the default cards.</p>
            <div className="space-y-3">
              {indianRoadsCards.map((card, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-600">Card {index + 1}</span>
                    <button
                      type="button"
                      onClick={() => setIndianRoadsCards(indianRoadsCards.filter((_, i) => i !== index))}
                      className="px-2 py-1 text-xs border border-red-300 text-red-600 rounded-md hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="Card title, e.g. Monsoon Ready"
                    value={card.title}
                    onChange={(e) => {
                      const updated = [...indianRoadsCards];
                      updated[index] = { ...updated[index], title: e.target.value };
                      setIndianRoadsCards(updated);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <textarea
                    rows={2}
                    placeholder="Card description..."
                    value={card.description}
                    onChange={(e) => {
                      const updated = [...indianRoadsCards];
                      updated[index] = { ...updated[index], description: e.target.value };
                      setIndianRoadsCards(updated);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
              {indianRoadsCards.length < 4 && (
                <button
                  type="button"
                  onClick={() => setIndianRoadsCards([...indianRoadsCards, { title: '', description: '' }])}
                  className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 text-sm"
                >
                  Add Card
                </button>
              )}
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
            qna,
          }}
        />
      </aside>
      </div>
    </div>
  );
}
