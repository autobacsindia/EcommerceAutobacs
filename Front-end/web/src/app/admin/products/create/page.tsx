'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { ArrowLeft } from 'lucide-react';
import ImageUploader from '@/components/ui/ImageUploader';
import RichTextEditor from '@/components/ui/RichTextEditor';

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
  const [categorySearch, setCategorySearch] = useState('');
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);

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
  const [variableSpecs, setVariableSpecs] = useState<any[]>([]);
  const [features, setFeatures] = useState<string[]>(['']);
  const [packageContents, setPackageContents] = useState<string[]>(['']);
  const [qna, setQna] = useState<{question: string, answer: string}[]>([{ question: '', answer: '' }]);
  const [selectedVehicles, setSelectedVehicles] = useState<string[]>([]);

  useEffect(() => {
    fetchCategories();
    fetchVehicles();
    fetchBrands();
  }, []);

  const fetchCategories = async () => {
    try {
      const response = await apiClient.get<{ data?: Category[]; categories?: Category[] }>('/categories');
      setCategories(response.data || response.categories || []);
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    }
  };

  const fetchBrands = async () => {
    try {
      const response = await apiClient.get<{ data?: Brand[]; brands?: Brand[] }>('/brands?limit=500');
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
    setSubmitting(true);
    
    try {
      const validQna = qna.filter(item => item.question.trim() !== '' && item.answer.trim() !== '');

      // Build multipart/form-data so images travel with the product data
      const fd = new FormData();

      // ── Scalar fields ──────────────────────────────────────────────────
      fd.append('name',             formData.name);
      fd.append('description',      formData.description);
      fd.append('price',            formData.price);
      fd.append('stock',            formData.stock);
      fd.append('isActive',         String(formData.isActive));
      fd.append('isFeatured',       String(formData.isFeatured));
      fd.append('isFastMoving',     String(formData.isFastMoving));
      if (formData.shortDescription) fd.append('shortDescription', formData.shortDescription);
      if (formData.originalPrice)    fd.append('originalPrice',    formData.originalPrice);
      if (formData.brand)            fd.append('brand',            formData.brand);
      if (formData.sku)              fd.append('sku',              formData.sku);

      // ── JSON-encoded arrays ────────────────────────────────────────────
      if (selectedCategories.length)  fd.append('categories',        JSON.stringify(selectedCategories));
      if (selectedVehicles.length)    fd.append('compatibleVehicles', JSON.stringify(selectedVehicles));
      if (variableSpecs.length)       fd.append('variableSpecs',     JSON.stringify(variableSpecs));
      if (features.filter(f => f).length) fd.append('features', JSON.stringify(features.filter(f => f)));
      if (packageContents.filter(p => p).length) fd.append('packageContents', JSON.stringify(packageContents.filter(p => p)));
      if (validQna.length)            fd.append('qna',              JSON.stringify(validQna));

      const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t);
      if (tags.length) fd.append('tags', JSON.stringify(tags));

      // ── Image files ────────────────────────────────────────────────────
      images.forEach((file) => fd.append('images', file));

      // Use raw fetch so we can send multipart without apiClient JSON serialization
      const token = typeof window !== 'undefined'
        ? document.cookie.match(/(?:^|;\s*)token=([^;]*)/)?.[1] ?? ''
        : '';
      const csrfToken = typeof window !== 'undefined'
        ? document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/)?.[1] ?? ''
        : '';

      const res = await fetch('/api/v1/products', {
        method: 'POST',
        headers: {
          ...(token      ? { Authorization: `Bearer ${token}` } : {}),
          ...(csrfToken  ? { 'X-XSRF-TOKEN': decodeURIComponent(csrfToken) } : {}),
        },
        credentials: 'include',
        body: fd,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to create product');

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
            
            <div className="mb-4 relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Categories
              </label>
              <div 
                className="w-full px-3 py-2 border border-gray-300 rounded-md cursor-pointer bg-white min-h-10.5"
                onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)}
              >
                {selectedCategories.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {selectedCategories.map(catId => {
                      const cat = categories.find(c => c._id === catId);
                      return (
                        <span key={catId} className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full flex items-center">
                          {cat?.name || 'Unknown'}
                          <button 
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCategories(prev => prev.filter(id => id !== catId));
                            }}
                            className="ml-1 text-blue-600 hover:text-blue-800"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <span className="text-gray-400">Select categories...</span>
                )}
              </div>
              
              {isCategoryDropdownOpen && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  <div className="p-2 border-b sticky top-0 bg-white">
                    <input
                      type="text"
                      placeholder="Search categories..."
                      className="w-full px-2 py-1 border rounded text-sm"
                      value={categorySearch}
                      onChange={(e) => setCategorySearch(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  {categories
                    .filter(cat => cat.name.toLowerCase().includes(categorySearch.toLowerCase()))
                    .map(category => (
                    <div 
                      key={category._id}
                      className="px-3 py-2 hover:bg-gray-100 cursor-pointer flex items-center"
                      onClick={() => {
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
                        className="mr-2"
                      />
                      <span>{category.name}</span>
                    </div>
                  ))}
                  {categories.filter(cat => cat.name.toLowerCase().includes(categorySearch.toLowerCase())).length === 0 && (
                    <div className="px-3 py-2 text-gray-500 text-sm">No categories found</div>
                  )}
                </div>
              )}
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
                  placeholder="Search make, model, year or variant…"
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
                        return `${v.make} ${v.model} ${v.year} ${v.variant ?? ''}`.toLowerCase().includes(q);
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
                            {vehicle.make} {vehicle.model} ({vehicle.year}) {vehicle.variant ? `- ${vehicle.variant}` : ''}
                          </label>
                        </div>
                      ))}
                  </div>
                </div>
              </>
            )}
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
                      {spec.options.map((opt: any, oi: number) => (
                        <div key={oi} className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                          <div className="md:col-span-2 flex justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                const v = [...variableSpecs];
                                const opts = [...v[si].options];
                                v[si] = { ...v[si], options: opts.filter((_, idx) => idx !== oi) };
                                setVariableSpecs(v);
                              }}
                              className="px-3 py-2 border rounded-md"
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

          {/* Images */}
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-4">Product Images</h2>
            <ImageUploader
              label="Upload product images (JPG, PNG, WebP · max 5 MB each)"
              maxFiles={10}
              onFilesChange={(files) => setImages(files)}
              disabled={submitting}
            />
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
            {submitting ? 'Creating...' : 'Create Product'}
          </button>
        </div>
      </form>
    </div>
  );
}