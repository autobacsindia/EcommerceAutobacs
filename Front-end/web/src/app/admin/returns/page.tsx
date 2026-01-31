'use client';

import { useState, useEffect } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { Search, Eye, Check, X, Package, RefreshCw, Video, Image as ImageIcon, ExternalLink, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { ReturnRequest, PaginatedReturnRequests } from '@/lib/types';

export default function AdminReturnsPage() {
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRequest, setSelectedRequest] = useState<ReturnRequest | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    total: 0
  });

  useEffect(() => {
    fetchReturns(1);
  }, [statusFilter]);

  const fetchReturns = async (page: number) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.append('status', statusFilter);
      params.append('page', page.toString());
      params.append('limit', '20');
      
      // Use ADMIN_RETURNS endpoint
      const response = await apiClient.get<PaginatedReturnRequests>(`${API_ENDPOINTS.ADMIN_RETURNS}?${params.toString()}`);
      setReturns(response.requests || []);
      setPagination({
        currentPage: response.pagination.currentPage || 1,
        totalPages: response.pagination.totalPages || 1,
        total: response.count || 0
      });
    } catch (err: any) {
      console.error('Failed to fetch returns:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id: string, status: string, data: any = {}) => {
    try {
      await apiClient.put(API_ENDPOINTS.RETURN_STATUS(id), {
        status,
        ...data
      });
      fetchReturns(pagination.currentPage);
      setIsDetailsModalOpen(false);
    } catch (err: any) {
      alert(err.message || 'Failed to update status');
    }
  };

  const handleApprove = (id: string) => {
    if (confirm('Approve this return request?')) {
      updateStatus(id, 'approved', { adminNotes: 'Approved by admin' });
    }
  };

  const handleReject = (id: string) => {
    const reason = prompt('Enter rejection reason:');
    if (reason) {
      updateStatus(id, 'rejected', { rejectionReason: reason });
    }
  };

  const handleItemReceived = (id: string) => {
    if (confirm('Confirm item received?')) {
      updateStatus(id, 'item_received');
    }
  };

  const handleComplete = (id: string) => {
    if (confirm('Mark request as completed (Refund/Exchange processed)?')) {
      updateStatus(id, 'completed');
    }
  };

  const openDetails = (request: ReturnRequest) => {
    setSelectedRequest(request);
    setIsDetailsModalOpen(true);
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-blue-100 text-blue-800',
      rejected: 'bg-red-100 text-red-800',
      item_received: 'bg-purple-100 text-purple-800',
      completed: 'bg-green-100 text-green-800',
      cancelled: 'bg-gray-100 text-gray-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  // Filter client-side for search (backend search not implemented yet for returns in this context)
  // Ideally backend should handle search
  const filteredReturns = returns.filter(ret =>
    ret.order._id.toLowerCase().includes(searchTerm.toLowerCase())
    // Add user name check if user object is populated with name
  );

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Return Requests Management</h1>

      <div className="mb-6 flex gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by order ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-lg"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded-lg px-4 py-2"
        >
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="item_received">Item Received</option>
          <option value="completed">Completed</option>
          <option value="rejected">Rejected</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Request / Order</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type / Method</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Items</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reason</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredReturns.map((req) => (
              <tr key={req._id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <div className="text-sm font-medium text-gray-900">
                    REQ: {req._id.substring(0, 8).toUpperCase()}
                  </div>
                  <Link href={`/admin/orders/${req.order._id}`} className="text-xs text-blue-600 hover:underline flex items-center mt-1">
                    ORD: {req.order._id.substring(0, 8).toUpperCase()}
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </Link>
                  <div className="text-xs text-gray-500 mt-1">
                    {new Date(req.createdAt).toLocaleDateString()}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    req.type === 'exchange' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'
                  }`}>
                    {req.type.toUpperCase()}
                  </span>
                  <div className="text-xs text-gray-500 mt-2">
                    {req.refundMethod === 'store_credit' ? 'Store Credit' : 'Original Payment'}
                  </div>
                  {req.refundAmount && (
                    <div className="text-xs font-medium text-green-600 mt-1">
                      ₹{req.refundAmount.toFixed(2)}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4">
                  <div className="flex -space-x-2 overflow-hidden">
                    {req.items.map((item, idx) => (
                      <div key={idx} className="inline-block h-8 w-8 rounded-full ring-2 ring-white bg-gray-100 flex items-center justify-center overflow-hidden" title={item.product.name}>
                        {item.product.images[0] ? (
                          <img src={item.product.images[0].url} alt={item.product.name} className="h-full w-full object-cover" />
                        ) : (
                          <Package className="h-4 w-4 text-gray-400" />
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {req.items.length} item(s)
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-gray-900 max-w-xs truncate" title={req.items[0]?.reason}>
                    {req.items[0]?.reason.replace('_', ' ')}
                  </div>
                  {req.items.length > 1 && (
                    <div className="text-xs text-gray-500">
                      + {req.items.length - 1} more
                    </div>
                  )}
                  {req.video && (
                    <div className="flex items-center mt-1 text-xs text-blue-600">
                      <Video className="h-3 w-3 mr-1" />
                      Video attached
                    </div>
                  )}
                </td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(req.status)}`}>
                    {req.status.replace('_', ' ').toUpperCase()}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <div className="flex gap-2">
                    <button
                      onClick={() => openDetails(req)}
                      className="text-gray-600 hover:text-gray-900"
                      title="View Details"
                    >
                      <Eye className="h-5 w-5" />
                    </button>
                    {req.status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleApprove(req._id)}
                          className="text-green-600 hover:text-green-900"
                          title="Approve"
                        >
                          <Check className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => handleReject(req._id)}
                          className="text-red-600 hover:text-red-900"
                          title="Reject"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </>
                    )}
                    {req.status === 'approved' && (
                      <button
                        onClick={() => handleItemReceived(req._id)}
                        className="text-purple-600 hover:text-purple-900"
                        title="Mark Item Received"
                      >
                        <Package className="h-5 w-5" />
                      </button>
                    )}
                    {req.status === 'item_received' && (
                      <button
                        onClick={() => handleComplete(req._id)}
                        className="text-blue-600 hover:text-blue-900"
                        title="Process Refund/Exchange"
                      >
                        <RefreshCw className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="mt-6 flex justify-between items-center">
          <div className="text-sm text-gray-700">
            Page {pagination.currentPage} of {pagination.totalPages}
          </div>
          <div className="flex gap-2">
            <button
              disabled={pagination.currentPage === 1}
              onClick={() => fetchReturns(pagination.currentPage - 1)}
              className="px-4 py-2 border rounded disabled:opacity-50"
            >
              Previous
            </button>
            <button
              disabled={pagination.currentPage === pagination.totalPages}
              onClick={() => fetchReturns(pagination.currentPage + 1)}
              className="px-4 py-2 border rounded disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Details Modal */}
      {isDetailsModalOpen && selectedRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-6">
                <h2 className="text-2xl font-bold">Request Details #{selectedRequest._id.substring(0, 8).toUpperCase()}</h2>
                <button onClick={() => setIsDetailsModalOpen(false)} className="text-gray-500 hover:text-gray-700">
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <h3 className="font-semibold text-lg mb-4">Request Information</h3>
                  <div className="space-y-3 text-sm">
                    <p><span className="font-medium">Type:</span> {selectedRequest.type.toUpperCase()}</p>
                    <p><span className="font-medium">Status:</span> {selectedRequest.status.replace('_', ' ').toUpperCase()}</p>
                    <p><span className="font-medium">Date:</span> {new Date(selectedRequest.createdAt).toLocaleString()}</p>
                    <p><span className="font-medium">Refund Method:</span> {selectedRequest.refundMethod.replace('_', ' ')}</p>
                    <p><span className="font-medium">Refund Amount:</span> ₹{selectedRequest.refundAmount?.toFixed(2) || '0.00'}</p>
                  </div>

                  <h3 className="font-semibold text-lg mt-6 mb-4">Items</h3>
                  <div className="space-y-4">
                    {selectedRequest.items.map((item, idx) => (
                      <div key={idx} className="flex gap-4 border p-3 rounded">
                        <div className="w-16 h-16 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                          {item.product.images[0] ? (
                            <img src={item.product.images[0].url} alt={item.product.name} className="w-full h-full object-cover" />
                          ) : (
                            <Package className="h-8 w-8 text-gray-400 m-auto" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium">{item.product.name}</p>
                          <p className="text-sm text-gray-500">Qty: {item.quantity}</p>
                          <p className="text-sm text-red-600">Reason: {item.reason.replace('_', ' ')}</p>
                          <p className="text-sm text-gray-600">Condition: {item.condition}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-lg mb-4">Evidence</h3>
                  
                  {selectedRequest.video ? (
                    <div className="mb-6">
                      <p className="text-sm font-medium mb-2 flex items-center">
                        <Video className="h-4 w-4 mr-2" /> Unboxing Video
                      </p>
                      <a 
                        href={selectedRequest.video.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline break-all"
                      >
                        {selectedRequest.video.url}
                      </a>
                    </div>
                  ) : (
                     <p className="text-sm text-gray-500 mb-6">No video provided</p>
                  )}

                  <h4 className="text-sm font-medium mb-2 flex items-center">
                    <ImageIcon className="h-4 w-4 mr-2" /> Images
                  </h4>
                  {selectedRequest.images && selectedRequest.images.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2">
                      {selectedRequest.images.map((img, idx) => (
                        <a key={idx} href={img.url} target="_blank" rel="noopener noreferrer" className="block border rounded overflow-hidden h-32">
                          <img src={img.url} alt="Evidence" className="w-full h-full object-cover" />
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No images provided</p>
                  )}

                  {selectedRequest.timeline && selectedRequest.timeline.length > 0 && (
                    <div className="mt-8">
                      <h3 className="font-semibold text-lg mb-4">Timeline</h3>
                      <div className="space-y-4 border-l-2 border-gray-200 ml-2 pl-4">
                        {selectedRequest.timeline.map((event, idx) => (
                          <div key={idx} className="relative">
                            <div className="absolute -left-[21px] top-1 h-3 w-3 rounded-full bg-gray-300"></div>
                            <p className="text-sm font-medium">{event.status.replace('_', ' ').toUpperCase()}</p>
                            <p className="text-xs text-gray-500">{new Date(event.timestamp).toLocaleString()}</p>
                            {event.note && <p className="text-sm text-gray-600 mt-1">{event.note}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-8 flex justify-end gap-3 pt-4 border-t">
                <button
                  onClick={() => setIsDetailsModalOpen(false)}
                  className="px-4 py-2 border rounded hover:bg-gray-50"
                >
                  Close
                </button>
                {selectedRequest.status === 'pending' && (
                  <>
                    <button
                      onClick={() => handleReject(selectedRequest._id)}
                      className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => handleApprove(selectedRequest._id)}
                      className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      Approve
                    </button>
                  </>
                )}
                {selectedRequest.status === 'approved' && (
                  <button
                    onClick={() => handleItemReceived(selectedRequest._id)}
                    className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
                  >
                    Mark Item Received
                  </button>
                )}
                {selectedRequest.status === 'item_received' && (
                  <button
                    onClick={() => handleComplete(selectedRequest._id)}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Process Refund
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
