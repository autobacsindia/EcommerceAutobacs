'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Plus, Edit, Trash2, Eye, AlertTriangle } from 'lucide-react';
import warehouseService, { WarehouseListItem, WarehouseFilters } from '@/services/warehouseService';

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-green-100 text-green-800' },
  inactive: { label: 'Inactive', className: 'bg-gray-100 text-gray-600' },
  maintenance: { label: 'Maintenance', className: 'bg-yellow-100 text-yellow-800' },
};

const TYPE_LABELS: Record<string, string> = {
  warehouse: 'Warehouse',
  store: 'Store',
  hub: 'Hub',
};

export default function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<WarehouseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<WarehouseFilters>({});

  const fetchWarehouses = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await warehouseService.getWarehouses(filters);
      setWarehouses(res.warehouses || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load warehouses');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchWarehouses();
  }, [fetchWarehouses]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete warehouse "${name}"? This cannot be undone.`)) return;
    try {
      await warehouseService.deleteWarehouse(id);
      setWarehouses(prev => prev.filter(w => w._id !== id));
    } catch (err: any) {
      alert(err.message || 'Failed to delete warehouse');
    }
  };

  return (
    <div className="p-4 md:p-6 w-full">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <h1 className="text-2xl md:text-3xl font-bold">Warehouse Management</h1>
        <Link
          href="/admin/warehouses/create"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2 text-sm"
        >
          <Plus className="h-4 w-4" />
          Add Warehouse
        </Link>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-3">
        <select
          value={filters.status || ''}
          onChange={e => setFilters(f => ({ ...f, status: e.target.value || undefined }))}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="maintenance">Maintenance</option>
        </select>

        <select
          value={filters.type || ''}
          onChange={e => setFilters(f => ({ ...f, type: e.target.value || undefined }))}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Types</option>
          <option value="warehouse">Warehouse</option>
          <option value="store">Store</option>
          <option value="hub">Hub</option>
        </select>

        <input
          type="text"
          placeholder="Filter by city..."
          value={filters.city || ''}
          onChange={e => setFilters(f => ({ ...f, city: e.target.value || undefined }))}
          className="border rounded-lg px-3 py-2 text-sm w-44"
        />
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-6 text-gray-500">Loading warehouses...</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
          <div className="overflow-x-auto">
            <table className="w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['Name / Code', 'Type', 'Location', 'Status', 'Capacity', 'Manager', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {warehouses.map(w => {
                  const status = STATUS_LABELS[w.operationalStatus] ?? STATUS_LABELS.inactive;
                  return (
                    <tr key={w._id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">{w.name}</div>
                        <div className="text-xs text-gray-400 font-mono">{w.code}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {TYPE_LABELS[w.type] ?? w.type}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-gray-900">{w.location.city}</div>
                        <div className="text-xs text-gray-400">{w.location.state}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs rounded-full ${status.className}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {w.capacity.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {w.contactInfo?.manager || '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex gap-3 items-center">
                          <Link
                            href={`/admin/warehouses/${w._id}`}
                            className="text-gray-500 hover:text-gray-800"
                            title="View"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>
                          <Link
                            href={`/admin/warehouses/${w._id}/edit`}
                            className="text-blue-600 hover:text-blue-900"
                            title="Edit"
                          >
                            <Edit className="h-4 w-4" />
                          </Link>
                          <button
                            onClick={() => handleDelete(w._id, w.name)}
                            className="text-red-600 hover:text-red-900"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {warehouses.length === 0 && (
            <div className="text-center py-12 text-gray-500">No warehouses found</div>
          )}
        </div>
      )}
    </div>
  );
}
