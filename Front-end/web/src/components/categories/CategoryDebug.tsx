'use client';

import { useState, useEffect } from 'react';
import apiClient from '@/lib/api';
import { Category } from '@/lib/types';

export default function CategoryDebug() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        setLoading(true);
        const response = await apiClient.get<{ data?: Category[]; categories?: Category[] }>('/categories');
        setCategories(response.data || response.categories || []);
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
    return <div className="p-6">Loading categories...</div>;
  }

  if (error) {
    return <div className="p-6 text-red-500">Error: {error}</div>;
  }

  // Find specific categories
  const bodyKitsCategory = categories.find(cat => cat.slug === 'bodykit');
  const audioCategory = categories.find(cat => cat.slug === 'audio');
  const lightsCategory = categories.find(cat => cat.slug === 'lights');

  // Find child categories
  const childCategories = categories.filter(cat => cat.parent);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Category Debug Information</h1>
      
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Target Categories</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="border p-4 rounded">
            <h3 className="font-medium mb-2">Body Kits</h3>
            {bodyKitsCategory ? (
              <div>
                <p>ID: {bodyKitsCategory._id}</p>
                <p>Name: {bodyKitsCategory.name}</p>
                <p>Slug: {bodyKitsCategory.slug}</p>
                <p>Has Parent: {bodyKitsCategory.parent ? 'Yes' : 'No'}</p>
                {bodyKitsCategory.parent && <p>Parent ID: {typeof bodyKitsCategory.parent === 'string' ? bodyKitsCategory.parent : bodyKitsCategory.parent._id}</p>}
              </div>
            ) : (
              <p className="text-red-500">Not found</p>
            )}
          </div>
          
          <div className="border p-4 rounded">
            <h3 className="font-medium mb-2">Audio</h3>
            {audioCategory ? (
              <div>
                <p>ID: {audioCategory._id}</p>
                <p>Name: {audioCategory.name}</p>
                <p>Slug: {audioCategory.slug}</p>
                <p>Has Parent: {audioCategory.parent ? 'Yes' : 'No'}</p>
                {audioCategory.parent && <p>Parent ID: {typeof audioCategory.parent === 'string' ? audioCategory.parent : audioCategory.parent._id}</p>}
              </div>
            ) : (
              <p className="text-red-500">Not found</p>
            )}
          </div>
          
          <div className="border p-4 rounded">
            <h3 className="font-medium mb-2">Lights</h3>
            {lightsCategory ? (
              <div>
                <p>ID: {lightsCategory._id}</p>
                <p>Name: {lightsCategory.name}</p>
                <p>Slug: {lightsCategory.slug}</p>
                <p>Has Parent: {lightsCategory.parent ? 'Yes' : 'No'}</p>
                {lightsCategory.parent && <p>Parent ID: {typeof lightsCategory.parent === 'string' ? lightsCategory.parent : lightsCategory.parent._id}</p>}
              </div>
            ) : (
              <p className="text-red-500">Not found</p>
            )}
          </div>
        </div>
      </div>
      
      <div>
        <h2 className="text-xl font-semibold mb-4">Child Categories</h2>
        {childCategories.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {childCategories.map(category => (
              <div key={category._id} className="border p-4 rounded">
                <p className="font-medium">{category.name}</p>
                <p className="text-sm text-gray-600">ID: {category._id}</p>
                <p className="text-sm text-gray-600">Slug: {category.slug}</p>
                <p className="text-sm text-gray-600">Parent: {category.parent ? (typeof category.parent === 'string' ? category.parent : category.parent._id) : 'None'}</p>
              </div>
            ))}
          </div>
        ) : (
          <p>No child categories found</p>
        )}
      </div>
      
      <div className="mt-8">
        <h2 className="text-xl font-semibold mb-4">All Categories</h2>
        <pre className="bg-gray-100 p-4 rounded overflow-auto max-h-96">
          {JSON.stringify(categories, null, 2)}
        </pre>
      </div>
    </div>
  );
}