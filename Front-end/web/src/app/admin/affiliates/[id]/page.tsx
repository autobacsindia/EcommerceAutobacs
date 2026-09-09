'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Ban, Check, RotateCcw, X } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatDateTimeIST } from '@/lib/datetime';

/**
 * Admin affiliate detail — approve, suspend, retune terms, record bank details.
 *
 * All money here arrives from the server in PAISE and is only divided for display.
 * Nothing on this screen computes an amount: the commission ledger is server-authored,
 * and a number the browser derived would be a second, quieter source of truth.
 */

interface PayoutDetails {
  accountHolderName?: string;
  accountLast4?: string;
  ifsc?: string;
  upiId?: string;
  // accountNumber and panNumber are never sent to the client — see the repository.
}

interface Affiliate {
  _id: string;
  code?: string;
  name: string;
  email: string;
  phone?: string;
  website?: string;
  pitch?: string;
  notes?: string;
  status: 'pending' | 'active' | 'suspended' | 'rejected';
  commissionPercent: number;
  discountPercent: number | null;
  firstOrderOnly: boolean;
  tdsPercent: number;
  payoutDetails?: PayoutDetails;
  coupon?: { code: string; value: number; isActive: boolean; usedCount: number } | null;
  approvedAt?: string | null;
  suspendedAt?: string | null;
  suspendedReason?: string;
  createdAt: string;
}

interface DetailResponse {
  success: boolean;
  affiliate: Affiliate;
  summary: Record<string, { netPaise: number; count: number }>;
  payableBalancePaise: number;
}

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const label = 'block text-sm font-medium text-gray-700 mb-1';
const input = 'w-full border border-gray-300 rounded-lg px-3 py-2';
const card = 'bg-white rounded-lg shadow p-6';

export default function AdminAffiliateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [terms, setTerms] = useState({ commissionPercent: '', discountPercent: '', tdsPercent: '', firstOrderOnly: true });
  const [approveCode, setApproveCode] = useState('');
  const [bank, setBank] = useState({ accountHolderName: '', accountNumber: '', ifsc: '', upiId: '', panNumber: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<DetailResponse>(API_ENDPOINTS.AFFILIATE_ADMIN_DETAIL(id));
      setData(res);
      setTerms({
        commissionPercent: String(res.affiliate.commissionPercent ?? ''),
        // Empty until approval decides it — the schema has no default, so "unset" and
        // "deliberately 0" stay distinguishable. Pre-fill a sensible starting point.
        discountPercent: res.affiliate.discountPercent == null
          ? '5'
          : String(res.affiliate.discountPercent),
        tdsPercent: String(res.affiliate.tdsPercent ?? 0),
        firstOrderOnly: res.affiliate.firstOrderOnly,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load affiliate');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  /** Run a mutation, surface its error, and always reload so the screen matches the server. */
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-gray-500">Loading…</p>;
  if (!data) {
    return (
      <div className="space-y-4">
        <p role="alert" className="text-red-600">{error || 'Not found'}</p>
        <Link href="/admin/affiliates" className="text-blue-600 hover:underline">Back to affiliates</Link>
      </div>
    );
  }

  const a = data.affiliate;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/admin/affiliates')} className="text-gray-500 hover:text-gray-900" aria-label="Back">
          <ArrowLeft className="w-5 h-5" aria-hidden />
        </button>
        <div>
          <h1 className="text-2xl font-semibold">{a.name}</h1>
          <p className="text-sm text-gray-500">
            {a.email} · applied {formatDateTimeIST(a.createdAt)}
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {/* ── Status + lifecycle actions ─────────────────────────────────────── */}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-gray-500">Status</p>
            <p className="text-lg font-medium capitalize">{a.status}</p>
            {a.code && <p className="mt-1 font-mono text-sm">{a.code}</p>}
            {a.suspendedReason && (
              <p className="mt-1 text-sm text-red-600">Suspended: {a.suspendedReason}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {a.status === 'pending' && (
              <button
                disabled={busy}
                onClick={() => {
                  if (!confirm('Decline this application? Their PAN and bank details are deleted, and this is terminal.')) return;
                  run(() => apiClient.post(API_ENDPOINTS.AFFILIATE_ADMIN_REJECT(id), {}));
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
              >
                <X className="w-4 h-4" aria-hidden /> Decline
              </button>
            )}

            {a.status === 'active' && (
              <button
                disabled={busy}
                onClick={() => {
                  const reason = prompt('Reason for suspending (optional):') ?? undefined;
                  run(() => apiClient.post(API_ENDPOINTS.AFFILIATE_ADMIN_SUSPEND(id), { reason }));
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                <Ban className="w-4 h-4" aria-hidden /> Suspend
              </button>
            )}

            {a.status === 'suspended' && (
              <button
                disabled={busy}
                onClick={() => run(() => apiClient.post(API_ENDPOINTS.AFFILIATE_ADMIN_REINSTATE(id), {}))}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
              >
                <RotateCcw className="w-4 h-4" aria-hidden /> Reinstate
              </button>
            )}
          </div>
        </div>

        {a.status === 'active' && (
          <p className="mt-4 text-xs text-gray-500">
            Suspending also deactivates their coupon, so the code stops discounting immediately.
            Commissions already attributed keep their normal lifecycle — the work was done.
          </p>
        )}
      </div>

      {/*
        ── Approve ──────────────────────────────────────────────────────────
        Commission and buyer discount are set HERE, at the moment of approval, because
        that is when they are actually decided — and because approval is what mints the
        managed coupon. Approving first and setting the discount afterwards leaves a live
        coupon worth 0% in between, which reads to a customer as a code that does nothing.
      */}
      {a.status === 'pending' && (
        <div className={card}>
          <h2 className="font-semibold text-gray-900">Approve this application</h2>
          <p className="mt-1 text-sm text-gray-500">
            Approving mints their coupon and emails them the code. Set the terms first.
          </p>

          <div className="grid gap-4 sm:grid-cols-3 mt-4">
            <div>
              <label className={label} htmlFor="approveCommission">Commission % *</label>
              <input id="approveCommission" className={input} type="number" min={0} max={100} step="0.1"
                value={terms.commissionPercent}
                onChange={(e) => setTerms((t) => ({ ...t, commissionPercent: e.target.value }))} />
              <p className="mt-1 text-xs text-gray-500">What we pay them.</p>
            </div>
            <div>
              <label className={label} htmlFor="approveDiscount">Buyer discount % *</label>
              <input id="approveDiscount" className={input} type="number" min={0} max={100} step="0.1"
                value={terms.discountPercent}
                onChange={(e) => setTerms((t) => ({ ...t, discountPercent: e.target.value }))} />
              <p className="mt-1 text-xs text-gray-500">
                What their audience saves. 0 means their code discounts nothing and stays
                inactive — link-only promotion.
              </p>
            </div>
            <div>
              <label className={label} htmlFor="approveCode">Code</label>
              <input id="approveCode" className={`${input} font-mono`}
                value={approveCode}
                onChange={(e) => setApproveCode(e.target.value.toUpperCase())}
                placeholder="Auto from name" />
              <p className="mt-1 text-xs text-gray-500">
                Leave blank to derive one. A code you type is used exactly or the approval
                fails — it is never silently altered.
              </p>
            </div>
          </div>

          <label className="flex items-center gap-2 mt-4 text-sm">
            <input type="checkbox" checked={terms.firstOrderOnly}
              onChange={(e) => setTerms((t) => ({ ...t, firstOrderOnly: e.target.checked }))} />
            Only pay on a customer&apos;s first order
          </label>

          <button
            disabled={busy || terms.commissionPercent === '' || terms.discountPercent === ''}
            onClick={() => run(() => apiClient.post(API_ENDPOINTS.AFFILIATE_ADMIN_APPROVE(id), {
              commissionPercent: Number(terms.commissionPercent),
              discountPercent: Number(terms.discountPercent),
              firstOrderOnly: terms.firstOrderOnly,
              ...(approveCode.trim() ? { code: approveCode.trim() } : {}),
            }))}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
          >
            <Check className="w-4 h-4" aria-hidden /> Approve and issue code
          </button>
        </div>
      )}

      {/* ── Earnings ───────────────────────────────────────────────────────── */}
      <div className={card}>
        <h2 className="font-semibold mb-4">Earnings</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <p className="text-sm text-gray-500">Payable now</p>
            <p className="text-2xl font-semibold">{rupees(data.payableBalancePaise)}</p>
          </div>
          {(['pending', 'approved', 'paid'] as const).map((key) => (
            <div key={key}>
              <p className="text-sm text-gray-500 capitalize">{key}</p>
              <p className="text-lg">{rupees(data.summary?.[key]?.netPaise ?? 0)}</p>
              <p className="text-xs text-gray-400">{data.summary?.[key]?.count ?? 0} orders</p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            disabled={busy || data.payableBalancePaise <= 0}
            onClick={() => {
              if (!confirm(
                `Build a payout batch for ${rupees(data.payableBalancePaise)}?\n\n`
                + 'This claims those commissions so they cannot be paid twice. Transfer the '
                + 'net from your bank, then record the UTR on the payouts screen.'
              )) return;
              run(async () => {
                await apiClient.post(`${API_ENDPOINTS.AFFILIATE_ADMIN_DETAIL(id)}/payouts`, {});
                router.push('/admin/affiliates/payouts');
              });
            }}
            className="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Build payout batch
          </button>
          <Link href="/admin/affiliates/payouts" className="text-sm text-blue-600 hover:underline">
            View all payouts
          </Link>
        </div>

        <p className="mt-4 text-xs text-gray-500">
          Pending becomes payable once the order has been delivered and the return window
          has closed. A refund after payout is carried as a negative row and nets off the
          next batch — a negative balance blocks a payout until future earnings clear it.
        </p>
      </div>

      {/* ── Terms (post-approval retuning) ─────────────────────────────────── */}
      {a.status !== 'pending' && (
      <div className={card}>
        <h2 className="font-semibold mb-4">Commercial terms</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={label} htmlFor="commissionPercent">Commission %</label>
            <input
              id="commissionPercent" className={input} type="number" min={0} max={100} step="0.1"
              value={terms.commissionPercent}
              onChange={(e) => setTerms((t) => ({ ...t, commissionPercent: e.target.value }))}
            />
          </div>
          <div>
            <label className={label} htmlFor="discountPercent">Buyer discount %</label>
            <input
              id="discountPercent" className={input} type="number" min={0} max={100} step="0.1"
              value={terms.discountPercent}
              onChange={(e) => setTerms((t) => ({ ...t, discountPercent: e.target.value }))}
            />
          </div>
          <div>
            <label className={label} htmlFor="tdsPercent">TDS %</label>
            <input
              id="tdsPercent" className={input} type="number" min={0} max={100} step="0.1"
              value={terms.tdsPercent}
              onChange={(e) => setTerms((t) => ({ ...t, tdsPercent: e.target.value }))}
            />
            <p className="mt-1 text-xs text-gray-500">Set by your accountant. We record it, we do not calculate it.</p>
          </div>
        </div>

        <label className="flex items-center gap-2 mt-4 text-sm">
          <input
            type="checkbox"
            checked={terms.firstOrderOnly}
            onChange={(e) => setTerms((t) => ({ ...t, firstOrderOnly: e.target.checked }))}
          />
          Only pay on a customer&apos;s first order
        </label>
        <p className="mt-1 text-xs text-gray-500">
          Recommended. Without it you pay commission on repeat customers who would have
          bought anyway — the biggest and least visible leak in a referral programme.
        </p>

        <button
          disabled={busy}
          onClick={() => run(() => apiClient.patch(API_ENDPOINTS.AFFILIATE_ADMIN_TERMS(id), {
            commissionPercent: Number(terms.commissionPercent),
            discountPercent: Number(terms.discountPercent),
            tdsPercent: Number(terms.tdsPercent),
            firstOrderOnly: terms.firstOrderOnly,
          }))}
          className="mt-5 px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
        >
          Save terms
        </button>
        <p className="mt-2 text-xs text-gray-500">
          A commission change applies to FUTURE orders only — every order stores the rate
          it was placed under, so past orders are never repriced.
        </p>
      </div>
      )}

      {/* ── Bank details ───────────────────────────────────────────────────── */}
      <div className={card}>
        <h2 className="font-semibold">Payout details</h2>
        <p className="mt-1 text-sm text-gray-500">
          {a.payoutDetails?.accountLast4
            ? `On file: ${a.payoutDetails.accountHolderName || '—'} · ••••${a.payoutDetails.accountLast4} · ${a.payoutDetails.ifsc || '—'}`
            : 'No bank details on file yet.'}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          The account number and PAN are write-only — they are never sent back to this
          screen. Re-enter them to change them.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 mt-4">
          <div>
            <label className={label} htmlFor="accountHolderName">Account holder</label>
            <input id="accountHolderName" className={input} value={bank.accountHolderName}
              onChange={(e) => setBank((b) => ({ ...b, accountHolderName: e.target.value }))} />
          </div>
          <div>
            <label className={label} htmlFor="accountNumber">Account number</label>
            <input id="accountNumber" className={input} value={bank.accountNumber} inputMode="numeric"
              onChange={(e) => setBank((b) => ({ ...b, accountNumber: e.target.value }))} />
          </div>
          <div>
            <label className={label} htmlFor="ifsc">IFSC</label>
            <input id="ifsc" className={input} value={bank.ifsc}
              onChange={(e) => setBank((b) => ({ ...b, ifsc: e.target.value.toUpperCase() }))} />
          </div>
          <div>
            <label className={label} htmlFor="upiId">UPI ID</label>
            <input id="upiId" className={input} value={bank.upiId}
              onChange={(e) => setBank((b) => ({ ...b, upiId: e.target.value }))} />
          </div>
          <div>
            <label className={label} htmlFor="panNumber">PAN</label>
            <input id="panNumber" className={input} value={bank.panNumber}
              onChange={(e) => setBank((b) => ({ ...b, panNumber: e.target.value.toUpperCase() }))} />
          </div>
        </div>

        <button
          disabled={busy}
          onClick={() => run(async () => {
            // Only send what was actually filled in — an empty string would fail the
            // format validators and would also blank a stored value.
            const payload = Object.fromEntries(
              Object.entries(bank).filter(([, v]) => String(v).trim() !== '')
            );
            if (Object.keys(payload).length === 0) return;
            await apiClient.put(API_ENDPOINTS.AFFILIATE_ADMIN_PAYOUT_DETAILS(id), payload);
            setBank({ accountHolderName: '', accountNumber: '', ifsc: '', upiId: '', panNumber: '' });
          })}
          className="mt-5 px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
        >
          Save payout details
        </button>
      </div>

      {/* ── Application ────────────────────────────────────────────────────── */}
      <div className={card}>
        <h2 className="font-semibold mb-3">Application</h2>
        <dl className="grid gap-3 sm:grid-cols-2 text-sm">
          <div><dt className="text-gray-500">Phone</dt><dd>{a.phone || '—'}</dd></div>
          <div>
            <dt className="text-gray-500">Website</dt>
            <dd>
              {a.website
                ? <a href={a.website} target="_blank" rel="noopener noreferrer nofollow" className="text-blue-600 hover:underline break-all">{a.website}</a>
                : '—'}
            </dd>
          </div>
          <div className="sm:col-span-2"><dt className="text-gray-500">Pitch</dt><dd className="whitespace-pre-wrap">{a.pitch || '—'}</dd></div>
          {a.coupon && (
            <div className="sm:col-span-2">
              <dt className="text-gray-500">Managed coupon</dt>
              <dd className="font-mono">
                {a.coupon.code} · {a.coupon.value}% · {a.coupon.isActive ? 'active' : 'inactive'} · used {a.coupon.usedCount}×
              </dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}
