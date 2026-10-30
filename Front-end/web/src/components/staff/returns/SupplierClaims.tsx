'use client';

/**
 * The supplier track (rule 9.5B) on one return. Procurement records each step with the
 * supplier by hand; accounts confirms the promised money actually arrived — once.
 * Never blocks the customer refund.
 */
import { useState } from 'react';
import { errorMessage, rupees } from '@/components/staff/sales/types';
import { formatDateIST } from '@/lib/datetime';
import { useReturnAction } from './useReturnAction';
import { CLAIM_STATUS_LABEL, SETTLEMENT_LABEL, type ReturnDetail, type SupplierClaim } from './types';
import { danger, input, primary, secondary } from './ui';

function Claim({ r, c }: { r: ReturnDetail; c: SupplierClaim }) {
  const act = useReturnAction(r.id);
  const base = `/claims/${c._id}`;
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [courier, setCourier] = useState('');
  const [awb, setAwb] = useState('');
  const [kind, setKind] = useState<'credit_note' | 'refund' | 'free_replacement'>('credit_note');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'bank' | 'deducted'>('bank');
  const [utr, setUtr] = useState('');
  const [prRef, setPrRef] = useState('');
  const proc = r.can.supplierClaims;
  const replacement = c.settlement?.kind === 'free_replacement';

  return (
    <li className="space-y-2 rounded border border-gray-200 bg-white p-3">
      <p className="flex flex-wrap items-center gap-2 font-medium text-gray-900">
        {c.supplierName}
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-700">{CLAIM_STATUS_LABEL[c.status]}</span>
        {c.paymentRequestRef && <span className="text-xs font-normal text-gray-500">paid by {c.paymentRequestRef}</span>}
      </p>
      {c.answer?.accepted != null && (
        <p className="text-xs text-gray-600">Supplier {c.answer.accepted ? 'accepted' : 'rejected'}{c.answer.reference ? ` (ref ${c.answer.reference})` : ''}{c.answer.note ? ` — ${c.answer.note}` : ''}</p>
      )}
      {c.loss?.recorded && <p className="text-xs font-semibold text-red-700">Recorded as a loss against {c.supplierName}. The customer is refunded anyway.</p>}
      {c.shipBack?.trackingNumber && <p className="text-xs text-gray-600">Sent back with {c.shipBack.courier} · AWB {c.shipBack.trackingNumber}</p>}
      {c.supplierCheck?.passed != null && <p className="text-xs text-gray-600">Supplier&apos;s check: {c.supplierCheck.passed ? 'passed' : 'failed'}{c.supplierCheck.notes ? ` — ${c.supplierCheck.notes}` : ''}</p>}
      {c.settlement?.kind && (
        <p className="text-xs text-gray-700">
          Promised: {SETTLEMENT_LABEL[c.settlement.kind]}{c.settlement.amountPaise ? ` of ${rupees(c.settlement.amountPaise / 100)}` : ''}
          {c.settlement.reference ? ` (ref ${c.settlement.reference})` : ''}{c.settlement.promisedAt ? ` · ${formatDateIST(c.settlement.promisedAt)}` : ''}
        </p>
      )}
      {c.settlement?.received?.at && (
        <p className="text-xs font-semibold text-green-800">
          Received {c.settlement.received.method === 'bank' ? `in the bank (UTR ${c.settlement.received.utr})` : c.settlement.received.method === 'deducted' ? `— deducted from ${c.settlement.received.deductedFromRef}` : `— ${c.settlement.received.note}`}
          {c.settlement.received.byName ? ` · confirmed by ${c.settlement.received.byName}` : ''}
        </p>
      )}

      {proc && c.status === 'open' && (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={input} placeholder="Supplier's reference / RMA no." value={ref} onChange={(e) => setRef(e.target.value)} />
            <input className={input} placeholder="Note (required if rejected)" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button type="button" className={primary} disabled={act.isPending}
              onClick={() => act.mutate({ path: `${base}/answer`, body: { accepted: true, reference: ref || undefined, note: note || undefined } })}>Supplier accepted</button>
            <button type="button" className={danger} disabled={act.isPending || !note.trim()}
              onClick={() => act.mutate({ path: `${base}/answer`, body: { accepted: false, note } })}>Supplier rejected</button>
          </div>
        </div>
      )}
      {proc && ['open', 'accepted', 'promised'].includes(c.status) && !c.shipBack?.trackingNumber && r.destination !== 'supplier' && (
        <div className="grid gap-2 sm:grid-cols-3">
          <input className={input} placeholder="Courier (sending it back)" value={courier} onChange={(e) => setCourier(e.target.value)} />
          <input className={input} placeholder="Tracking number" value={awb} onChange={(e) => setAwb(e.target.value)} />
          <button type="button" className={secondary} disabled={act.isPending || !courier.trim() || !awb.trim()}
            onClick={() => act.mutate({ path: `${base}/ship-back`, body: { courier, trackingNumber: awb }, files: [] })}>Sent back to supplier</button>
        </div>
      )}
      {proc && c.status === 'accepted' && (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <select className={input} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Settlement">
              <option value="credit_note">Credit note</option>
              <option value="refund">Refund to us</option>
              <option value="free_replacement">Free replacement</option>
            </select>
            {kind !== 'free_replacement' && <input className={input} type="number" min="0" placeholder="Amount (₹)" value={amount} onChange={(e) => setAmount(e.target.value)} />}
            <input className={input} placeholder="Their reference" value={ref} onChange={(e) => setRef(e.target.value)} />
          </div>
          <button type="button" className={primary} disabled={act.isPending || (kind !== 'free_replacement' && !(Number(amount) > 0))}
            onClick={() => act.mutate({ path: `${base}/settlement`, body: { kind, amountRupees: Number(amount) || undefined, reference: ref || undefined } })}>
            Record what the supplier promised
          </button>
        </div>
      )}
      {c.status === 'promised' && (r.can.supplierMoney || (replacement && proc)) && (
        <div className="space-y-2 rounded bg-amber-50 p-2">
          <p className="text-xs font-semibold text-amber-900">{replacement ? 'Did the replacement arrive?' : 'Has the money arrived?'}</p>
          {!replacement && (
            <div className="flex gap-3 text-xs">
              <label className="flex items-center gap-1.5"><input type="radio" name={`m-${c._id}`} checked={method === 'bank'} onChange={() => setMethod('bank')} /> In our bank</label>
              <label className="flex items-center gap-1.5"><input type="radio" name={`m-${c._id}`} checked={method === 'deducted'} onChange={() => setMethod('deducted')} /> Taken off a supplier bill</label>
            </div>
          )}
          {!replacement && method === 'bank' && <input className={input} placeholder="Bank reference (UTR)" value={utr} onChange={(e) => setUtr(e.target.value)} />}
          {!replacement && method === 'deducted' && <input className={input} placeholder="Supplier payment request (PR-0000)" value={prRef} onChange={(e) => setPrRef(e.target.value)} />}
          {replacement && <input className={input} placeholder="How it arrived" value={note} onChange={(e) => setNote(e.target.value)} />}
          <button type="button" className={primary}
            disabled={act.isPending || (replacement ? !note.trim() : method === 'bank' ? !utr.trim() : !prRef.trim())}
            onClick={() => act.mutate({ path: `${base}/received`, body: replacement ? { note } : { method, utr: utr || undefined, deductedFromRef: prRef || undefined } })}>
            Confirm received
          </button>
        </div>
      )}
      {act.isError && <p role="alert" className="text-xs text-red-700">{errorMessage(act.error, 'That did not work. Refresh and try again.')}</p>}
    </li>
  );
}

function OpenClaim({ r }: { r: ReturnDetail }) {
  const act = useReturnAction(r.id);
  const [name, setName] = useState('');
  return (
    <div className="flex flex-wrap gap-2">
      <input className={`${input} max-w-xs`} placeholder="Supplier name" value={name} onChange={(e) => setName(e.target.value)} />
      <button type="button" className={secondary} disabled={act.isPending || !name.trim()}
        onClick={() => act.mutate({ path: '/claims', body: { supplierName: name } })}>Open a supplier claim</button>
      {act.isError && <p role="alert" className="w-full text-xs text-red-700">{errorMessage(act.error, 'Could not open the claim.')}</p>}
    </div>
  );
}

export default function SupplierClaims({ r }: { r: ReturnDetail }) {
  return (
    <section className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
      <h4 className="font-semibold text-gray-900">Supplier claim</h4>
      {r.supplierClaims.length === 0
        ? <p className="text-xs text-gray-600">No supplier claim — the item came from our own stock, or no supplier was recorded.</p>
        : <ul className="space-y-2">{r.supplierClaims.map((c) => <Claim key={c._id} r={r} c={c} />)}</ul>}
      {r.can.supplierClaims && r.inspection?.passed && r.supplierClaims.length === 0 && <OpenClaim r={r} />}
    </section>
  );
}
