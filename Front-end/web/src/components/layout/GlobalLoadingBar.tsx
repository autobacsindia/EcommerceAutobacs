'use client';

import { useEffect, useState } from 'react';
import apiClient from '@/lib/api';

export default function GlobalLoadingBar() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const listener = (_isLoading: boolean, c: number) => {
      setCount(c);
    };
    (apiClient as any).addLoadingListener(listener);
    return () => {
      (apiClient as any).removeLoadingListener(listener);
    };
  }, []);

  return (
    <div className={`fixed top-0 left-0 right-0 z-50 transition-opacity ${count > 0 ? 'opacity-100' : 'opacity-0'}`}>
      <div className="h-1 w-full bg-blue-100">
        <div className="h-1 bg-blue-600 animate-pulse" style={{ width: '40%' }} />
      </div>
    </div>
  );
}
