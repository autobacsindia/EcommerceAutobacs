'use client';

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { 
  MessageSquare, 
  Search, 
  CheckCircle, 
  XCircle, 
  Clock, 
  MoreVertical,
  Edit2,
  Trash2,
  Filter
} from 'lucide-react';
import apiClient from '@/lib/api';
import Link from 'next/link';
import { productUrl } from '@/lib/types';

interface ProductQuestion {
  _id: string;
  product: {
    _id: string;
    slug?: string;
    name: string;
  };
  user?: string;
  userName: string;
  email?: string;
  question: string;
  answer?: string;
  status: 'pending' | 'answered' | 'rejected';
  isPublic: boolean;
  createdAt: string;
}

interface QuestionsResponse {
  success: boolean;
  data: ProductQuestion[];
  page: number;
  pages: number;
}

export default function AdminQuestionsPage() {
  const [questions, setQuestions] = useState<ProductQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  
  // Modal state
  const [selectedQuestion, setSelectedQuestion] = useState<ProductQuestion | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [answerText, setAnswerText] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchQuestions();
  }, [currentPage, statusFilter]);

  const fetchQuestions = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('pageNumber', currentPage.toString());
      if (statusFilter) params.append('status', statusFilter);

      const response: any = await apiClient.get(`/product-questions/admin?${params.toString()}`);
      if (response.success) {
        setQuestions(response.data);
        setTotalPages(response.pages);
      }
    } catch (error) {
      console.error('Failed to fetch questions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAnswerModal = (question: ProductQuestion) => {
    setSelectedQuestion(question);
    setAnswerText(question.answer || '');
    setIsPublic(question.isPublic !== false);
    setIsModalOpen(true);
  };

  const handleSubmitAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedQuestion) return;

    try {
      setSubmitting(true);
      await apiClient.put(`/product-questions/${selectedQuestion._id}/answer`, {
        answer: answerText,
        isPublic
      });
      
      setIsModalOpen(false);
      fetchQuestions(); // Refresh list
    } catch (error) {
      console.error('Failed to submit answer:', error);
      toast.error('Failed to submit answer');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (id: string) => {
    toast((t) => (
      <span className="flex items-center gap-3">
        Delete this question?
        <button
          className="bg-red-600 text-white text-xs px-2 py-1 rounded"
          onClick={async () => {
            toast.dismiss(t.id);
            try {
              await apiClient.delete(`/product-questions/${id}`);
              fetchQuestions();
              toast.success('Question deleted');
            } catch (error) {
              console.error('Failed to delete question:', error);
              toast.error('Failed to delete question');
            }
          }}
        >
          Delete
        </button>
        <button className="text-xs px-2 py-1 rounded border" onClick={() => toast.dismiss(t.id)}>
          Cancel
        </button>
      </span>
    ));
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'answered':
        return <span className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Answered</span>;
      case 'rejected':
        return <span className="bg-red-100 text-red-800 px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1"><XCircle className="h-3 w-3" /> Rejected</span>;
      default:
        return <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1"><Clock className="h-3 w-3" /> Pending</span>;
    }
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Product Questions</h1>
      </div>

      {/* Filters */}
      <div className="mb-6 flex gap-4">
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="pl-10 pr-8 py-2 border rounded-lg appearance-none bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="answered">Answered</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      {/* Questions Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Question</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-6 py-4 text-center">Loading...</td>
              </tr>
            ) : questions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-4 text-center text-gray-500">No questions found</td>
              </tr>
            ) : (
              questions.map((q) => (
                <tr key={q._id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(q.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate">
                    <Link href={productUrl(q.product, '/admin/products')} target="_blank" className="text-blue-600 hover:underline">
                      {q.product?.name || 'Unknown Product'}
                    </Link>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div className="font-medium">{q.userName}</div>
                    <div className="text-xs">{q.email}</div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900 max-w-md">
                    <p className="line-clamp-2">{q.question}</p>
                    {q.answer && (
                      <p className="text-xs text-green-600 mt-1 line-clamp-1">
                        <span className="font-semibold">Answer:</span> {q.answer}
                      </p>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(q.status)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleOpenAnswerModal(q)}
                      className="text-blue-600 hover:text-blue-900 inline-flex items-center gap-1 mr-4"
                    >
                      <Edit2 className="h-4 w-4" /> Reply
                    </button>
                    <button
                      onClick={() => handleDelete(q._id)}
                      className="text-red-600 hover:text-red-900 inline-flex items-center gap-1"
                    >
                      <Trash2 className="h-4 w-4" /> Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-4 py-2 text-sm rounded bg-white border border-gray-300 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-sm flex items-center">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-4 py-2 text-sm rounded bg-white border border-gray-300 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {/* Answer Modal */}
      {isModalOpen && selectedQuestion && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
            <h2 className="text-xl font-bold mb-4">
              Reply to {selectedQuestion.userName}
            </h2>
            
            <div className="mb-4 bg-gray-50 p-3 rounded text-sm text-gray-700">
              <span className="font-semibold">Question:</span> {selectedQuestion.question}
            </div>

            <form onSubmit={handleSubmitAnswer}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Answer
                </label>
                <textarea
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg h-32 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="Type your answer here..."
                  required
                />
              </div>

              <div className="mb-6">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={isPublic}
                    onChange={(e) => setIsPublic(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  Show on product page (Public)
                </label>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? 'Sending...' : 'Send Reply'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
