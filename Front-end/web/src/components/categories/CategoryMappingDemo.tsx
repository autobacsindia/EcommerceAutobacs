'use client';

import { useState, useEffect } from 'react';
import apiClient from '@/lib/api';
import { Category } from '@/lib/types';
import { findCategoryFlexible, getCategoryHierarchy } from '@/lib/categoryMapping';
import CategoryCard from '@/components/categories/CategoryCard';

export default function CategoryMappingDemo() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        setLoading(true);
        const response: any = await apiClient.get('/categories');
        setCategories(response.categories || []);
      } catch (err) {
        console.error('Failed to fetch categories:', err);
        setError('Failed to load categories. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchCategories();
  }, []);

  if (loading) {
    return <div>Loading categories...</div>;
  }

  if (error) {
    return <div>Error: {error}</div>;
  }

  // Demonstrate category mapping
  const accessoriesCategory = findCategoryFlexible('accessories', categories);
  const exteriorCategory = findCategoryFlexible('exterior', categories);
  const bodyKitCategory = findCategoryFlexible('body kit', categories);
  const lightingCategory = findCategoryFlexible('lighting', categories);
  
  const hierarchy = getCategoryHierarchy(categories);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Category Mapping Demo</h1>
      
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Direct Category Lookups</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {accessoriesCategory && (
            <div className="border p-4 rounded">
              <h3 className="font-medium mb-2">Accessories</h3>
              <CategoryCard category={accessoriesCategory} />
            </div>
          )}
          {exteriorCategory && (
            <div className="border p-4 rounded">
              <h3 className="font-medium mb-2">Exterior</h3>
              <CategoryCard category={exteriorCategory} />
            </div>
          )}
          {bodyKitCategory && (
            <div className="border p-4 rounded">
              <h3 className="font-medium mb-2">Body Kit</h3>
              <CategoryCard category={bodyKitCategory} />
            </div>
          )}
          {lightingCategory && (
            <div className="border p-4 rounded">
              <h3 className="font-medium mb-2">Lighting</h3>
              <CategoryCard category={lightingCategory} />
            </div>
          )}
        </div>
      </div>
      
      <div>
        <h2 className="text-xl font-semibold mb-4">Category Hierarchy</h2>
        <pre className="bg-gray-100 p-4 rounded overflow-auto">
          {JSON.stringify(hierarchy, null, 2)}
        </pre>
      </div>
    </div>
  );
}