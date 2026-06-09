'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Edit, AlertTriangle, Package, RefreshCw } from 'lucide-react';
import warehouseService, {
  WarehouseListItem,
  InventoryItem,
  LowStockItem,
} from '@/services/warehouseService';

type Tab = 'overview' | 'inventory' | 'lowstock';

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  inactive: 'bg-gray-100 text-gray-600',
  maintenance: 'bg-yellow-100 text-yellow-800',
};

interface EditStockModalProps {
  item: InventoryItem;
  warehouseId: string;
  onClose: () => void;
  onSaved: (updated: InventoryItem) => void;
}

function EditStockModal({ item, warehouseId, onClose, onSaved }: EditStockModalProps) {
  const [quantity, setQuantity] = useState(item.quantity);
  const [reorderLevel, setReorderLevel] = useState(item.reorderLevel);
  const [reorderQuantity, setReorderQuantity] = useState(item.reorderQuantity);
  const [location, setLocation] = useState(item.location || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await warehouseService.updateInventoryStock(warehouseId, item.product._id, {
        quantity,
        reorderLevel,
        reorderQuantity,
        location: location || undefined,
      });
      onSaved(res.inventory);
    } catch (err: any) {
      setError(err.message || 'Failed to update stock');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold mb-1">Update Stock</h3>
        <p className="text-sm text-gray-500 mb-4">{item.product.name}</p>

        {error && (
          <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-xs">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {[
            { label: 'Quantity', value: quantity, set: setQuantity },
            { label: 'Reorder Level', value: reorderLevel, set: setReorderLevel },
            { label: 'Reorder Quantity', value: reorderQuantity, set: setReorderQuantity },
          ].map(({ label, value, set }) => (
            <div key={label}>
              <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
              <input
                type="number"
                min={0}
                value={value}
                onChange={e => set(Number(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          ))}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Location in warehouse
            </label>
            <input
              value={location}
              onChange={e => setLocation(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="Aisle B, Shelf 3"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WarehouseDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [warehouse, setWarehouse] = useState<WarehouseListItem | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [invLoading, setInvLoading] = useState(false);
  const [lowLoading, setLowLoading] = useState(false);
  const [error, setError] = useState('');
  const [invPage, setInvPage] = useState(1);
  const [invPages, setInvPages] = useState(1);
  const [invTotal, setInvTotal] = useState(0);
  const [invSearch, setInvSearch] = useState('');
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    warehouseService
      .getWarehouse(id)
      .then(res => setWarehouse(res.warehouse))
      .catch(err => setError(err.message || 'Failed to load warehouse'))
      .finally(() => setLoading(false));
  }, [id]);

  const fetchInventory = useCallback(
    async (page = 1, search = '') => {
      setInvLoading(true);
      try {
        const res = await warehouseService.getInventory(id, { page, limit: 20, search });
        setInventory(res.inventory || []);
        setInvPages(res.pages || 1);
        setInvTotal(res.total || 0);
        setInvPage(page);
      } catch (err: any) {
        setError(err.message || 'Failed to load inventory');
      } finally {
        setInvLoading(false);
      }
    },
    [id]
  );

  const fetchLowStock = useCallback(async () => {
    setLowLoading(true);
    try {
      const res = await warehouseService.getLowStock(id);
      setLowStock(res.lowStockItems || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load low stock');
    } finally {
      setLowLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (tab === 'inventory') fetchInventory(1, invSearch);
    if (tab === 'lowstock') fetchLowStock();
  }, [tab]);

  const handleInvSearch = (value: string) => {
    setInvSearch(value);
    fetchInventory(1, value);
  };

  const handleToggleHomepage = async () => {
    if (!warehouse || toggling) return;
    setToggling(true);
    try {
      const res = await warehouseService.toggleHomepage(id, !warehouse.showOnHomepage);
      setWarehouse(res.warehouse);
      await fetch('/api/revalidate/warehouses', { method: 'POST' });
    } catch (err: any) {
      setError(err.message || 'Failed to update homepage visibility');
    } finally {
      setToggling(false);
    }
  };

  const handleStockSaved = (updated: InventoryItem) => {
    setInventory(prev => prev.map(i => (i._id === updated._id ? updated : i)));
    setEditItem(null);
  };

  if (loading) return <div className="p-6 text-gray-500">Loading...</div>;
  if (!warehouse)
    return (
      <div className="p-6 text-red-600">
        {error || 'Warehouse not found'}
      </div>
    );

  const statusStyle = STATUS_STYLE[warehouse.operationalStatus] ?? STATUS_STYLE.inactive;

  return (
    <div className="p-4 md:p-6">
      {editItem && (
        <EditStockModal
          item={editItem}
          warehouseId={id}
          onClose={() => setEditItem(null)}
          onSaved={handleStockSaved}
        />
      )}

      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <Link href="/admin/warehouses" className="text-gray-500 hover:text-gray-800 mt-1">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">{warehouse.name}</h1>
            <span className="font-mono text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded">
              {warehouse.code}
            </span>
            <span className={`px-2 py-1 text-xs rounded-full ${statusStyle}`}>
              {warehouse.operationalStatus}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {warehouse.location.city}, {warehouse.location.state}
          </p>
        </div>
        <Link
          href={`/admin/warehouses/${id}/edit`}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm"
        >
          <Edit className="h-4 w-4" /> Edit
        </Link>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-1">
          {(['overview', 'inventory', 'lowstock'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
                tab === t
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'lowstock' ? 'Low Stock' : t.charAt(0).toUpperCase() + t.slice(1)}
              {t === 'lowstock' && lowStock.length > 0 && (
                <span className="ml-1 bg-red-100 text-red-700 text-xs px-1.5 py-0.5 rounded-full">
                  {lowStock.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <>
          {/* Homepage visibility toggle */}
          <div className="mb-6 bg-white rounded-lg border border-gray-200 p-5 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-800 mb-0.5">Show on Homepage</h3>
              <p className="text-xs text-gray-500">
                When enabled, this warehouse appears in the Delivery Network section on the storefront homepage.
              </p>
            </div>
            <button
              onClick={handleToggleHomepage}
              disabled={toggling}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${
                warehouse.showOnHomepage ? 'bg-blue-600' : 'bg-gray-200'
              }`}
              role="switch"
              aria-checked={warehouse.showOnHomepage}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform ${
                warehouse.showOnHomepage ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <InfoCard title="Details">
            <Row label="Type" value={warehouse.type} />
            <Row label="Capacity" value={warehouse.capacity.toLocaleString() + ' units'} />
            <Row label="Status" value={warehouse.operationalStatus} />
            <Row
              label="Serviceable PINs"
              value={
                warehouse.serviceablePinCodes.length > 0
                  ? warehouse.serviceablePinCodes.join(', ')
                  : 'All PINs'
              }
            />
          </InfoCard>

          <InfoCard title="Location">
            <Row label="Address" value={warehouse.location.address} />
            <Row label="City" value={warehouse.location.city} />
            <Row label="State" value={warehouse.location.state} />
            <Row label="PIN Code" value={warehouse.location.postalCode} />
            <Row label="Country" value={warehouse.location.country} />
          </InfoCard>

          <InfoCard title="Contact">
            <Row label="Manager" value={warehouse.contactInfo?.manager || '—'} />
            <Row label="Phone" value={warehouse.contactInfo?.phone || '—'} />
            <Row label="Email" value={warehouse.contactInfo?.email || '—'} />
          </InfoCard>
        </div>
        </>
      )}

      {/* Inventory Tab */}
      {tab === 'inventory' && (
        <div>
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-gray-500" />
              <span className="text-sm text-gray-600">{invTotal} items</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Search products..."
                value={invSearch}
                onChange={e => handleInvSearch(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm w-48"
              />
              <button
                onClick={() => fetchInventory(invPage, invSearch)}
                className="p-2 border rounded-lg hover:bg-gray-50"
                title="Refresh"
              >
                <RefreshCw className="h-4 w-4 text-gray-500" />
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {['Product', 'SKU', 'Qty', 'Reserved', 'Available', 'Reorder At', 'Location', 'Actions'].map(
                      h => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {invLoading ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-500 text-sm">
                        Loading inventory...
                      </td>
                    </tr>
                  ) : inventory.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-500 text-sm">
                        No inventory found
                      </td>
                    </tr>
                  ) : (
                    inventory.map(item => {
                      const isLow = item.quantity <= item.reorderLevel;
                      return (
                        <tr key={item._id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900 max-w-xs truncate">
                            {item.product.name}
                          </td>
                          <td className="px-4 py-3 text-xs font-mono text-gray-400">
                            {item.product.sku || '—'}
                          </td>
                          <td className={`px-4 py-3 text-sm font-semibold ${isLow ? 'text-red-600' : 'text-gray-900'}`}>
                            {item.quantity}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">{item.reservedQuantity}</td>
                          <td className="px-4 py-3 text-sm text-green-700 font-medium">
                            {item.availableQuantity}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">{item.reorderLevel}</td>
                          <td className="px-4 py-3 text-sm text-gray-400">{item.location || '—'}</td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => setEditItem(item)}
                              className="text-blue-600 hover:text-blue-900 text-xs underline"
                            >
                              Update
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {invPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-gray-500">
                Page {invPage} of {invPages}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={invPage <= 1}
                  onClick={() => fetchInventory(invPage - 1, invSearch)}
                  className="px-3 py-1.5 border rounded text-gray-700 disabled:opacity-40 hover:bg-gray-50"
                >
                  Previous
                </button>
                <button
                  disabled={invPage >= invPages}
                  onClick={() => fetchInventory(invPage + 1, invSearch)}
                  className="px-3 py-1.5 border rounded text-gray-700 disabled:opacity-40 hover:bg-gray-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Low Stock Tab */}
      {tab === 'lowstock' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <span className="text-sm text-gray-600">{lowStock.length} items need restocking</span>
            </div>
            <button
              onClick={fetchLowStock}
              className="p-2 border rounded-lg hover:bg-gray-50"
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4 text-gray-500" />
            </button>
          </div>

          {lowLoading ? (
            <div className="p-6 text-gray-500 text-sm">Loading...</div>
          ) : lowStock.length === 0 ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
              <p className="text-green-700 font-medium">All items are adequately stocked</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full divide-y divide-gray-200">
                <thead className="bg-red-50">
                  <tr>
                    {['Product', 'SKU', 'Current Stock', 'Reorder Level', 'Suggest Order'].map(h => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {lowStock.map(item => (
                    <tr key={item._id} className="hover:bg-red-50/30">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {item.product.name}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-400">
                        {item.product.sku || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-red-600">
                        {item.quantity}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{item.reorderLevel}</td>
                      <td className="px-4 py-3 text-sm text-blue-700 font-medium">
                        {item.reorderQuantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      <dl className="space-y-2">{children}</dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-xs text-gray-400 w-28 shrink-0">{label}</dt>
      <dd className="text-sm text-gray-800 wrap-break-word">{value}</dd>
    </div>
  );
}
