'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import apiClient from '@/lib/api';
import { revalidateHome } from '@/lib/revalidateHome';
import { CheckCircle, XCircle, Trash2, Search, Plus, Star, Quote } from 'lucide-react';

interface Review {
  _id: string;
  product: {
    _id: string;
    name: string;
  };
  user?: {
    _id: string;
    name: string;
    email: string;
  } | null;
  guestName?: string;
  rating: number;
  title?: string;
  comment: string;
  isApproved: boolean;
  isTestimonial?: boolean;
  isVerifiedPurchase?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Pagination {
  currentPage: number;
  totalPages: number;
  totalReviews: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export default function AdminReviewsPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, user } = useAuth();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<Pagination>({
    currentPage: 1,
    totalPages: 1,
    totalReviews: 0,
    hasNext: false,
    hasPrev: false
  });
  
  // Filter states
  const [statusFilter, setStatusFilter] = useState<'all' | 'approved' | 'pending'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'createdAt' | 'rating'>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Check authentication
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  // Fetch reviews
  useEffect(() => {
    if (isAuthenticated) {
      fetchReviews();
    }
  }, [isAuthenticated, pagination.currentPage, statusFilter, searchTerm, sortBy, sortOrder]);

  const fetchReviews = async () => {
    try {
      setLoading(true);
      
      const params = new URLSearchParams({
        page: pagination.currentPage.toString(),
        limit: '10',
        sortBy,
        order: sortOrder
      });
      
      if (statusFilter !== 'all') {
        params.append('status', statusFilter);
      }
      
      if (searchTerm) {
        // In a real implementation, you might want to search by product name or user name
        params.append('search', searchTerm);
      }
      
      const endpoint = `/reviews/admin?${params.toString()}`;
      const data = await apiClient.get(endpoint) as any;

      setReviews(data.reviews);
      setPagination({
        currentPage: data.pagination.currentPage,
        totalPages: data.pagination.totalPages,
        totalReviews: data.pagination.totalReviews,
        hasNext: data.pagination.hasNext,
        hasPrev: data.pagination.hasPrev
      });
    } catch (err: any) {
      setError('Failed to load reviews');
      console.error('Error fetching reviews:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (reviewId: string) => {
    try {
      const endpoint = `/reviews/${reviewId}/approve`;
      const data = await apiClient.put(endpoint, {});
      
      // Update UI immediately
      setReviews(reviews.map(review => 
        review._id === reviewId 
          ? { ...review, isApproved: true } 
          : review
      ));

      // A review shows on the homepage only when testimonial + approved — refresh it.
      revalidateHome('home:testimonials');
      alert('Review approved successfully');
    } catch (err: any) {
      alert('Failed to approve review');
      console.error('Error approving review:', err);
    }
  };

  const handleReject = async (reviewId: string) => {
    try {
      const endpoint = `/reviews/${reviewId}/reject`;
      const data = await apiClient.put(endpoint, {});
      
      // Update UI immediately
      setReviews(reviews.map(review => 
        review._id === reviewId 
          ? { ...review, isApproved: false } 
          : review
      ));

      revalidateHome('home:testimonials');
      alert('Review rejected successfully');
    } catch (err: any) {
      alert('Failed to reject review');
      console.error('Error rejecting review:', err);
    }
  };

  const handleDelete = async (reviewId: string) => {
    if (!confirm('Are you sure you want to delete this review? This action cannot be undone.')) {
      return;
    }
    
    try {
      const endpoint = `/reviews/${reviewId}/admin`;
      await apiClient.delete(endpoint);
      
      // Remove from UI immediately
      setReviews(reviews.filter(review => review._id !== reviewId));

      revalidateHome('home:testimonials');
      alert('Review deleted successfully');
    } catch (err: any) {
      alert('Failed to delete review');
      console.error('Error deleting review:', err);
    }
  };

  const handleToggleTestimonial = async (reviewId: string, value: boolean) => {
    try {
      await apiClient.put(`/reviews/${reviewId}/testimonial`, { isTestimonial: value });
      setReviews(reviews.map(r => r._id === reviewId ? { ...r, isTestimonial: value } : r));
      // Testimonial flag directly drives the homepage testimonials shelf.
      revalidateHome('home:testimonials');
    } catch (err) {
      alert('Failed to update testimonial flag');
      console.error(err);
    }
  };

  const handlePageChange = (newPage: number) => {
    setPagination({ ...pagination, currentPage: newPage });
  };

  // ── Add-review modal (manual / seeded reviews) ──────────────────────────────
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<{ _id: string; name: string }[]>([]);
  const [form, setForm] = useState({
    productId: '', productName: '', reviewerName: '', rating: 5,
    title: '', comment: '', isVerifiedPurchase: false, isTestimonial: false, date: '',
  });

  const resetForm = () => {
    setForm({ productId: '', productName: '', reviewerName: '', rating: 5, title: '', comment: '', isVerifiedPurchase: false, isTestimonial: false, date: '' });
    setProductQuery(''); setProductResults([]);
  };

  useEffect(() => {
    if (!productQuery.trim() || form.productId) { setProductResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const data = await apiClient.get(`/products?search=${encodeURIComponent(productQuery)}&limit=8`) as any;
        setProductResults((data.products || []).map((p: any) => ({ _id: p._id, name: p.name })));
      } catch { setProductResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [productQuery, form.productId]);

  const handleAddReview = async () => {
    if (!form.productId || !form.reviewerName.trim() || !form.comment.trim()) {
      alert('Pick a product and fill reviewer name + comment');
      return;
    }
    try {
      setSubmitting(true);
      await apiClient.post('/reviews/admin', {
        productId: form.productId,
        reviewerName: form.reviewerName.trim(),
        rating: form.rating,
        title: form.title.trim() || undefined,
        comment: form.comment.trim(),
        isVerifiedPurchase: form.isVerifiedPurchase,
        isTestimonial: form.isTestimonial,
        date: form.date || undefined,
      });
      setShowAdd(false);
      resetForm();
      fetchReviews();
      revalidateHome('home:testimonials');
    } catch (err) {
      alert('Failed to create review');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return <div className="p-8 text-center">Loading...</div>;
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Review Management</h1>
          <p className="text-gray-600">Manage, moderate, and feature product reviews</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowAdd(true); }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Add Review
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Reviews</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sort By</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="createdAt">Date</option>
              <option value="rating">Rating</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Order</label>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as any)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
            <div className="relative">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search reviews..."
                className="w-full rounded-md border border-gray-300 px-3 py-2 pl-10 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Reviews Table */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading reviews...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="text-red-600">{error}</p>
            <button
              onClick={fetchReviews}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        ) : reviews.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-gray-600">No reviews found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Product
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      User
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Rating
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Comment
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Testimonial
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {reviews.map((review) => (
                    <tr key={review._id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{review.product?.name || 'Unknown Product'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {review.user?.name || review.guestName || 'Unknown'}
                          {!review.user && <span className="ml-2 text-xs text-gray-400">(manual)</span>}
                        </div>
                        <div className="text-sm text-gray-500">{review.user?.email || ''}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <svg
                                key={star}
                                className={`h-5 w-5 ${star <= review.rating ? 'text-yellow-400' : 'text-gray-300'}`}
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                              </svg>
                            ))}
                          </div>
                          <span className="ml-1 text-sm text-gray-500">{review.rating}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900 max-w-xs truncate">
                          {review.title && <div className="font-medium">{review.title}</div>}
                          <div className="text-gray-500">{review.comment}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {review.isApproved ? (
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                            Approved
                          </span>
                        ) : (
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => handleToggleTestimonial(review._id, !review.isTestimonial)}
                          title={review.isTestimonial ? 'Remove from testimonials' : 'Mark as testimonial'}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${
                            review.isTestimonial ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}
                        >
                          <Quote className="h-3.5 w-3.5" /> {review.isTestimonial ? 'Featured' : 'Off'}
                        </button>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(review.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end space-x-2">
                          {!review.isApproved ? (
                            <button
                              onClick={() => handleApprove(review._id)}
                              className="text-green-600 hover:text-green-900"
                              title="Approve"
                            >
                              <CheckCircle className="h-5 w-5" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleReject(review._id)}
                              className="text-yellow-600 hover:text-yellow-900"
                              title="Reject"
                            >
                              <XCircle className="h-5 w-5" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(review._id)}
                            className="text-red-600 hover:text-red-900"
                            title="Delete"
                          >
                            <Trash2 className="h-5 w-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* Pagination */}
            <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
              <div className="flex-1 flex justify-between sm:hidden">
                <button
                  onClick={() => handlePageChange(pagination.currentPage - 1)}
                  disabled={!pagination.hasPrev}
                  className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => handlePageChange(pagination.currentPage + 1)}
                  disabled={!pagination.hasNext}
                  className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
              <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-gray-700">
                    Showing <span className="font-medium">{(pagination.currentPage - 1) * 10 + 1}</span> to{' '}
                    <span className="font-medium">{Math.min(pagination.currentPage * 10, pagination.totalReviews)}</span> of{' '}
                    <span className="font-medium">{pagination.totalReviews}</span> results
                  </p>
                </div>
                <div>
                  <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                    <button
                      onClick={() => handlePageChange(pagination.currentPage - 1)}
                      disabled={!pagination.hasPrev}
                      className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <span className="sr-only">Previous</span>
                      <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </button>
                    
                    {/* Page numbers */}
                    {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map((page) => (
                      <button
                        key={page}
                        onClick={() => handlePageChange(page)}
                        className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                          page === pagination.currentPage
                            ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
                            : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        {page}
                      </button>
                    ))}
                    
                    <button
                      onClick={() => handlePageChange(pagination.currentPage + 1)}
                      disabled={!pagination.hasNext}
                      className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <span className="sr-only">Next</span>
                      <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </nav>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Add-review modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Add Review</h2>

            {/* Product picker */}
            <label className="block text-sm font-medium text-gray-700 mb-1">Product</label>
            {form.productId ? (
              <div className="flex items-center justify-between rounded-md border border-gray-300 px-3 py-2 mb-3">
                <span className="text-sm text-gray-900 truncate">{form.productName}</span>
                <button onClick={() => setForm({ ...form, productId: '', productName: '' })} className="text-xs text-blue-600">change</button>
              </div>
            ) : (
              <div className="relative mb-3">
                <input
                  type="text"
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  placeholder="Search product by name..."
                  className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {productResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {productResults.map(p => (
                      <button
                        key={p._id}
                        onClick={() => { setForm({ ...form, productId: p._id, productName: p.name }); setProductResults([]); }}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reviewer name</label>
                <input type="text" value={form.reviewerName} onChange={(e) => setForm({ ...form, reviewerName: e.target.value })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rating</label>
                <div className="flex items-center gap-1 py-1.5">
                  {[1, 2, 3, 4, 5].map(s => (
                    <button key={s} onClick={() => setForm({ ...form, rating: s })} title={`${s} star`}>
                      <Star className={`h-6 w-6 ${s <= form.rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}`} />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Title (optional)</label>
              <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Comment</label>
              <textarea value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} rows={3}
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.isVerifiedPurchase} onChange={(e) => setForm({ ...form, isVerifiedPurchase: e.target.checked })} />
                Verified Purchase badge
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.isTestimonial} onChange={(e) => setForm({ ...form, isTestimonial: e.target.checked })} />
                Feature as testimonial
              </label>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Date (optional, for backdating)</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div className="flex justify-end gap-3">
              <button onClick={() => { setShowAdd(false); resetForm(); }} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleAddReview} disabled={submitting} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">
                {submitting ? 'Saving…' : 'Create Review'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}