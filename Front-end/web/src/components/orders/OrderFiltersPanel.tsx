'use client';

import { useState, useEffect } from 'react';
import { Search, X, Filter, Calendar } from 'lucide-react';
import { ORDER_STATUS_LABELS } from '@/lib/constants';

export interface OrderFilters {
  search: string;
  statuses: string[];
  startDate: string;
  endDate: string;
  minAmount: string;
  maxAmount: string;
  customer: string;
}

interface OrderFiltersPanelProps {
  filters: OrderFilters;
  onFiltersChange: (filters: OrderFilters) => void;
  onApply?: () => void;
  autoApply?: boolean;
}

const QUICK_FILTERS = [
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'week' },
  { label: 'This Month', value: 'month' },
  { label: 'Pending', value: 'pending' },
  { label: 'High Value (>₹10k)', value: 'high_value' },
];

export default function OrderFiltersPanel({
  filters,
  onFiltersChange,
  onApply,
  autoApply = true,
}: OrderFiltersPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [localFilters, setLocalFilters] = useState<OrderFilters>(filters);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);

  // Sync local filters with prop changes
  useEffect(() => {
    setLocalFilters(filters);
  }, [filters]);

  const handleFilterChange = (key: keyof OrderFilters, value: any) => {
    const newFilters = { ...localFilters, [key]: value };
    setLocalFilters(newFilters);
    
    if (autoApply) {
      onFiltersChange(newFilters);
    }
  };

  const handleStatusToggle = (status: string) => {
    const currentStatuses = localFilters.statuses || [];
    const newStatuses = currentStatuses.includes(status)
      ? currentStatuses.filter(s => s !== status)
      : [...currentStatuses, status];
    
    handleFilterChange('statuses', newStatuses);
  };

  const handleQuickFilter = (filterType: string) => {
    const today = new Date();
    let newFilters = { ...localFilters };

    switch (filterType) {
      case 'today':
        newFilters.startDate = today.toISOString().split('T')[0];
        newFilters.endDate = today.toISOString().split('T')[0];
        break;
      case 'week':
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        newFilters.startDate = weekAgo.toISOString().split('T')[0];
        newFilters.endDate = today.toISOString().split('T')[0];
        break;
      case 'month':
        const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
        newFilters.startDate = monthAgo.toISOString().split('T')[0];
        newFilters.endDate = today.toISOString().split('T')[0];
        break;
      case 'pending':
        newFilters.statuses = ['pending'];
        break;
      case 'high_value':
        newFilters.minAmount = '10000';
        break;
    }

    setLocalFilters(newFilters);
    onFiltersChange(newFilters);
  };

  const handleClearFilters = () => {
    const emptyFilters: OrderFilters = {
      search: '',
      statuses: [],
      startDate: '',
      endDate: '',
      minAmount: '',
      maxAmount: '',
      customer: '',
    };
    setLocalFilters(emptyFilters);
    onFiltersChange(emptyFilters);
  };

  const getActiveFilterCount = () => {
    let count = 0;
    if (localFilters.search) count++;
    if (localFilters.statuses.length > 0) count++;
    if (localFilters.startDate || localFilters.endDate) count++;
    if (localFilters.minAmount || localFilters.maxAmount) count++;
    if (localFilters.customer) count++;
    return count;
  };

  const activeCount = getActiveFilterCount();

  return (
    <div className="bg-obsidian rounded-lg shadow-sm border border-hairline mb-6">
      {/* Header */}
      <div className="p-4 border-b border-hairline flex items-center justify-between">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-ink/80 hover:text-ink font-medium"
        >
          <Filter className="h-5 w-5" />
          <span>Filters</span>
          {activeCount > 0 && (
            <span className="bg-gold text-obsidian text-xs px-2 py-0.5 rounded-full">
              {activeCount}
            </span>
          )}
        </button>
        
        <div className="flex items-center gap-2">
          {activeCount > 0 && (
            <button
              onClick={handleClearFilters}
              className="text-sm text-ink-muted hover:text-ink flex items-center gap-1"
            >
              <X className="h-4 w-4" />
              Clear All
            </button>
          )}
          {!autoApply && (
            <button
              onClick={() => {
                onFiltersChange(localFilters);
                onApply?.();
              }}
              className="bg-gold text-obsidian px-4 py-2 rounded-lg hover:bg-gold text-sm"
            >
              Apply Filters
            </button>
          )}
        </div>
      </div>

      {/* Quick Filters */}
      <div className="p-4 border-b border-hairline">
        <div className="flex flex-wrap gap-2">
          {QUICK_FILTERS.map((filter) => (
            <button
              key={filter.value}
              onClick={() => handleQuickFilter(filter.value)}
              className="px-3 py-1.5 bg-obsidian-raised hover:bg-obsidian-raised text-ink/80 text-sm rounded-lg transition"
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Filters - Collapsible */}
      {isExpanded && (
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Search by Order Number */}
          <div>
            <label className="block text-sm font-medium text-ink/80 mb-1">
              Order Number
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-ink-muted" />
              <input
                type="text"
                placeholder="Search order #..."
                value={localFilters.search}
                onChange={(e) => handleFilterChange('search', e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-hairline rounded-lg focus:ring-2 focus:ring-gold focus:border-transparent"
              />
            </div>
          </div>

          {/* Customer Search */}
          <div>
            <label className="block text-sm font-medium text-ink/80 mb-1">
              Customer
            </label>
            <input
              type="text"
              placeholder="Name or email..."
              value={localFilters.customer}
              onChange={(e) => handleFilterChange('customer', e.target.value)}
              className="w-full px-4 py-2 border border-hairline rounded-lg focus:ring-2 focus:ring-gold focus:border-transparent"
            />
          </div>

          {/* Status Multi-Select */}
          <div className="relative">
            <label className="block text-sm font-medium text-ink/80 mb-1">
              Status
            </label>
            <button
              onClick={() => setShowStatusDropdown(!showStatusDropdown)}
              className="w-full px-4 py-2 border border-hairline rounded-lg text-left flex items-center justify-between hover:border-gray-400"
            >
              <span className="text-ink/80">
                {localFilters.statuses.length === 0
                  ? 'All Statuses'
                  : `${localFilters.statuses.length} selected`}
              </span>
              <span className="text-ink-muted">▼</span>
            </button>
            
            {showStatusDropdown && (
              <div className="absolute z-10 mt-1 w-full bg-obsidian border border-hairline rounded-lg shadow-lg max-h-60 overflow-auto">
                {Object.entries(ORDER_STATUS_LABELS).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center px-4 py-2 hover:bg-obsidian-deep cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={localFilters.statuses.includes(key)}
                      onChange={() => handleStatusToggle(key)}
                      className="mr-3 h-4 w-4 text-gold rounded focus:ring-gold"
                    />
                    <span className="text-sm text-ink/80">{label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Date Range - Start */}
          <div>
            <label className="block text-sm font-medium text-ink/80 mb-1">
              From Date
            </label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-ink-muted" />
              <input
                type="date"
                value={localFilters.startDate}
                onChange={(e) => handleFilterChange('startDate', e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-hairline rounded-lg focus:ring-2 focus:ring-gold focus:border-transparent"
              />
            </div>
          </div>

          {/* Date Range - End */}
          <div>
            <label className="block text-sm font-medium text-ink/80 mb-1">
              To Date
            </label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-ink-muted" />
              <input
                type="date"
                value={localFilters.endDate}
                onChange={(e) => handleFilterChange('endDate', e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-hairline rounded-lg focus:ring-2 focus:ring-gold focus:border-transparent"
              />
            </div>
          </div>

          {/* Amount Range - Min */}
          <div>
            <label className="block text-sm font-medium text-ink/80 mb-1">
              Min Amount (₹)
            </label>
            <input
              type="number"
              placeholder="0"
              value={localFilters.minAmount}
              onChange={(e) => handleFilterChange('minAmount', e.target.value)}
              className="w-full px-4 py-2 border border-hairline rounded-lg focus:ring-2 focus:ring-gold focus:border-transparent"
            />
          </div>

          {/* Amount Range - Max */}
          <div>
            <label className="block text-sm font-medium text-ink/80 mb-1">
              Max Amount (₹)
            </label>
            <input
              type="number"
              placeholder="∞"
              value={localFilters.maxAmount}
              onChange={(e) => handleFilterChange('maxAmount', e.target.value)}
              className="w-full px-4 py-2 border border-hairline rounded-lg focus:ring-2 focus:ring-gold focus:border-transparent"
            />
          </div>
        </div>
      )}
    </div>
  );
}
