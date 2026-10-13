'use client';

/**
 * "Copy review link" — one order line, one shareable link.
 *
 * ── Why a link and not a request email ──────────────────────────────────────
 * Most sales here start on a phone call or WhatsApp, and those customers will
 * not sign in to leave a review — which is why 923 products carry five reviews
 * between them. This hands the salesperson a URL to paste into the same
 * WhatsApp thread the sale happened in. The token in it is signed by our
 * server and names this order and this product, so the customer writes the
 * review with no account and it publishes immediately as a verified purchase.
 *
 * ── Why it shows the URL as well as copying it ──────────────────────────────
 * `navigator.clipboard` needs a secure context and a permission that an admin
 * on an office machine may not have granted. A silent failure here looks like
 * a broken button, so the link is always rendered and selectable, and the copy
 * is the convenience rather than the mechanism.
 */
import { useState } from 'react';
import { Link2, Check, Loader2 } from 'lucide-react';
import apiClient from '@/lib/api';

export default function ReviewLinkButton({
  orderId,
  productId,
  productName,
}: {
  orderId: string;
  productId: string;
  productName: string;
}) {
  const [url, setUrl] = useState('');
  const [expiresInDays, setExpiresInDays] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState('');

  const generate = async () => {
    setBusy(true);
    setProblem('');
    try {
      const res = await apiClient.post<{ url: string; expiresInDays: number }>(
        '/reviews/admin/review-link',
        { orderId, productId },
      );
      setUrl(res.url);
      setExpiresInDays(res.expiresInDays ?? null);
      try {
        await navigator.clipboard.writeText(res.url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch {
        // No clipboard permission — the link below is still there to select.
      }
    } catch (err: unknown) {
      setProblem(err instanceof Error ? err.message : 'Could not create the link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2">
      {!url && (
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          aria-label={`Create a review link for ${productName}`}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Link2 className="h-3.5 w-3.5" aria-hidden />}
          {busy ? 'Creating…' : 'Review link'}
        </button>
      )}

      {url && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-green-800">
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Link2 className="h-3.5 w-3.5" aria-hidden />}
            {copied ? 'Copied — paste it to the customer' : 'Send this to the customer'}
          </div>
          {/* Selectable, so it works even where the clipboard API does not. */}
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-1.5 w-full rounded border border-green-200 bg-white px-2 py-1 font-mono text-[11px] text-gray-700"
            aria-label="Review link"
          />
          {expiresInDays != null && (
            <p className="mt-1 text-[11px] text-green-700">
              Works once, and expires in {expiresInDays} days.
            </p>
          )}
        </div>
      )}

      {problem && <p className="mt-1 text-[11px] font-medium text-red-700">{problem}</p>}
    </div>
  );
}
