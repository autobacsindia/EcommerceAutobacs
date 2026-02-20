'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import apiClient from '@/lib/api';
import { ArrowLeft, Upload } from 'lucide-react';

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
  description: string;
  shortDescription: string;
  price: number;
  originalPrice: number;
  category?: string; // Keep for backward compatibility if needed, but we'll use categories
  categories?: string[] | Category[];
  brand: string;
  stock: number;
  sku: string;
  isFeatured: boolean;
  isOfferFeatured?: boolean;
  offerStartDate?: string;
  offerEndDate?: string;
  isActive: boolean;
  images: { url: string; alt: string; isPrimary: boolean }[];
  features?: string[];
  packageContents?: string[];
  variableSpecs?: Array<{ key: string; options: Array<{ label: string; price: number }> }>;
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
  
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [existingImages, setExistingImages] = useState<{ url: string; alt: string; isPrimary: boolean }[]>([]);
  const [variableSpecs, setVariableSpecs] = useState<Array<{ key: string; options: Array<{ label: string; price: number }> }>>([]);
  const [features, setFeatures] = useState<string[]>([]);
  const [packageContents, setPackageContents] = useState<string[]>([]);
  const [qna, setQna] = useState<{ question: string; answer: string }[]>([]);
  const [selectedVehicles, setSelectedVehicles] = useState<string[]>([]);

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
      const response: any = await apiClient.get(`/products/${productId}?t=${Date.now()}`);
      const productData = response.product;
      
      setProduct(productData);
      setExistingImages(productData.images || []);
      setVariableSpecs(productData.variableSpecs || []);
      setFeatures(productData.features || []);
      setPackageContents(productData.packageContents || []);
      setQna(productData.qna || []);
      
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
        // category: productData.category?._id || productData.category || '', // Handled by selectedCategories
        brand: productData.brand || '',
        stock: productData.stock?.toString() || '',
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
      }

      // Handle tags
      if (productData.tags && Array.isArray(productData.tags)) {
        setTagsInput(productData.tags.join(', '));
      }
    } catch (err) {
      console.error('Failed to fetch product:', err);
      alert('Failed to load product');
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

  const removeExistingImage = (index: number) => {
    setExistingImages(prev => prev.filter((_, i) => i !== index));
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
    
    try {
      const validQna = qna.filter(item => item.question.trim() !== '' && item.answer.trim() !== '');
      
      const productData = {
        ...formData,
        price: parseFloat(formData.price),
        originalPrice: formData.originalPrice ? parseFloat(formData.originalPrice) : undefined,
        stock: parseInt(formData.stock),
        // category: formData.category || undefined, // Replaced by categories
        categories: selectedCategories, // Send array directly, even if empty
        tags: tagsInput.split(',').map(t => t.trim()).filter(Boolean),
        offerStartDate: formData.offerStartDate || null,
        offerEndDate: formData.offerEndDate || null,
        // In a real implementation, we would handle image uploads
        // For now, we'll just send existing images
        images: existingImages,
        variableSpecs: variableSpecs.length > 0 ? variableSpecs : undefined,
        compatibleVehicles: selectedVehicles.length > 0 ? selectedVehicles : undefined,
        features: features.length > 0 ? features : undefined,
        packageContents: packageContents.length > 0 ? packageContents : undefined,
        qna: validQna.length > 0 ? validQna : undefined,
      };
      
      // Remove empty fields
      Object.keys(productData).forEach(key => {
        if (productData[key as keyof typeof productData] === '') {
          delete productData[key as keyof typeof productData];
        }
      });
      
      await apiClient.put(`/products/${productId}`, productData);
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
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                Description *
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                required
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                Stock Quantity *
              </label>
              <input
                id="stock"
                type="number"
                name="stock"
                value={formData.stock}
                onChange={handleInputChange}
                required
                min="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
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
                className="w-full px-3 py-2 border border-gray-300 rounded-md cursor-pointer bg-white min-h-[42px] flex items-center flex-wrap gap-1"
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
                <div className="absolute z-[100] w-full mt-1 bg-white border border-gray-300 rounded-md shadow-2xl max-h-60 overflow-y-auto p-2">
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
            
            {/* Existing Images */}
            {existingImages.length > 0 && (
              <div className="mb-6">
                <h3 className="text-lg font-medium mb-3">Existing Images</h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
                  {existingImages.map((image, index) => (
                    <div key={index} className="relative group">
                      <img 
                        src={image.url} 
                        alt={image.alt || `Product image ${index + 1}`} 
                        className="h-24 w-full object-cover rounded-md"
                      />
                      <button
                        type="button"
                        onClick={() => removeExistingImage(index)}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                      {image.isPrimary && (
                        <div className="absolute bottom-1 left-1 bg-blue-500 text-white text-xs px-1 rounded">
                          Primary
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Add New Images */}
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <Upload className="mx-auto h-12 w-12 text-gray-400" />
              <div className="mt-4">
                <label htmlFor="image-upload" className="cursor-pointer bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700">
                  Add Images
                </label>
                <input
                  id="image-upload"
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleImageChange}
                  className="hidden"
                />
                <p className="mt-2 text-sm text-gray-500">
                  PNG, JPG, GIF up to 10MB
                </p>
              </div>
              
              {imagePreviews.length > 0 && (
                <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
                  {imagePreviews.map((preview, index) => (
                    <div key={index} className="relative">
                      <img 
                        src={preview} 
                        alt={`Preview ${index}`} 
                        className="h-24 w-full object-cover rounded-md"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
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
    </div>
  );
}
