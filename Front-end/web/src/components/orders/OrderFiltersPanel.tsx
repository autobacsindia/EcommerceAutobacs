'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, X, Filter, Calendar } from 'lucide-react';
import { ORDER_STATUS_LABELS, UNPAID_PAYMENT_STATUSES } from '@/lib/constants';

export interface OrderFilters {
  search: string;
  statuses: string[];
  // Payment-axis filter. Empty = the clean default view (in-flight + paid/refunded);
  // the "Unpaid / abandoned" quick filter sets it to the unpaid outcomes so those
  // (which otherwise live only in Leads) can be surfaced here on demand.
  paymentStatuses: string[];
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
  // Paid orders awaiting fulfillment — the queue that actually needs an admin's
  // attention. ('pending' used to be here but isn't a real Order.status value.)
  { label: 'To fulfill', value: 'processing' },
  { label: 'High Value (>₹10k)', value: 'high_value' },
  // Unpaid outcomes (failed / cancelled / abandoned) — hidden from the default view
  // since they live in the CRM Leads section. This surfaces them on demand.
  { label: 'Unpaid / abandoned', value: 'unpaid' },
];

const HIGH_VALUE_THRESHOLD = '10000';

// Free-text inputs debounce their propagation so we don't fire a request (and a URL
// push) on every keystroke; discrete controls (statuses, dates, quick filters) apply
// immediately.
const DEBOUNCED_FIELDS = new Set<keyof OrderFilters>(['search', 'customer', 'minAmount', 'maxAmount']);
const DEBOUNCE_MS = 350;

// Local calendar day (YYYY-MM-DD) — NOT toISOString(), which is UTC and would roll
// the date back a day for an admin in a positive-offset timezone (e.g. IST) after
// ~18:30 local. The backend anchors these date-only strings to the store timezone.
const toDateStr = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// The [start, end] a date quick-filter represents, so we can both apply and detect it.
function quickDateRange(filterType: string): { start: string; end: string } | null {
  const today = new Date();
  const DAY = 24 * 60 * 60 * 1000;
  switch (filterType) {
    case 'today': return { start: toDateStr(today), end: toDateStr(today) };
    case 'week':  return { start: toDateStr(new Date(today.getTime() - 7 * DAY)), end: toDateStr(today) };
    case 'month': return { start: toDateStr(new Date(today.getTime() - 30 * DAY)), end: toDateStr(today) };
    default: return null;
  }
}

export default function OrderFiltersPanel({
  filters,
  onFiltersChange,
  onApply,
  autoApply = true,
}: OrderFiltersPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [localFilters, setLocalFilters] = useState<OrderFilters>(filters);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local filters with prop changes (URL init, external clear, etc.).
  useEffect(() => {
    setLocalFilters(filters);
  }, [filters]);

  // Cancel any pending debounced apply on unmount.
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const cancelPending = () => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
  };

  // Apply now — discrete controls and the final flush of typed input.
  const commitImmediate = (next: OrderFilters) => {
    cancelPending();
    if (autoApply) onFiltersChange(next);
  };

  // Apply after the user pauses typing — free-text inputs only.
  const commitDebounced = (next: OrderFilters) => {
    if (!autoApply) return;
    cancelPending();
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      onFiltersChange(next);
    }, DEBOUNCE_MS);
  };

  const handleFilterChange = (key: keyof OrderFilters, value: any) => {
    const newFilters = { ...localFilters, [key]: value };
    setLocalFilters(newFilters);
    if (DEBOUNCED_FIELDS.has(key)) commitDebounced(newFilters);
    else commitImmediate(newFilters);
  };

  const handleStatusToggle = (status: string) => {
    const currentStatuses = localFilters.statuses || [];
    const newStatuses = currentStatuses.includes(status)
      ? currentStatuses.filter(s => s !== status)
      : [...currentStatuses, status];

    handleFilterChange('statuses', newStatuses);
  };

  // Whether a quick filter is currently the active selection — lets clicking it again
  // toggle it off, and drives the active styling.
  const isQuickFilterActive = (filterType: string): boolean => {
    const range = quickDateRange(filterType);
    if (range) return localFilters.startDate === range.start && localFilters.endDate === range.end;
    if (filterType === 'processing') return localFilters.statuses.length === 1 && localFilters.statuses[0] === 'processing';
    if (filterType === 'high_value') return localFilters.minAmount === HIGH_VALUE_THRESHOLD;
    if (filterType === 'unpaid') return (localFilters.paymentStatuses?.length ?? 0) > 0;
    return false;
  };

  const handleQuickFilter = (filterType: string) => {
    const active = isQuickFilterActive(filterType);
    let newFilters = { ...localFilters };
    const range = quickDateRange(filterType);

    if (range) {
      newFilters = active
        ? { ...newFilters, startDate: '', endDate: '' }
        : { ...newFilters, startDate: range.start, endDate: range.end };
    } else if (filterType === 'processing') {
      newFilters = { ...newFilters, statuses: active ? [] : ['processing'] };
    } else if (filterType === 'high_value') {
      newFilters = { ...newFilters, minAmount: active ? '' : HIGH_VALUE_THRESHOLD };
    } else if (filterType === 'unpaid') {
      newFilters = { ...newFilters, paymentStatuses: active ? [] : [...UNPAID_PAYMENT_STATUSES] };
    }

    setLocalFilters(newFilters);
    commitImmediate(newFilters);
  };

  const handleClearFilters = () => {
    const emptyFilters: OrderFilters = {
      search: '',
      statuses: [],
      paymentStatuses: [],
      startDate: '',
      endDate: '',
      minAmount: '',
      maxAmount: '',
      customer: '',
    };
    setLocalFilters(emptyFilters);
    commitImmediate(emptyFilters);
  };

  const getActiveFilterCount = () => {
    let count = 0;
    if (localFilters.search) count++;
    if (localFilters.statuses.length > 0) count++;
    if ((localFilters.paymentStatuses?.length ?? 0) > 0) count++;
    if (localFilters.startDate || localFilters.endDate) count++;
    if (localFilters.minAmount || localFilters.maxAmount) count++;
    if (localFilters.customer) count++;
    return count;
  };

  const activeCount = getActiveFilterCount();

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-gray-700 hover:text-gray-900 font-medium"
        >
          <Filter className="h-5 w-5" />
          <span>Filters</span>
          {activeCount > 0 && (
            <span className="bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full">
              {activeCount}
            </span>
          )}
        </button>
        
        <div className="flex items-center gap-2">
          {activeCount > 0 && (
            <button
              onClick={handleClearFilters}
              className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1"
            >
              <X className="h-4 w-4" />
              Clear All
            </button>
          )}
          {!autoApply && (
            <button
              onClick={() => {
                cancelPending();
                onFiltersChange(localFilters);
                onApply?.();
              }}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm"
            >
              Apply Filters
            </button>
          )}
        </div>
      </div>

      {/* Quick Filters */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex flex-wrap gap-2">
          {QUICK_FILTERS.map((filter) => {
            const active = isQuickFilterActive(filter.value);
            return (
              <button
                key={filter.value}
                onClick={() => handleQuickFilter(filter.value)}
                aria-pressed={active}
                className={`px-3 py-1.5 text-sm rounded-lg transition ${
                  active
                    ? 'bg-blue-600 text-white font-medium'
                    : 'bg-gray-50 hover:bg-gray-100 text-gray-700'
                }`}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Filters - Collapsible */}
      {isExpanded && (
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Search by Order Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Order Number
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-500" />
              <input
                type="text"
                placeholder="Search order #..."
                value={localFilters.search}
                onChange={(e) => handleFilterChange('search', e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Customer Search */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Customer
            </label>
            <input
              type="text"
              placeholder="Name or email..."
              value={localFilters.customer}
              onChange={(e) => handleFilterChange('customer', e.target.value)}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Status Multi-Select */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <button
              onClick={() => setShowStatusDropdown(!showStatusDropdown)}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg text-left flex items-center justify-between hover:border-gray-300"
            >
              <span className="text-gray-700">
                {localFilters.statuses.length === 0
                  ? 'All Statuses'
                  : `${localFilters.statuses.length} selected`}
              </span>
              <span className="text-gray-500">▼</span>
            </button>
            
            {showStatusDropdown && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
                {Object.entries(ORDER_STATUS_LABELS).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center px-4 py-2 hover:bg-gray-100 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={localFilters.statuses.includes(key)}
                      onChange={() => handleStatusToggle(key)}
                      className="mr-3 h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">{label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Date Range - Start */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              From Date
            </label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-500" />
              <input
                type="date"
                value={localFilters.startDate}
                onChange={(e) => handleFilterChange('startDate', e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Date Range - End */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              To Date
            </label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-500" />
              <input
                type="date"
                value={localFilters.endDate}
                onChange={(e) => handleFilterChange('endDate', e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Amount Range - Min */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Min Amount (₹)
            </label>
            <input
              type="number"
              placeholder="0"
              value={localFilters.minAmount}
              onChange={(e) => handleFilterChange('minAmount', e.target.value)}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Amount Range - Max */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Max Amount (₹)
            </label>
            <input
              type="number"
              placeholder="∞"
              value={localFilters.maxAmount}
              onChange={(e) => handleFilterChange('maxAmount', e.target.value)}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      )}
    </div>
  );
}
