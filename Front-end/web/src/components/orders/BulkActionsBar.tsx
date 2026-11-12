'use client';

import { useState, FormEvent } from 'react';
import { ChevronDown, Download, Trash2, CheckCircle, XCircle, AlertCircle, Package } from 'lucide-react';
import { ADMIN_CANCELLATION_REASONS } from '@/lib/constants';

interface BulkActionsBarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkStatusUpdate: (status: string, reason: string, notes: string) => Promise<void>;
  onExportSelected: () => void;
  onBulkDelete: () => void;
  /** False for view-only readers (marketing): Export stays, Delete and status changes go. */
  canManage?: boolean;
}

export default function BulkActionsBar({
  selectedCount,
  totalCount,
  onSelectAll,
  onClearSelection,
  onBulkStatusUpdate,
  onExportSelected,
  onBulkDelete,
  canManage = true,
}: BulkActionsBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (status) {
      // A reason only means something for a cancel; the server has no list for the
      // other statuses and refused every code this picker used to offer for them.
      await onBulkStatusUpdate(status, status === 'cancelled' ? reason : '', notes);
      setStatus('');
      setReason('');
      setNotes('');
      setIsExpanded(false);
    }
  };

  if (selectedCount === 0) {
    return null;
  }

  // Payment-driven statuses are set only by the payment itself (Razorpay, or a bank
  // transfer accounts confirmed), never in bulk by an admin. That includes "Process":
  // moving an order to processing is what payment does, and a bulk "Process" on unpaid
  // orders used to record them as paid with no money. The server refuses it too.
  const statusOptions = [
    { value: 'shipped', label: 'Ship', icon: Package, color: 'text-blue-600' },
    { value: 'delivered', label: 'Deliver', icon: CheckCircle, color: 'text-green-600' },
    { value: 'cancelled', label: 'Cancel', icon: XCircle, color: 'text-red-600' },
    { value: 'refunded', label: 'Refund', icon: AlertCircle, color: 'text-yellow-600' },
  ];

  return (
    <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-white border border-gray-200 rounded-lg shadow-lg z-50 w-full max-w-4xl mx-auto">
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-gray-700">
              {selectedCount} of {totalCount} selected
            </span>
            <button
              onClick={onSelectAll}
              className="text-sm text-blue-600 hover:text-blue-700"
              disabled={selectedCount === totalCount}
            >
              Select all
            </button>
            <button
              onClick={onClearSelection}
              className="text-sm text-gray-500 hover:text-gray-900"
            >
              Clear selection
            </button>
          </div>

          <div className="flex items-center gap-2">
            {canManage && (
              <button
                onClick={onBulkDelete}
                className="flex items-center gap-2 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            )}
            <button
              onClick={onExportSelected}
              className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
            {canManage && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              >
                Update Status
                <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>
        </div>

        {canManage && isExpanded && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="">Select status</option>
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {status === 'cancelled' && (
                <div>
                  <label htmlFor="bulk-cancel-reason" className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                  <select
                    id="bulk-cancel-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select reason</option>
                    {ADMIN_CANCELLATION_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional notes..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={!status}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  Apply Changes
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}