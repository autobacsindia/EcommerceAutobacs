'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import SkeletonLoader from './SkeletonLoader';

// Dynamically import SearchSuggestions with SSR disabled
const SearchSuggestions = dynamic(
  () => import('./SearchSuggestions'),
  { 
    ssr: false,
    loading: () => <SkeletonLoader type="search" />
  }
);

export default function ClientSearchSuggestions() {
  const [showSearch, setShowSearch] = useState(true);
  
  return (
    <div className="w-full">
      {showSearch && <SearchSuggestions />}
    </div>
  );
}