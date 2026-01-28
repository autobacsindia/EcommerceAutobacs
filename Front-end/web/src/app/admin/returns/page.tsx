'use client';

import { useState, useEffect } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { Search, Eye, Check, X, Package } from 'lucide-react';
import Link from 'next/link';

interface ReturnRequest {
  _id: string;
  order: {
    _id: string;
    orderNumber: string;
  };
  user: {
    name: string;
    email: string;
  };
  requestedAt: string;
  status: string;
  reason: string;
  items: Array<{
    product: {
      name: string;
    };
    quantity: number;
  }>;
}

export default function AdminReturnsPage() {
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchReturns();
  }, [statusFilter]);

  const fetchReturns = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.append('status', statusFilter);
      
      const response = await apiClient.get(`${API_ENDPOINTS.RETURNS_LIST}?${params.toString()}`) as any;
      setReturns(response.returns || []);
    } catch (err: any) {
      console.error('Failed to fetch returns:', {
        message: err.message || 'Unknown error',
        name: err.name,
        stack: err.stack,
        timestamp: new Date().toISOString()
      });
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (orderId: string) => {
    if (!confirm('Approve this return request?')) return;
    
    try {
      await apiClient.put(API_ENDPOINTS.RETURN_APPROVE(orderId), {
        notes: 'Approved by admin'
      });
      alert('Return request approved');
      fetchReturns();
    } catch (err: any) {
      alert(err.message || 'Failed to approve return');
    }
  };

  const handleReject = async (orderId: string) => {
    const reason = prompt('Enter rejection reason:');
    if (!reason) return;
    
    try {
      await apiClient.put(API_ENDPOINTS.RETURN_REJECT(orderId), {
        reason,
        notes: reason
      });
      alert('Return request rejected');
      fetchReturns();
    } catch (err: any) {
      alert(err.message || 'Failed to reject return');
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      requested: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-blue-100 text-blue-800',
      rejected: 'bg-red-100 text-red-800',
      item_received: 'bg-purple-100 text-purple-800',
      refund_processed: 'bg-green-100 text-green-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const filteredReturns = returns.filter(ret =>
    ret.order.orderNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    ret.user.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return <div className="p-8">Loading returns...</div>;
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Return Requests Management</h1>

      <div className="mb-6 flex gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by order or customer..."
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
          <option value="requested">Requested</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="item_received">Item Received</option>
          <option value="refund_processed">Refund Processed</option>
        </select>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Order
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Customer
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Requested Date
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Items
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Reason
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredReturns.map((returnReq) => (
              <tr key={returnReq._id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <Link
                    href={`/admin/orders/${returnReq.order._id}`}
                    className="text-sm font-medium text-blue-600 hover:text-blue-900"
                  >
                    #{returnReq.order.orderNumber}
                  </Link>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">{returnReq.user.name}</div>
                  <div className="text-sm text-gray-500">{returnReq.user.email}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-500">
                    {new Date(returnReq.requestedAt).toLocaleDateString()}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center text-sm text-gray-900">
                    <Package className="h-4 w-4 mr-1" />
                    {returnReq.items.length}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-gray-900 max-w-xs truncate">
                    {returnReq.reason}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(returnReq.status)}`}>
                    {returnReq.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <div className="flex gap-2">
                    {returnReq.status === 'requested' && (
                      <>
                        <button
                          onClick={() => handleApprove(returnReq.order._id)}
                          className="text-green-600 hover:text-green-900"
                          title="Approve"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleReject(returnReq.order._id)}
                          className="text-red-600 hover:text-red-900"
                          title="Reject"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    )}
                    <Link
                      href={`/admin/orders/${returnReq.order._id}`}
                      className="text-blue-600 hover:text-blue-900"
                      title="View Order"
                    >
                      <Eye className="h-4 w-4" />
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredReturns.length === 0 && !loading && (
        <div className="text-center py-12 bg-white rounded-lg shadow mt-6">
          <Package className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No return requests found</h3>
          <p className="text-gray-500">There are no return requests matching your criteria.</p>
        </div>
      )}
    </div>
  );
}
