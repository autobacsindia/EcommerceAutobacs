'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { revalidateHome } from '@/lib/revalidateHome';
import { parseApiResponse, errorMessage, submitMultipart } from '@/lib/multipartResponse';
import { ArrowLeft } from 'lucide-react';
import ImageUploader from '@/components/ui/ImageUploader';
import RichTextEditor from '@/components/ui/RichTextEditor';
import SeoPanel, { EMPTY_SEO, type SeoFormValue } from '@/components/admin/SeoPanel';
import VariantsEditor, { serializeVariants, emptyVariant, type EditorVariant } from '@/components/admin/VariantsEditor';
import CategoryMultiSelect, { type CategoryOption } from '@/components/admin/CategoryMultiSelect';

type Category = CategoryOption;

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

export default function CreateProductPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Category Multi-select state
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  // Vehicle fitment search (the list can be 500+ entries)
  const [vehicleSearch, setVehicleSearch] = useState('');

  // Tags state
  const [tagsInput, setTagsInput] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    shortDescription: '',
    price: '',
    originalPrice: '',
    saleEndsAt: '',
    category: '',
    brand: '',
    stock: 'in',
    sku: '',
    isFeatured: false,
    isFastMoving: false,
    isActive: true,
  });
  
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [features, setFeatures] = useState<string[]>(['']);
  const [whyChoose, setWhyChoose] = useState<string[]>(['']);
  const [packageContents, setPackageContents] = useState<string[]>(['']);
  const [specifications, setSpecifications] = useState<{ key: string; value: string }[]>([{ key: '', value: '' }]);
  const [selectedVehicles, setSelectedVehicles] = useState<string[]>([]);
  const [seo, setSeo] = useState<SeoFormValue>(EMPTY_SEO);
  // Variable-product authoring: type toggle + models editor.
  const [productType, setProductType] = useState<'simple' | 'variable'>('simple');
  const [attributeName, setAttributeName] = useState('models');
  const [variants, setVariants] = useState<EditorVariant[]>([emptyVariant()]);

  useEffect(() => {
    fetchCategories();
    fetchVehicles();
    fetchBrands();
  }, []);

  const fetchCategories = async () => {
    try {
      // Admin picker, not the storefront list: /categories is public, Redis-cached,
      // active-only and capped at 200. Assigning a product needs every category —
      // including inactive ones and beyond the cap. counts=false skips the
      // dashboard's product-count aggregation, which a dropdown never shows.
      const response = await apiClient.get<{ data?: Category[]; categories?: Category[] }>('/categories/admin/all?counts=false');
      setCategories(response.data || response.categories || []);
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    }
  };

  const fetchBrands = async () => {
    try {
      const response = await apiClient.get<{ data?: Brand[]; brands?: Brand[] }>('/brands?make=false&active=true&limit=500');
      const list = response.data || response.brands || [];
      setBrands([...list].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      console.error('Failed to fetch brands:', err);
    }
  };

  const fetchVehicles = async () => {
    try {
      const response = await apiClient.get<{ vehicles: Vehicle[] }>('/vehicles');
      setVehicles(response.vehicles || []);
    } catch (err) {
      console.error('Failed to fetch vehicles:', err);
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
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setImages(files);
      
      // Create previews
      const previews = files.map(file => URL.createObjectURL(file));
      setImagePreviews(previews);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Variable products: at least one valid model with a price is required. The
    // single price/sale fields are ignored (price is derived from the models).
    const serializedVariants = productType === 'variable' ? serializeVariants(attributeName, variants) : [];
    if (productType === 'variable' && serializedVariants.length === 0) {
      alert('Add at least one model with a name and price for a variable product.');
      return;
    }

    // A sale countdown is only meaningful with a real markdown — mirror the
    // server-side rule so the admin gets an instant message, not a 400.
    // (Simple products only; variable products don't use the single sale field.)
    if (productType === 'simple' && formData.saleEndsAt) {
      const price = parseFloat(formData.price);
      const original = parseFloat(formData.originalPrice);
      if (!(original > price)) {
        alert('Set an Original Price higher than Price to use a sale countdown, or clear the "Sale ends at" field.');
        return;
      }
      if (new Date(formData.saleEndsAt).getTime() <= Date.now()) {
        alert('Sale end date must be in the future.');
        return;
      }
    }

    setSubmitting(true);

    try {
      // Build multipart/form-data so images travel with the product data
      const fd = new FormData();

      // ── Scalar fields ──────────────────────────────────────────────────
      fd.append('name',             formData.name);
      fd.append('description',      formData.description);
      fd.append('productType',      productType);
      fd.append('isActive',         String(formData.isActive));
      fd.append('isFeatured',       String(formData.isFeatured));
      fd.append('isFastMoving',     String(formData.isFastMoving));
      if (formData.shortDescription) fd.append('shortDescription', formData.shortDescription);
      if (formData.brand)            fd.append('brand',            formData.brand);
      if (formData.sku)              fd.append('sku',              formData.sku);

      if (productType === 'variable') {
        // Price + stock are derived from the models server-side.
        fd.append('variants', JSON.stringify(serializedVariants));
      } else {
        fd.append('price',          formData.price);
        fd.append('stock',          formData.stock);
        if (formData.originalPrice) fd.append('originalPrice', formData.originalPrice);
        // Sale countdown end — send as an absolute UTC instant so the server
        // doesn't reinterpret the admin's local wall-clock time.
        if (formData.saleEndsAt)    fd.append('saleEndsAt',   new Date(formData.saleEndsAt).toISOString());
      }

      // ── JSON-encoded arrays ────────────────────────────────────────────
      if (selectedCategories.length)  fd.append('categories',        JSON.stringify(selectedCategories));
      if (selectedVehicles.length)    fd.append('compatibleVehicles', JSON.stringify(selectedVehicles));
      if (features.filter(f => f.trim()).length) fd.append('features', JSON.stringify(features.filter(f => f.trim())));
      if (whyChoose.filter(w => w.trim()).length) fd.append('whyChoose', JSON.stringify(whyChoose.filter(w => w.trim())));
      if (packageContents.filter(p => p.trim()).length) fd.append('packageContents', JSON.stringify(packageContents.filter(p => p.trim())));
      const validSpecs = specifications.filter(s => s.key.trim() && s.value.trim());
      if (validSpecs.length)          fd.append('specifications',    JSON.stringify(validSpecs));

      const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t);
      if (tags.length) fd.append('tags', JSON.stringify(tags));

      // SEO overrides — always sent; backend trims/strips blanks so unset
      // fields fall back to values derived from the product.
      fd.append('seo', JSON.stringify(seo));

      // ── Image files ────────────────────────────────────────────────────
      images.forEach((file) => fd.append('images', file));

      // Raw multipart submit (apiClient can't send FormData without JSON-serializing).
      const res = await submitMultipart('/api/v1/products', 'POST', fd);
      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(errorMessage(res, data, 'Failed to create product'));

      // A new (featured) product may belong on the homepage's featured shelf.
      revalidateHome('home:products');
      alert('Product created successfully');
      router.push('/admin/products');
    } catch (err: any) {
      alert(err.message || 'Failed to create product');
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
          <h1 className="text-3xl font-bold">Add New Product</h1>
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
        <h1 className="text-3xl font-bold">Add New Product</h1>
      </div>
      
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6">
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
                variant="light"
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

            {/* Product type: simple (one price) vs variable (per-model prices). */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Product type</label>
              <div className="flex gap-2">
                {(['simple', 'variable'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setProductType(t)}
                    className={`px-4 py-2 rounded-lg text-sm border ${productType === t ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'}`}
                  >
                    {t === 'simple' ? 'Simple' : 'Variable (models)'}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {productType === 'variable'
                  ? 'Shoppers pick a model; each model has its own price + stock.'
                  : 'One price and stock for the whole product.'}
              </p>
            </div>

            {productType === 'simple' ? (
            <>
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
              <p className="mt-1 text-xs text-gray-500">
                Set higher than Price to run a sale (shown slashed). Leave blank for no sale.
              </p>
            </div>

            {/* Sale countdown — optional time-boxed sale. When it expires the
                sale price is dropped and the Original Price becomes live. */}
            <div className="mb-4">
              <label htmlFor="saleEndsAt" className="block text-sm font-medium text-gray-700 mb-1">
                Sale ends at (optional)
              </label>
              <input
                id="saleEndsAt"
                type="datetime-local"
                name="saleEndsAt"
                value={formData.saleEndsAt}
                onChange={handleInputChange}
                min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Shows a live countdown on the product page. When it ends, the sale price is
                removed and the Original Price becomes the live price. Requires an Original Price
                higher than Price.
              </p>
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
                <option value="backorder">On Backorder</option>
              </select>
            </div>
            </>
            ) : (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Models *</label>
              <VariantsEditor
                attributeName={attributeName}
                onAttributeNameChange={setAttributeName}
                variants={variants}
                onChange={setVariants}
              />
            </div>
            )}

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
            
            <div className="mb-4">
              <CategoryMultiSelect
                categories={categories}
                selected={selectedCategories}
                onChange={setSelectedCategories}
                loading={loading}
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tags (comma separated)
              </label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="e.g. fast, luxury, sedan"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Enter tags separated by commas. These help in search and filtering.
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
                  type="checkbox"
                  name="isFeatured"
                  checked={formData.isFeatured}
                  onChange={handleInputChange}
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">Mark as featured</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fast Moving Product
              </label>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  name="isFastMoving"
                  checked={formData.isFastMoving}
                  onChange={handleInputChange}
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">Mark as fast moving</span>
              </div>
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
                    placeholder="Reason (e.g. Durable construction – built for long-term use)"
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

          {/* Package Includes */}
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-1">Package Includes</h2>
            <p className="text-sm text-gray-500 mb-4">
              What&apos;s in the box — <strong>one item per box</strong> (a pointer, not a sentence). Shows as a bulleted list on the product page.
            </p>
            <div className="space-y-4">
              {packageContents.map((item, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="text"
                    value={item}
                    onChange={(e) => {
                      const next = [...packageContents];
                      next[index] = e.target.value;
                      setPackageContents(next);
                    }}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="e.g. 1 × Front Bumper Assembly"
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
                Add Item
              </button>
            </div>
          </div>

          {/* Images */}
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-4">Product Images</h2>
            <ImageUploader
              label="Upload product images"
              onFilesChange={(files) => setImages(files)}
              disabled={submitting}
            />
          </div>

          <SeoPanel
            value={seo}
            onChange={setSeo}
            defaults={{ title: formData.name, description: formData.shortDescription }}
          />
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
            {submitting ? 'Creating...' : 'Create Product'}
          </button>
        </div>
      </form>
    </div>
  );
}