'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import apiClient from '@/lib/api';

interface QuestionFormProps {
  productId: string;
  onSuccess?: () => void;
}

export default function QuestionForm({ productId, onSuccess }: QuestionFormProps) {
  const { user, isAuthenticated } = useAuth();
  const [question, setQuestion] = useState('');
  const [userName, setUserName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await apiClient.post('/product-questions', {
        productId,
        question,
        userName: isAuthenticated ? user?.name : userName,
        email: isAuthenticated ? user?.email : email
      });
      setSuccess(true);
      setQuestion('');
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to submit question');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
        <h3 className="text-green-800 font-medium text-lg mb-2">Question Submitted!</h3>
        <p className="text-green-600 mb-4">
          Thank you for your question. Our team will answer it shortly.
        </p>
        <button 
          onClick={() => setSuccess(false)}
          className="text-green-700 font-medium hover:underline"
        >
          Ask another question
        </button>
      </div>
    );
  }

  return (
    <div className="bg-obsidian border border-hairline rounded-xl p-6">
      <h3 className="text-lg font-bold text-ink mb-4">Ask a Question</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        {!isAuthenticated && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="userName" className="block text-sm font-medium text-ink/80 mb-1">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="userName"
                required
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="w-full rounded-lg border-hairline shadow-sm focus:border-gold focus:ring-gold"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-ink/80 mb-1">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                id="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border-hairline shadow-sm focus:border-gold focus:ring-gold"
              />
            </div>
          </div>
        )}

        <div>
          <label htmlFor="question" className="block text-sm font-medium text-ink/80 mb-1">
            Your Question <span className="text-red-500">*</span>
          </label>
          <textarea
            id="question"
            required
            rows={4}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            className="w-full rounded-lg border-hairline shadow-sm focus:border-gold focus:ring-gold"
            placeholder="Type your question here..."
          />
        </div>

        {error && (
          <div className="text-red-600 text-sm bg-red-50 p-3 rounded-lg">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full sm:w-auto px-6 py-2 bg-gold text-obsidian rounded-lg font-medium hover:bg-gold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gold disabled:bg-gray-400 transition-colors"
        >
          {loading ? 'Submitting...' : 'Submit Question'}
        </button>
      </form>
    </div>
  );
}
