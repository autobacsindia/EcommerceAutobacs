'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { Category } from '@/lib/types';
import EnhancedImage from '@/components/layout/EnhancedImage';

interface HierarchicalCategoryViewProps {
  categories: Category[];
}

interface CategoryNode {
  category: Category;
  children: CategoryNode[];
}

export default function HierarchicalCategoryView({ categories }: HierarchicalCategoryViewProps) {
  // Build hierarchical structure
  const buildCategoryTree = (categories: Category[]): CategoryNode[] => {
    // Create a map of all categories by ID
    const categoryMap = new Map<string, Category>();
    categories.forEach(cat => categoryMap.set(cat._id, cat));
    
    // Create a map for category nodes
    const nodeMap = new Map<string, CategoryNode>();
    
    // Initialize all nodes
    categories.forEach(cat => {
      nodeMap.set(cat._id, {
        category: cat,
        children: []
      });
    });
    
    // Build the tree structure
    const roots: CategoryNode[] = [];
    
    categories.forEach(cat => {
      const node = nodeMap.get(cat._id)!;
      
      // If category has a parent and parent exists, add to parent's children
      if (cat.parent && typeof cat.parent === 'string' && nodeMap.has(cat.parent)) {
        const parentNode = nodeMap.get(cat.parent)!;
        parentNode.children.push(node);
      } else {
        // Otherwise, it's a root category
        roots.push(node);
      }
    });
    
    // Sort children by order field
    const sortChildren = (node: CategoryNode) => {
      node.children.sort((a, b) => (a.category.order || 0) - (b.category.order || 0));
      node.children.forEach(sortChildren);
    };
    
    roots.forEach(sortChildren);
    
    return roots;
  };

  const categoryTree = buildCategoryTree(categories);

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="p-6 border-b border-gray-200">
        <h2 className="text-xl font-semibold text-gray-900">Categories</h2>
        <p className="text-gray-600 mt-1">Browse products by category</p>
      </div>
      
      <div className="divide-y divide-gray-100">
        {categoryTree.length > 0 ? (
          categoryTree.map((node) => (
            <CategoryTreeNode 
              key={node.category._id} 
              node={node} 
              level={0} 
            />
          ))
        ) : (
          <div className="p-6 text-center text-gray-500">
            No categories available
          </div>
        )}
      </div>
    </div>
  );
}

interface CategoryTreeNodeProps {
  node: CategoryNode;
  level: number;
}

function CategoryTreeNode({ node, level }: CategoryTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  
  return (
    <div>
      <div 
        className={`flex items-center p-4 hover:bg-gray-50 cursor-pointer ${
          level > 0 ? `pl-${Math.min(16, 4 + level * 4)}` : ''
        }`}
        onClick={() => hasChildren && setIsExpanded(!isExpanded)}
      >
        {hasChildren ? (
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="mr-2 text-gray-500 hover:text-gray-700"
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <ChevronDown className="h-5 w-5" />
            ) : (
              <ChevronRight className="h-5 w-5" />
            )}
          </button>
        ) : (
          <div className="w-6 mr-2" /> // Spacer for alignment
        )}
        
        <div className="flex-shrink-0 mr-3">
          {node.category.image?.url ? (
            <EnhancedImage
              src={node.category.image.url}
              alt={node.category.image.alt || node.category.name}
              width={40}
              height={40}
              className="rounded-md object-cover"
              context="category"
            />
          ) : (
            <div className="bg-gray-200 border-2 border-dashed rounded-md w-10 h-10 flex items-center justify-center">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
              </svg>
            </div>
          )}
        </div>
        
        <div className="flex-1 min-w-0">
          <Link 
            href={`/products?category=${node.category._id}`}
            className="block"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-medium text-gray-900 truncate hover:text-blue-600">
              {node.category.name}
            </h3>
            {node.category.description && (
              <p className="text-sm text-gray-500 truncate mt-1">
                {node.category.description}
              </p>
            )}
          </Link>
        </div>
        
        <div className="ml-2">
          <Link 
            href={`/products?category=${node.category._id}`}
            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
            onClick={(e) => e.stopPropagation()}
          >
            View
          </Link>
        </div>
      </div>
      
      {hasChildren && isExpanded && (
        <div className="bg-gray-50 divide-y divide-gray-100">
          {node.children.map((childNode) => (
            <CategoryTreeNode 
              key={childNode.category._id} 
              node={childNode} 
              level={level + 1} 
            />
          ))}
        </div>
      )}
    </div>
  );
}