'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ShoppingCart, Plus } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { toast } from 'react-hot-toast';
import apiClient from '@/lib/api';

interface Product {
  _id: string;
  name: string;
  slug: string;
  price: number;
  originalPrice?: number;
  images?: Array<{ url: string; alt?: string }>;
}

interface BundleSectionProps {
  productId: string;
  mainProductName: string;
  mainProductPrice: number;
}

export default function BundleSection({ productId, mainProductName, mainProductPrice }: BundleSectionProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const { addToCart } = useCart();
  const [addingToCart, setAddingToCart] = useState(false);

  useEffect(() => {
    const fetchComplementaryProducts = async () => {
      try {
        setLoading(true);
        const response: any = await apiClient.get(`/products/${productId}/complementary?limit=3`);
        
        if (response.success && Array.isArray(response.products)) {
          setProducts(response.products);
        }
      } catch (err) {
        console.error('[BundleSection] Fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    if (productId) {
      fetchComplementaryProducts();
    }
  }, [productId]);

  const toggleItem = (productId: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(productId)) {
      newSelected.delete(productId);
    } else {
      newSelected.add(productId);
    }
    setSelectedItems(newSelected);
  };

  const selectAll = () => {
    if (selectedItems.size === products.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(products.map(p => p._id)));
    }
  };

  const selectedProducts = products.filter(p => selectedItems.has(p._id));
  const bundlePrice = selectedProducts.reduce((sum, p) => sum + p.price, 0);
  const totalPrice = mainProductPrice + bundlePrice;

  const handleAddBundleToCart = async () => {
    if (selectedProducts.length === 0) {
      toast.error('Please select at least one item');
      return;
    }

    setAddingToCart(true);
    try {
      // Add main product
      await addToCart(productId, 1);
      
      // Add selected bundle items
      for (const product of selectedProducts) {
        await addToCart(product._id, 1);
      }
      
      toast.success(`Added ${selectedProducts.length + 1} item(s) to cart!`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to add items to cart');
    } finally {
      setAddingToCart(false);
    }
  };

  if (loading) {
    return (
      <section className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-2xl p-6 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/3 mb-4" />
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-200 rounded" />
          ))}
        </div>
      </section>
    );
  }

  if (products.length === 0) {
    return null;
  }

  return (
    <section className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            Frequently Bought Together
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Complete your setup with these essentials
          </p>
        </div>
        <button
          onClick={selectAll}
          className="text-sm text-blue-600 hover:text-blue-700 font-medium"
        >
          {selectedItems.size === products.length ? 'Deselect All' : 'Select All'}
        </button>
      </div>

      {/* Main Product */}
      <div className="flex items-center gap-3 pb-4 mb-4 border-b border-orange-200">
        <input
          type="checkbox"
          checked={true}
          disabled
          className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="flex-1 text-sm font-medium text-gray-900 line-clamp-1">
          {mainProductName}
        </span>
        <span className="font-bold text-gray-900">
          ₹{mainProductPrice.toLocaleString('en-IN')}
        </span>
      </div>

      {/* Bundle Items */}
      <div className="space-y-3 mb-4">
        {products.map((product) => (
          <div
            key={product._id}
            className="flex items-center gap-3 bg-white rounded-lg p-3 cursor-pointer hover:bg-orange-50 transition-colors"
            onClick={() => toggleItem(product._id)}
          >
            <input
              type="checkbox"
              checked={selectedItems.has(product._id)}
              onChange={() => toggleItem(product._id)}
              className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div className="relative w-16 h-16 flex-shrink-0 bg-gray-50 rounded-lg overflow-hidden">
              <Image
                src={product.images?.[0]?.url || '/placeholder-product.jpg'}
                alt={product.images?.[0]?.alt || product.name}
                fill
                className="object-contain p-1"
                sizes="64px"
              />
            </div>
            <div className="flex-1 min-w-0">
              <Link
                href={`/products/${product.slug}`}
                className="text-sm font-medium text-gray-900 hover:text-blue-600 line-clamp-2"
                onClick={(e) => e.stopPropagation()}
              >
                {product.name}
              </Link>
              <p className="text-sm font-bold text-gray-900 mt-1">
                ₹{product.price.toLocaleString('en-IN')}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Total Price & CTA */}
      {selectedItems.size > 0 && (
        <div className="space-y-3 pt-4 border-t border-orange-200">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">
              Selected Items ({selectedProducts.length})
            </span>
            <span className="text-lg font-bold text-gray-900">
              + ₹{bundlePrice.toLocaleString('en-IN')}
            </span>
          </div>
          <div className="flex items-center justify-between bg-white rounded-lg p-3">
            <div>
              <p className="text-xs text-gray-600">Total Price</p>
              <p className="text-2xl font-bold text-gray-900">
                ₹{totalPrice.toLocaleString('en-IN')}
              </p>
            </div>
            <button
              onClick={handleAddBundleToCart}
              disabled={addingToCart}
              className="bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 flex items-center gap-2 disabled:opacity-50 active:scale-95"
            >
              <ShoppingCart className="w-5 h-5" />
              {addingToCart ? 'Adding...' : `Add ${selectedProducts.length + 1} to Cart`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
