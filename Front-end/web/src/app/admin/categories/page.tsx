'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Edit, Trash2, Eye, FolderOpen } from 'lucide-react';
import apiClient from '@/lib/api';

// Define the Category interface inline to avoid import issues
interface Category {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  parent?: any;
  image?: {
    url: string;
    alt?: string;
  };
  isActive: boolean;
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCategories();
  }, []);

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

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this category?')) {
      return;
    }

    try {
      await apiClient.delete(`/categories/${id}`);
      // Refresh the list
      fetchCategories();
    } catch (err) {
      console.error('Failed to delete category:', err);
      alert('Failed to delete category. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Categories</h1>
          <div className="h-10 w-32 bg-gray-200 rounded animate-pulse"></div>
        </div>
        
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="divide-y divide-gray-200">
            {[...Array(5)].map((_, index) => (
              <div key={index} className="p-4 animate-pulse">
                <div className="flex items-center justify-between">
                  <div className="h-6 w-1/4 bg-gray-200 rounded"></div>
                  <div className="flex space-x-2">
                    <div className="h-8 w-8 bg-gray-200 rounded"></div>
                    <div className="h-8 w-8 bg-gray-200 rounded"></div>
                    <div className="h-8 w-8 bg-gray-200 rounded"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Categories</h1>
          <Link 
            href="/admin/categories/create"
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center"
          >
            <Plus className="h-5 w-5 mr-2" />
            Add Category
          </Link>
        </div>
        
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">{error}</p>
          <button 
            onClick={fetchCategories}
            className="mt-2 bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Categories</h1>
        <Link 
          href="/admin/categories/create"
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center"
        >
          <Plus className="h-5 w-5 mr-2" />
          Add Category
        </Link>
      </div>
      
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        {categories.length === 0 ? (
          <div className="p-8 text-center">
            <FolderOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No categories found</h3>
            <p className="text-gray-500 mb-4">Get started by creating a new category.</p>
            <Link 
              href="/admin/categories/create"
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
            >
              Create Category
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {categories.map((category) => (
              <div key={category._id} className="p-4 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    {category.image?.url ? (
                      <img 
                        src={category.image.url} 
                        alt={category.image.alt || category.name} 
                        className="h-12 w-12 rounded-md object-cover mr-4"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-md bg-gray-200 flex items-center justify-center mr-4">
                        <FolderOpen className="h-6 w-6 text-gray-500" />
                      </div>
                    )}
                    <div>
                      <h3 className="text-lg font-medium text-gray-900">{category.name === 'Suspension' ? 'SUSPENSION' : category.name}</h3>
                      {category.description && (
                        <p className="text-gray-500 text-sm mt-1">{category.description}</p>
                      )}
                      <div className="flex items-center mt-1">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          category.isActive 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {category.isActive ? 'Active' : 'Inactive'}
                        </span>
                        <span className="ml-2 text-xs text-gray-500">
                          Order: {category.order}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <Link 
                      href={`/categories/${category._id}`}
                      className="p-2 text-gray-500 hover:text-gray-700"
                      title="View"
                    >
                      <Eye className="h-5 w-5" />
                    </Link>
                    <Link 
                      href={`/admin/categories/edit/${category._id}`}
                      className="p-2 text-gray-500 hover:text-gray-700"
                      title="Edit"
                    >
                      <Edit className="h-5 w-5" />
                    </Link>
                    <button 
                      onClick={() => handleDelete(category._id)}
                      className="p-2 text-gray-500 hover:text-red-600"
                      title="Delete"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}