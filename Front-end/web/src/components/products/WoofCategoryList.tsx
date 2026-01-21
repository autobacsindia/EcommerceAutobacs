'use client';

import { useState, useEffect } from 'react';
import apiClient from '@/lib/api';

interface Category {
  _id: string;
  name: string;
  slug: string;
  parent?: string | null;
  children?: Category[];
}

interface WoofCategoryListProps {
  selectedCategories: string[];
  onCategoryChange: (selected: string[]) => void;
}

export default function WoofCategoryList({ selectedCategories, onCategoryChange }: WoofCategoryListProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        setLoading(true);
        const response = await apiClient.get('/categories');
        const allCategories = response.data || response.categories || [];
        
        // Build hierarchical structure
        const topLevelCategories = allCategories.filter((cat: Category) => !cat.parent);
        const subCategories = allCategories.filter((cat: Category) => cat.parent);
        
        // Attach children to parents
        const categoriesWithChildren = topLevelCategories.map((cat: Category) => ({
          ...cat,
          children: subCategories.filter((subCat: Category) => subCat.parent === cat._id)
        }));
        
        setCategories(categoriesWithChildren);
      } catch (err) {
        console.error('Failed to fetch categories:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCategories();
  }, []);

  const toggleCategory = (categoryId: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId);
    } else {
      newExpanded.add(categoryId);
    }
    setExpandedCategories(newExpanded);
  };

  const handleCategoryToggle = (categoryId: string) => {
    const newSelected = selectedCategories.includes(categoryId)
      ? selectedCategories.filter(id => id !== categoryId)
      : [...selectedCategories, categoryId];
    
    onCategoryChange(newSelected);
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, index) => (
          <div key={index} className="flex items-center animate-pulse">
            <div className="h-4 w-4 bg-gray-200 rounded mr-2"></div>
            <div className="h-4 w-3/4 bg-gray-200 rounded"></div>
          </div>
        ))}
      </div>
    );
  }

  const renderCategory = (category: Category, level = 0, index?: number) => {
    const hasChildren = category.children && category.children.length > 0;
    const isExpanded = expandedCategories.has(category._id);
    const isChecked = selectedCategories.includes(category._id);
    
    return (
      <li key={category._id || index} className={`${level === 0 ? 'woof_list_item' : 'woof_childs_list_item'} woof_list_item_${category._id}`}>
        <div className="woof_list_item_container">
          <input 
            type="checkbox" 
            className="woof_checkbox_checkbox" 
            id={`woof_checkbox_${category._id}`} 
            data-tax="product_cat" 
            data-name={category.name} 
            data-value={category._id} 
            checked={isChecked}
            onChange={() => handleCategoryToggle(category._id)}
          />
          <label className="woof_checkbox_label" htmlFor={`woof_checkbox_${category._id}`}>
            {hasChildren && (
              <span 
                className="woof_span_tagger woof_span_tagger_close" 
                onClick={() => toggleCategory(category._id)}
              >
                {isExpanded ? '-' : '+'}
              </span>
            )}
            <span className="woof_name_option">{category.name}</span>
          </label>
        </div>
        
        {hasChildren && isExpanded && (
          <ul className={`woof_childs_list woof_childs_list_${category._id}`}>
            {category.children!.map((child, idx) => renderCategory(child, level + 1, idx))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="woof_container_overlay">
      <ul className="woof_list woof_list_checkbox">
        {categories.map((category, idx) => renderCategory(category, 0, idx))}
      </ul>
    </div>
  );
}