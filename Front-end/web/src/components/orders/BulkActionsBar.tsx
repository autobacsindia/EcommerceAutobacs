'use client';

import { useState, FormEvent } from 'react';
import { ChevronDown, Download, Trash2, CheckCircle, XCircle, AlertCircle, Package } from 'lucide-react';

interface BulkActionsBarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkStatusUpdate: (status: string, reason: string, notes: string) => Promise<void>;
  onExportSelected: () => void;
  onBulkDelete: () => void;
}

export default function BulkActionsBar({
  selectedCount,
  totalCount,
  onSelectAll,
  onClearSelection,
  onBulkStatusUpdate,
  onExportSelected,
  onBulkDelete
}: BulkActionsBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (status) {
      await onBulkStatusUpdate(status, reason, notes);
      setStatus('');
      setReason('');
      setNotes('');
      setIsExpanded(false);
    }
  };

  if (selectedCount === 0) {
    return null;
  }

  const statusOptions = [
    { value: 'confirmed', label: 'Confirm', icon: CheckCircle, color: 'text-green-600' },
    { value: 'processing', label: 'Process', icon: Package, color: 'text-gold' },
    { value: 'shipped', label: 'Ship', icon: Package, color: 'text-gold' },
    { value: 'delivered', label: 'Deliver', icon: CheckCircle, color: 'text-green-600' },
    { value: 'cancelled', label: 'Cancel', icon: XCircle, color: 'text-red-600' },
    { value: 'refunded', label: 'Refund', icon: AlertCircle, color: 'text-yellow-600' },
  ];

  return (
    <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-obsidian border border-hairline rounded-lg shadow-lg z-50 w-full max-w-4xl mx-auto">
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-ink/80">
              {selectedCount} of {totalCount} selected
            </span>
            <button
              onClick={onSelectAll}
              className="text-sm text-gold hover:text-gold"
              disabled={selectedCount === totalCount}
            >
              Select all
            </button>
            <button
              onClick={onClearSelection}
              className="text-sm text-ink-muted hover:text-ink"
            >
              Clear selection
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onBulkDelete}
              className="flex items-center gap-2 px-3 py-2 bg-red-600 text-ink rounded-lg hover:bg-red-700 text-sm"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
            <button
              onClick={onExportSelected}
              className="flex items-center gap-2 px-3 py-2 bg-green-600 text-ink rounded-lg hover:bg-green-700 text-sm"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-2 px-3 py-2 bg-gold text-obsidian rounded-lg hover:bg-gold text-sm"
            >
              Update Status
              <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="mt-4 pt-4 border-t border-hairline">
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink/80 mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-hairline rounded-lg focus:ring-2 focus:ring-gold focus:border-transparent"
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

              <div>
                <label className="block text-sm font-medium text-ink/80 mb-1">Reason</label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full px-3 py-2 border border-hairline rounded-lg focus:ring-2 focus:ring-gold focus:border-transparent"
                >
                  <option value="">Select reason</option>
                  <option value="customer_request">Customer Request</option>
                  <option value="out_of_stock">Out of Stock</option>
                  <option value="payment_issue">Payment Issue</option>
                  <option value="quality_issue">Quality Issue</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink/80 mb-1">Notes (Optional)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional notes..."
                  className="w-full px-3 py-2 border border-hairline rounded-lg focus:ring-2 focus:ring-gold focus:border-transparent"
                />
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={!status}
                  className="w-full px-4 py-2 bg-gold text-obsidian rounded-lg hover:bg-gold disabled:opacity-50 disabled:cursor-not-allowed text-sm"
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