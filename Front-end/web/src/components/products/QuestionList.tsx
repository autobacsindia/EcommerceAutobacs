'use client';

import { useState, useEffect } from 'react';
import apiClient from '@/lib/api';
import { User, Clock } from 'lucide-react';

interface Question {
  _id: string;
  question: string;
  answer?: string;
  userName: string;
  createdAt: string;
}

interface QuestionListProps {
  productId: string;
  legacyQna?: Array<{ question: string; answer: string }>;
}

export default function QuestionList({ productId, legacyQna = [] }: QuestionListProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchQuestions = async () => {
    try {
      const response: any = await apiClient.get(`/product-questions/product/${productId}`);
      if (response.success) {
        setQuestions(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch questions:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuestions();
  }, [productId]);

  // Combine legacy QnA with new QnA
  const allQuestions = [
    ...questions.map(q => ({
      id: q._id,
      question: q.question,
      answer: q.answer,
      user: q.userName,
      date: q.createdAt,
      isLegacy: false
    })),
    ...legacyQna.map((q, i) => ({
      id: `legacy-${i}`,
      question: q.question,
      answer: q.answer,
      user: 'Customer',
      date: null,
      isLegacy: true
    }))
  ];

  if (loading && legacyQna.length === 0) {
    return <div className="text-center py-4 text-ink-muted">Loading questions...</div>;
  }

  if (allQuestions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 mt-6">
      {allQuestions.map((item) => (
        <div key={item.id} className="bg-obsidian border border-hairline rounded-xl p-6">
          <div className="flex items-start gap-3 mb-3">
            <span className="flex-shrink-0 h-6 w-6 rounded-full bg-blue-100 text-gold flex items-center justify-center font-bold text-xs">Q</span>
            <div>
              <h3 className="font-semibold text-ink">{item.question}</h3>
              <div className="flex items-center gap-2 mt-1 text-xs text-ink-muted">
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {item.user}
                </span>
                {item.date && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(item.date).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          </div>
          
          {item.answer && (
            <div className="flex items-start gap-3 pl-9 border-t border-hairline pt-3 mt-3">
              <span className="flex-shrink-0 h-6 w-6 rounded-full bg-green-100 text-green-600 flex items-center justify-center font-bold text-xs">A</span>
              <p className="text-ink/80 leading-relaxed">{item.answer}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
