'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { CheckCircle, XCircle, Trash2, Eye, Filter, Search, Mail, MessageSquare, Clock } from 'lucide-react';

interface ContactMessage {
  _id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: 'new' | 'read' | 'replied' | 'closed';
  reply?: string;
  repliedAt?: string;
  adminNotes?: string;
  createdAt: string;
  updatedAt: string;
}

interface Pagination {
  page: number;
  pages: number;
  total: number;
  count: number;
}

export default function AdminMessagesPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pages: 1,
    total: 0,
    count: 0
  });
  
  // Filter states
  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'read' | 'replied' | 'closed'>('all');
  const [selectedMessage, setSelectedMessage] = useState<ContactMessage | null>(null);
  const [replyMode, setReplyMode] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const messageContentRef = useRef<HTMLDivElement>(null);

  // Check authentication
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  // Scroll to bottom when message content changes or reply is added
  useEffect(() => {
    if (messageContentRef.current) {
      messageContentRef.current.scrollTop = messageContentRef.current.scrollHeight;
    }
  }, [selectedMessage?._id, selectedMessage?.reply]);

  // Fetch messages
  useEffect(() => {
    if (isAuthenticated) {
      fetchMessages();
    }
  }, [isAuthenticated, pagination.page, statusFilter]);

  const fetchMessages = async () => {
    try {
      setLoading(true);
      
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: '20'
      });
      
      if (statusFilter !== 'all') {
        params.append('status', statusFilter);
      }
      
      const endpoint = `${API_ENDPOINTS.CONTACT}?${params.toString()}`;
      const response = await apiClient.get(endpoint) as any;

      if (response.success) {
        setMessages(response.data);
        setPagination({
          page: response.page,
          pages: response.pages,
          total: response.total,
          count: response.count
        });
      }
    } catch (err: any) {
      setError('Failed to load messages');
      console.error('Error fetching messages:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async (id: string, newStatus: string) => {
    try {
      await apiClient.put(`${API_ENDPOINTS.CONTACT}/${id}`, { status: newStatus });
      
      // Update UI immediately
      setMessages(messages.map(msg => 
        msg._id === id 
          ? { ...msg, status: newStatus as any } 
          : msg
      ));
      
      if (selectedMessage && selectedMessage._id === id) {
        setSelectedMessage({ ...selectedMessage, status: newStatus as any });
      }
      
    } catch (err: any) {
      alert('Failed to update status');
      console.error('Error updating status:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this message? This action cannot be undone.')) {
      return;
    }
    
    try {
      await apiClient.delete(`${API_ENDPOINTS.CONTACT}/${id}`);
      
      // Remove from UI immediately
      setMessages(messages.filter(msg => msg._id !== id));
      
      if (selectedMessage && selectedMessage._id === id) {
        setSelectedMessage(null);
      }
      
    } catch (err: any) {
      alert('Failed to delete message');
      console.error('Error deleting message:', err);
    }
  };

  const handlePageChange = (newPage: number) => {
    setPagination({ ...pagination, page: newPage });
  };

  const openMessage = async (message: ContactMessage) => {
    setSelectedMessage(message);
    setReplyMode(false);
    
    // Mark as read if it's new
    if (message.status === 'new') {
      await handleStatusUpdate(message._id, 'read');
    }
  };

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedMessage) return;

    setSendingReply(true);
    
    try {
      const response = await apiClient.post(`${API_ENDPOINTS.CONTACT}/${selectedMessage._id}/reply`, {
        message: replyText
      }) as any;

      if (response.success) {
        alert(`Reply sent to ${selectedMessage.email}`);
        setReplyMode(false);
        setReplyText('');
        
        // Update local state
        const updatedMessage = {
          ...selectedMessage,
          status: 'replied' as const,
          reply: replyText,
          repliedAt: new Date().toISOString()
        };
        
        setSelectedMessage(updatedMessage);
        
        setMessages(messages.map(msg => 
          msg._id === selectedMessage._id 
            ? updatedMessage 
            : msg
        ));
      }
    } catch (err: any) {
      alert(err.message || 'Failed to send reply');
      console.error('Error sending reply:', err);
    } finally {
      setSendingReply(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'new': return 'bg-blue-100 text-blue-800';
      case 'read': return 'bg-gray-100 text-gray-800';
      case 'replied': return 'bg-green-100 text-green-800';
      case 'closed': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (isLoading) {
    return <div className="p-8 text-center">Loading...</div>;
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="mb-6 flex-none">
        <h1 className="text-2xl font-bold text-gray-900">Messages & Inquiries</h1>
        <p className="text-gray-600">Manage contact form submissions</p>
      </div>

      <div className="flex flex-1 gap-6 overflow-hidden min-h-0">
        {/* Message List */}
        <div className={`w-full ${selectedMessage ? 'md:w-1/3 hidden md:flex' : 'flex'} flex-col bg-white rounded-lg shadow-md overflow-hidden`}>
          <div className="p-4 border-b border-gray-200">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Messages</option>
              <option value="new">New</option>
              <option value="read">Read</option>
              <option value="replied">Replied</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-gray-500">Loading messages...</div>
            ) : messages.length === 0 ? (
              <div className="p-8 text-center text-gray-500">No messages found</div>
            ) : (
              <ul className="divide-y divide-gray-200">
                {messages.map((message) => (
                  <li 
                    key={message._id} 
                    className={`p-4 hover:bg-gray-50 cursor-pointer transition-colors ${selectedMessage?._id === message._id ? 'bg-blue-50' : ''} ${message.status === 'new' ? 'border-l-4 border-blue-500' : ''}`}
                    onClick={() => openMessage(message)}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <h3 className={`text-sm font-medium ${message.status === 'new' ? 'text-gray-900 font-bold' : 'text-gray-900'}`}>
                        {message.name}
                      </h3>
                      <span className="text-xs text-gray-500">
                        {new Date(message.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-800 mb-1 truncate">{message.subject}</p>
                    <p className="text-xs text-gray-500 truncate">{message.message}</p>
                    <div className="mt-2 flex justify-between items-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(message.status)}`}>
                        {message.status.charAt(0).toUpperCase() + message.status.slice(1)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          
          {/* Pagination */}
          {pagination.pages > 1 && (
            <div className="p-4 border-t border-gray-200 flex justify-between items-center">
              <button
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={pagination.page === 1}
                className="px-3 py-1 border border-gray-300 rounded-md text-sm disabled:opacity-50"
              >
                Prev
              </button>
              <span className="text-sm text-gray-600">
                Page {pagination.page} of {pagination.pages}
              </span>
              <button
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page === pagination.pages}
                className="px-3 py-1 border border-gray-300 rounded-md text-sm disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* Message Detail */}
        {selectedMessage ? (
          <div className="w-full md:w-2/3 bg-white rounded-lg shadow-md flex flex-col overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex justify-between items-start">
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">{selectedMessage.subject}</h2>
                <div className="flex items-center text-sm text-gray-600 mb-1">
                  <Mail className="h-4 w-4 mr-2" />
                  <a href={`mailto:${selectedMessage.email}`} className="text-blue-600 hover:underline">
                    {selectedMessage.name} &lt;{selectedMessage.email}&gt;
                  </a>
                </div>
                <div className="flex items-center text-sm text-gray-500">
                  <Clock className="h-4 w-4 mr-2" />
                  {new Date(selectedMessage.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setSelectedMessage(null)}
                  className="md:hidden p-2 text-gray-500 hover:text-gray-700"
                >
                  Back
                </button>
                <div className="relative group">
                  <button className="p-2 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-100">
                    <Filter className="h-5 w-5" />
                  </button>
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-10 hidden group-hover:block border border-gray-200">
                    <button 
                      onClick={() => handleStatusUpdate(selectedMessage._id, 'new')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Mark as New
                    </button>
                    <button 
                      onClick={() => handleStatusUpdate(selectedMessage._id, 'read')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Mark as Read
                    </button>
                    <button 
                      onClick={() => handleStatusUpdate(selectedMessage._id, 'replied')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Mark as Replied
                    </button>
                    <button 
                      onClick={() => handleStatusUpdate(selectedMessage._id, 'closed')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Mark as Closed
                    </button>
                  </div>
                </div>
                <button 
                  onClick={() => handleDelete(selectedMessage._id)}
                  className="p-2 text-red-500 hover:text-red-700 rounded-full hover:bg-red-50"
                  title="Delete Message"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            </div>
            
            <div ref={messageContentRef} className="p-6 flex-1 overflow-y-auto bg-gray-50 min-h-0">
              <div className="bg-white p-6 rounded-lg border border-gray-200 whitespace-pre-wrap mb-6">
                <h3 className="text-sm font-semibold text-gray-500 mb-2 uppercase tracking-wider">Inquiry</h3>
                {selectedMessage.message}
              </div>

              {selectedMessage.reply && (
                <div className="bg-blue-50 p-6 rounded-lg border border-blue-200 whitespace-pre-wrap ml-8">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-sm font-semibold text-blue-800 uppercase tracking-wider">Reply</h3>
                    <span className="text-xs text-blue-600">
                      {selectedMessage.repliedAt && new Date(selectedMessage.repliedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-gray-800">{selectedMessage.reply}</div>
                </div>
              )}
            </div>
            
            <div className={`p-6 border-t border-gray-200 bg-white ${replyMode ? 'shadow-inner' : ''}`}>
              {replyMode ? (
                <form onSubmit={handleReply}>
                  <div className="mb-3">
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-sm font-medium text-gray-700">Reply to {selectedMessage.name}</label>
                      <button 
                        type="button" 
                        onClick={() => setReplyMode(false)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <XCircle className="h-5 w-5" />
                      </button>
                    </div>
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      rows={5}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      placeholder="Type your reply here..."
                      required
                    ></textarea>
                  </div>
                  <div className="flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={() => setReplyMode(false)}
                      className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={sendingReply}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center text-sm"
                    >
                      {sendingReply ? 'Sending...' : 'Send Reply'}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setReplyMode(true)}
                  className="w-full sm:w-auto px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center justify-center"
                >
                  <MessageSquare className="h-5 w-5 mr-2" />
                  Reply
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="hidden md:flex md:w-2/3 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300 items-center justify-center flex-col text-gray-500">
            <Mail className="h-16 w-16 mb-4 text-gray-300" />
            <p className="text-lg">Select a message to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}