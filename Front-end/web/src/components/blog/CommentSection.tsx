'use client';
import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Send } from 'lucide-react';

interface Comment {
  _id: string;
  name: string;
  comment: string;
  parent: string | null;
  createdAt: string;
}

interface CommentItemProps {
  comment: Comment;
  onReply?: () => void;
  isReplying?: boolean;
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function CommentItem({ comment, onReply, isReplying }: CommentItemProps) {
  return (
    <div className="flex gap-3">
      <div
        aria-hidden="true"
        className="flex-shrink-0 w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-xs font-bold select-none"
      >
        {initials(comment.name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-semibold text-sm text-gray-900">{comment.name}</span>
          <span className="text-xs text-gray-400">{timeAgo(comment.createdAt)}</span>
        </div>
        <p className="text-sm text-gray-700 leading-relaxed">{comment.comment}</p>
        {onReply && (
          <button
            onClick={onReply}
            className={`mt-1.5 text-xs font-medium transition-colors ${
              isReplying ? 'text-red-600' : 'text-gray-400 hover:text-gray-700'
            }`}
          >
            {isReplying ? 'Cancel reply' : 'Reply'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function CommentSection({ articleSlug }: { articleSlug: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', comment: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const loadComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/media/articles/${articleSlug}/comments`);
      const data = await res.json();
      if (data.success) setComments(data.data);
    } catch {
      // non-critical; fail silently
    } finally {
      setLoading(false);
    }
  }, [articleSlug]);

  useEffect(() => { loadComments(); }, [loadComments]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await fetch(`/api/v1/media/articles/${articleSlug}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, parent: replyTo }),
      });
      const data = await res.json();
      if (data.success) {
        setComments(prev => [...prev, data.data]);
        setForm({ name: '', email: '', comment: '' });
        setReplyTo(null);
        setSubmitted(true);
        setTimeout(() => setSubmitted(false), 3000);
      } else {
        setSubmitError(data.message || 'Failed to post comment.');
      }
    } catch {
      setSubmitError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const topLevel = comments.filter(c => !c.parent);
  const repliesFor = (id: string) => comments.filter(c => c.parent === id);
  const replyTarget = comments.find(c => c._id === replyTo);

  const inputClass =
    'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent';

  return (
    <section className="mt-6 bg-white rounded-xl border border-gray-200 p-6 light-inputs">
      <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
        <MessageSquare className="h-5 w-5" />
        Comments{!loading && ` (${comments.length})`}
      </h2>

      {/* Comment list */}
      {loading ? (
        <div className="space-y-4 mb-8">
          {[1, 2].map(i => (
            <div key={i} className="animate-pulse flex gap-3">
              <div className="w-9 h-9 rounded-full bg-gray-200 flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-1/4" />
                <div className="h-3 bg-gray-200 rounded w-full" />
                <div className="h-3 bg-gray-200 rounded w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : topLevel.length === 0 ? (
        <div className="text-center py-8 mb-8">
          <MessageSquare className="h-10 w-10 mx-auto mb-3 text-gray-300" />
          <p className="font-medium text-gray-700">Be the first to comment</p>
          <p className="text-sm text-gray-500 mt-1">Share your thoughts on this article</p>
        </div>
      ) : (
        <div className="space-y-6 mb-8">
          {topLevel.map(c => (
            <div key={c._id}>
              <CommentItem
                comment={c}
                onReply={() => setReplyTo(replyTo === c._id ? null : c._id)}
                isReplying={replyTo === c._id}
              />
              {/* Threaded replies */}
              {repliesFor(c._id).length > 0 && (
                <div className="ml-12 mt-3 space-y-4 border-l-2 border-gray-100 pl-4">
                  {repliesFor(c._id).map(r => (
                    <CommentItem key={r._id} comment={r} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Comment form */}
      <div className="border-t border-gray-100 pt-6">
        <h3 className="font-semibold text-gray-900 mb-4">
          {replyTarget ? (
            <span className="flex items-center gap-2">
              Replying to <span className="text-red-600">{replyTarget.name}</span>
              <button
                onClick={() => setReplyTo(null)}
                className="text-xs text-gray-400 hover:text-gray-700 font-normal underline ml-1"
              >
                cancel
              </button>
            </span>
          ) : 'Leave a Comment'}
        </h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="comment-name" className="block text-xs font-medium text-gray-700 mb-1">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="comment-name"
                type="text"
                name="name"
                required
                value={form.name}
                onChange={handleChange}
                placeholder="Your name"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="comment-email" className="block text-xs font-medium text-gray-700 mb-1">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                id="comment-email"
                type="email"
                name="email"
                required
                value={form.email}
                onChange={handleChange}
                placeholder="your@email.com"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="comment-text" className="block text-xs font-medium text-gray-700 mb-1">
              Comment <span className="text-red-500">*</span>
            </label>
            <textarea
              id="comment-text"
              name="comment"
              required
              rows={4}
              value={form.comment}
              onChange={handleChange}
              placeholder="Share your thoughts…"
              className={`${inputClass} resize-y`}
            />
          </div>

          {submitError && <p className="text-red-600 text-sm">{submitError}</p>}
          {submitted && (
            <p className="text-green-600 text-sm font-medium">
              ✓ Your comment has been posted!
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="h-4 w-4" />
            {submitting ? 'Posting…' : 'Post Comment'}
          </button>
        </form>
      </div>
    </section>
  );
}
