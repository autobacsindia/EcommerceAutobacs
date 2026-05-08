'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ShoppingCart, Plus, ArrowRight, Check } from 'lucide-react';
import { motion } from 'framer-motion';
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
  isDark?: boolean;
}

export default function BundleSection({ productId, mainProductName, mainProductPrice, isDark = true }: BundleSectionProps) {
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
      <section className="bg-zinc-800/50 border border-zinc-700 rounded-2xl p-6 animate-pulse">
        <div className="h-6 bg-zinc-700 rounded w-1/3 mb-4" />
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-zinc-700 rounded" />
          ))}
        </div>
      </section>
    );
  }

  if (products.length === 0) {
    return null;
  }

  return (
    <section className="bg-zinc-800/50 border border-zinc-700 rounded-2xl p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">
            Complete Off-Road Lighting Setup
          </h2>
          <p className="text-zinc-400 mt-2">
            Frequently bought together by Indian off-road enthusiasts
          </p>
        </div>
        <button
          onClick={selectAll}
          className="text-sm text-orange-500 hover:text-orange-400 font-semibold"
        >
          {selectedItems.size === products.length ? 'Deselect All' : 'Select All'}
        </button>
      </div>

      {/* Main Product */}
      <div className="flex items-center gap-4 pb-6 mb-6 border-b border-zinc-700">
        <div className="w-5 h-5 rounded border-orange-500 bg-orange-500 flex items-center justify-center">
          <Check className="w-3 h-3 text-white" />
        </div>
        <span className="flex-1 text-base font-semibold text-white line-clamp-1">
          {mainProductName}
        </span>
        <span className="font-bold text-white text-lg">
          ₹{mainProductPrice.toLocaleString('en-IN')}
        </span>
      </div>

      {/* Arrow connector */}
      <div className="flex justify-center mb-6">
        <ArrowRight className="w-6 h-6 text-orange-500 rotate-90" />
      </div>

      {/* Bundle Items */}
      <div className="space-y-4 mb-6">
        {products.map((product, index) => (
          <motion.div
            key={product._id}
            whileHover={{ scale: 1.01 }}
            className="flex items-center gap-4 bg-zinc-700/50 border border-zinc-600 rounded-xl p-4 cursor-pointer hover:border-orange-500/50 transition-all"
            onClick={() => toggleItem(product._id)}
          >
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
              selectedItems.has(product._id)
                ? 'border-orange-500 bg-orange-500'
                : 'border-zinc-500'
            }`}>
              {selectedItems.has(product._id) && <Check className="w-3 h-3 text-white" />}
            </div>
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
                className="text-base font-semibold text-white hover:text-orange-500 line-clamp-2 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                {product.name}
              </Link>
              <p className="text-base font-bold text-orange-500 mt-1">
                ₹{product.price.toLocaleString('en-IN')}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Total Price & CTA */}
      {selectedItems.size > 0 && (
        <div className="space-y-4 pt-6 border-t border-zinc-700">
          <div className="flex items-center justify-between">
            <span className="text-zinc-300 font-semibold">
              Bundle Items ({selectedProducts.length})
            </span>
            <span className="text-xl font-bold text-orange-500">
              + ₹{bundlePrice.toLocaleString('en-IN')}
            </span>
          </div>
          <div className="bg-zinc-900/80 border border-orange-500/30 rounded-xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-zinc-400 text-sm mb-1">Complete Setup Total</p>
                <p className="text-4xl font-black text-white">
                  ₹{totalPrice.toLocaleString('en-IN')}
                </p>
              </div>
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleAddBundleToCart}
                disabled={addingToCart}
                className="bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-700 text-white font-bold py-4 px-8 rounded-xl transition-all duration-200 flex items-center gap-3 text-lg shadow-lg shadow-orange-500/30"
              >
                <ShoppingCart className="w-6 h-6" />
                {addingToCart ? 'Adding...' : `Add ${selectedProducts.length + 1} to Cart`}
              </motion.button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
