'use client';

/**
 * Write a review from a link, with no account.
 *
 * ── Why this page exists ────────────────────────────────────────────────────
 * Posting a review normally requires signing in. Most sales here begin on a
 * phone call or WhatsApp, and those customers will not create an account to
 * leave a review — so they were never asked, and 923 products carry five
 * reviews between them.
 *
 * The salesperson sends this link after delivery. The token in the URL is
 * signed by our server and names one order and one product, so the purchase is
 * already proven when the page opens: no login, and the review publishes
 * straight away with a verified-purchase badge.
 *
 * ── What the page must get right ────────────────────────────────────────────
 * The customer arrives from WhatsApp on a phone, probably once. So every state
 * is spelled out rather than left to a spinner: a used link, an expired link
 * and a bad link each say what happened and what to do, because the person
 * cannot "try again later" in any useful sense — they need to know whether to
 * ask the salesperson for a new link.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { Star, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import apiClient from '@/lib/api';

interface LinkTarget {
  product: { id: string; name: string; slug: string; image: string };
  suggestedName: string;
}

type Phase = 'loading' | 'ready' | 'done' | 'error';

export default function ReviewByLinkPage() {
  const { token } = useParams<{ token: string }>();

  const [phase, setPhase] = useState<Phase>('loading');
  const [target, setTarget] = useState<LinkTarget | null>(null);
  const [problem, setProblem] = useState<string>('');

  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get<{ success: boolean } & LinkTarget>(`/reviews/link/${token}`);
        if (cancelled) return;
        setTarget(res);
        // Prefilled from the order, and editable: usually right, but it is the
        // customer's review and their name to choose.
        setName(res.suggestedName || '');
        setPhase('ready');
      } catch (err: unknown) {
        if (cancelled) return;
        setProblem(err instanceof Error ? err.message : 'This review link is not valid.');
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating < 1 || !name.trim() || !comment.trim() || submitting) return;
    setSubmitting(true);
    try {
      await apiClient.post(`/reviews/link/${token}`, {
        rating,
        name: name.trim(),
        title: title.trim(),
        comment: comment.trim(),
      });
      setPhase('done');
    } catch (err: unknown) {
      setProblem(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setPhase('error');
    } finally {
      setSubmitting(false);
    }
  };

  if (phase === 'loading') {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl items-center justify-center px-4">
        <Loader2 className="h-6 w-6 animate-spin text-gold" aria-label="Loading" />
      </main>
    );
  }

  if (phase === 'error') {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-ink-muted" aria-hidden />
        <h1 className="mt-4 text-xl font-bold text-ink">We could not open this link</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{problem}</p>
        <p className="mt-6 text-[14px] text-ink-muted">
          If you bought this from us, ask your salesperson for a fresh link.
        </p>
        <Link href="/" className="mt-6 inline-block rounded-full bg-gold px-6 py-3 text-[14px] font-semibold text-white">
          Go to the store
        </Link>
      </main>
    );
  }

  if (phase === 'done') {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-gold" aria-hidden />
        <h1 className="mt-4 text-2xl font-bold text-ink">Thank you</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
          Your review is live on the product page. We read every one.
        </p>
        {target && (
          <Link
            href={`/products/${target.product.slug}`}
            className="mt-6 inline-block rounded-full bg-gold px-6 py-3 text-[14px] font-semibold text-white"
          >
            See it on {target.product.name}
          </Link>
        )}
      </main>
    );
  }

  const canSubmit = rating >= 1 && name.trim() && comment.trim() && !submitting;

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-[23px] font-bold leading-tight tracking-[-0.01em] text-ink">
        How was it?
      </h1>
      <p className="mt-1 text-[15px] text-ink-muted">
        You bought this from us — tell other customers what you think.
      </p>

      {target && (
        <div className="mt-6 flex items-center gap-4 rounded-xl border border-hairline bg-white p-4">
          {target.product.image ? (
            <Image
              src={target.product.image}
              alt=""
              width={64}
              height={64}
              className="h-16 w-16 rounded-lg object-contain"
            />
          ) : null}
          <span className="text-[15px] font-medium leading-snug text-ink">{target.product.name}</span>
        </div>
      )}

      <form onSubmit={submit} className="mt-6 space-y-5">
        <fieldset>
          <legend className="text-[14px] font-semibold text-ink">Your rating</legend>
          <div className="mt-2 flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                onMouseEnter={() => setHovered(n)}
                onMouseLeave={() => setHovered(0)}
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                aria-pressed={rating === n}
                className="p-1"
              >
                <Star
                  className={`h-9 w-9 ${(hovered || rating) >= n ? 'fill-gold text-gold' : 'text-hairline'}`}
                />
              </button>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="rev-name" className="block text-[14px] font-semibold text-ink">
            Your name
          </label>
          <p className="mt-0.5 text-[13px] text-ink-muted">Shown with your review. Edit it if you prefer.</p>
          <input
            id="rev-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            className="mt-2 w-full rounded-lg border border-hairline px-4 py-3 text-[15px] text-ink outline-none focus:border-gold"
          />
        </div>

        <div>
          <label htmlFor="rev-title" className="block text-[14px] font-semibold text-ink">
            Headline <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <input
            id="rev-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            placeholder="Sums up your experience"
            className="mt-2 w-full rounded-lg border border-hairline px-4 py-3 text-[15px] text-ink outline-none focus:border-gold"
          />
        </div>

        <div>
          <label htmlFor="rev-comment" className="block text-[14px] font-semibold text-ink">
            Your review
          </label>
          <textarea
            id="rev-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            required
            rows={5}
            placeholder="How does it fit? How does it perform? Would you buy it again?"
            className="mt-2 w-full rounded-lg border border-hairline px-4 py-3 text-[15px] leading-relaxed text-ink outline-none focus:border-gold"
          />
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-gold px-6 py-4 text-[15px] font-semibold text-white disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {submitting ? 'Sending…' : 'Publish my review'}
        </button>
      </form>
    </main>
  );
}
