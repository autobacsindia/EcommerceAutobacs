'use client';

/**
 * One return in the team panel: what came back and why, the evidence, and the next step
 * for whoever is looking at it. Which buttons show comes from the server's `can` flags —
 * the server re-checks every action, so a hidden button is a convenience, not the guard.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useReturnAction } from './useReturnAction';
import { AlertTriangle, Camera, FileText, Loader2, Video } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateIST, formatDateTimeIST } from '@/lib/datetime';
import { errorMessage, rupees } from '@/components/staff/sales/types';
import FilePicker from '@/components/payments/FilePicker';
import { MAX_ATTACHMENTS, PHOTO_OR_PDF } from '@/lib/attachments';
import ReturnRefundBox from './ReturnRefundBox';
import SupplierClaims from './SupplierClaims';
import { DISPOSITION_OPTIONS, FAULT_LABEL, FAULT_TONE, type ReturnDetail, type ReturnFault } from './types';
import { danger, input, primary, secondary } from './ui';


type Res = { success: boolean; return: ReturnDetail };

function FaultBadge({ fault, confirmed }: { fault: ReturnFault; confirmed?: boolean }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${FAULT_TONE[fault]}`}>
      {FAULT_LABEL[fault]}{confirmed ? ' · confirmed' : ''}
    </span>
  );
}

const Box = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
    <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
    {children}
  </section>
);

const ErrorLine = ({ error }: { error: unknown }) => (error
  ? <p role="alert" className="text-xs text-red-700">{errorMessage(error, 'That did not work. Refresh and try again.')}</p>
  : null);

// ── Check 1 ───────────────────────────────────────────────────────────────────────

function ReviewForm({ r }: { r: ReturnDetail }) {
  const act = useReturnAction(r.id);
  const [faults, setFaults] = useState<Record<string, { confirmed: ReturnFault; note: string }>>(() =>
    Object.fromEntries(r.lines.map((l, i) => [l.orderItemId || String(i), { confirmed: l.fault.claimed, note: '' }])));
  const [dest, setDest] = useState<string>('warehouse');
  const [otherSupplier, setOtherSupplier] = useState('');
  const [notes, setNotes] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const approve = () => {
    const supplierName = dest === '__other' ? otherSupplier.trim() : dest !== 'warehouse' ? dest : null;
    act.mutate({
      path: '/review',
      body: {
        decision: 'approve',
        faults,
        notes: notes || undefined,
        destination: supplierName ? { kind: 'supplier', supplierName } : { kind: 'warehouse' },
      },
    });
  };

  return (
    <Box title="Check 1 — the customer's photos and video">
      {r.lines.map((l, i) => {
        const key = l.orderItemId || String(i);
        const f = faults[key];
        return (
          <div key={key} className="space-y-1 text-sm">
            <p className="font-medium text-gray-800">{l.name} <span className="font-normal text-gray-500">— {l.reasonLabel}</span></p>
            <div className="flex flex-wrap gap-3">
              {(['ours', 'customer'] as const).map((v) => (
                <label key={v} className="flex items-center gap-1.5 text-xs">
                  <input type="radio" name={`fault-${r.id}-${key}`} checked={f.confirmed === v}
                    onChange={() => setFaults({ ...faults, [key]: { ...f, confirmed: v } })} />
                  {FAULT_LABEL[v]}
                </label>
              ))}
            </div>
            {f.confirmed !== l.fault.claimed && (
              <input className={input} placeholder="Why is it different from what the customer said? (required)" value={f.note}
                onChange={(e) => setFaults({ ...faults, [key]: { ...f, note: e.target.value } })} />
            )}
          </div>
        );
      })}
      <fieldset className="space-y-1 text-sm">
        <legend className="mb-1 text-xs font-semibold text-gray-700">Where does the item go?</legend>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="radio" name={`dest-${r.id}`} checked={dest === 'warehouse'} onChange={() => setDest('warehouse')} /> Our warehouse
        </label>
        {r.destinationOptions.suppliers.map((s) => (
          <label key={s} className="flex items-center gap-1.5 text-xs">
            <input type="radio" name={`dest-${r.id}`} checked={dest === s} onChange={() => setDest(s)} /> Straight to the supplier: {s}
          </label>
        ))}
        <label className="flex items-center gap-1.5 text-xs">
          <input type="radio" name={`dest-${r.id}`} checked={dest === '__other'} onChange={() => setDest('__other')} /> Another supplier
        </label>
        {dest === '__other' && <input className={input} placeholder="Supplier name" value={otherSupplier} onChange={(e) => setOtherSupplier(e.target.value)} />}
        <p className="text-[11px] text-gray-500">Send big or heavy items straight to the supplier.</p>
      </fieldset>
      <input className={input} placeholder="Note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      {!rejecting ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primary} disabled={act.isPending} onClick={approve}>Approve</button>
          <button type="button" className={danger} disabled={act.isPending} onClick={() => setRejecting(true)}>Reject…</button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea className={input} rows={2} placeholder="Why is it rejected? The customer is told." value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className={danger} disabled={act.isPending || !reason.trim()}
              onClick={() => act.mutate({ path: '/review', body: { decision: 'reject', rejectionReason: reason } })}>Reject return</button>
            <button type="button" className={secondary} onClick={() => setRejecting(false)}>Cancel</button>
          </div>
        </div>
      )}
      <ErrorLine error={act.error} />
    </Box>
  );
}

// ── Pickup ────────────────────────────────────────────────────────────────────────

function PickupForm({ r }: { r: ReturnDetail }) {
  const act = useReturnAction(r.id);
  const toSupplier = r.destination === 'supplier';
  const [provider, setProvider] = useState(r.courier?.provider || '');
  const [awb, setAwb] = useState(r.courier?.trackingNumber || '');
  const [bookedBy, setBookedBy] = useState<'us' | 'supplier'>(r.pickup?.bookedBy === 'supplier' ? 'supplier' : 'us');
  const [failNote, setFailNote] = useState('');
  const [failing, setFailing] = useState(false);
  const booked = r.status === 'courier_booked';

  return (
    <Box title={toSupplier ? `Pickup — straight to ${r.supplierName}` : 'Pickup to our warehouse'}>
      {r.can.pickup && (
        <div className="grid gap-2 sm:grid-cols-2">
          <input className={input} placeholder="Courier name" value={provider} onChange={(e) => setProvider(e.target.value)} />
          <input className={input} placeholder="Tracking / AWB number" value={awb} onChange={(e) => setAwb(e.target.value)} />
          {toSupplier && (
            <div className="flex gap-3 text-xs sm:col-span-2">
              {(['supplier', 'us'] as const).map((v) => (
                <label key={v} className="flex items-center gap-1.5">
                  <input type="radio" name={`bookedBy-${r.id}`} checked={bookedBy === v} onChange={() => setBookedBy(v)} />
                  {v === 'supplier' ? 'The supplier booked it' : 'We booked it'}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {r.can.pickup && (
          <button type="button" className={primary} disabled={act.isPending || !provider.trim() || !awb.trim()}
            onClick={() => act.mutate({ path: '/pickup', body: { provider, trackingNumber: awb, bookedBy } })}>
            {booked ? 'Correct courier details' : 'Save pickup'}
          </button>
        )}
        {r.can.droppedAtStore && (
          <button type="button" className={secondary} disabled={act.isPending}
            onClick={() => act.mutate({ path: '/dropped-at-store', body: {} })}>Customer dropped it at the store</button>
        )}
        {r.can.received && (
          <button type="button" className={secondary} disabled={act.isPending}
            onClick={() => act.mutate({ path: '/received', body: {} })}>{toSupplier ? 'The supplier has it' : 'Received at our warehouse'}</button>
        )}
        {r.can.pickup && !failing && (
          <button type="button" className={danger} disabled={act.isPending} onClick={() => setFailing(true)}>Pickup failed…</button>
        )}
      </div>
      {failing && (
        <div className="space-y-2">
          <input className={input} placeholder="What happened? (customer not home, refused…)" value={failNote} onChange={(e) => setFailNote(e.target.value)} />
          <p className="text-[11px] text-amber-700">
            {r.pickupAttempts >= 1 ? 'This is the second failed pickup — the return will be cancelled and the customer emailed.' : 'After two failed pickups the return is cancelled automatically.'}
          </p>
          <div className="flex gap-2">
            <button type="button" className={danger} disabled={act.isPending || !failNote.trim()}
              onClick={() => act.mutate({ path: '/pickup-failed', body: { note: failNote } }, { onSuccess: () => { setFailing(false); setFailNote(''); } })}>
              Record failed pickup
            </button>
            <button type="button" className={secondary} onClick={() => setFailing(false)}>Cancel</button>
          </div>
        </div>
      )}
      <ErrorLine error={act.error} />
    </Box>
  );
}

// ── Check 2 ───────────────────────────────────────────────────────────────────────

function SupplierCheckForm({ r }: { r: ReturnDetail }) {
  const act = useReturnAction(r.id);
  const [passed, setPassed] = useState<boolean | null>(null);
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState('');
  return (
    <Box title="The supplier's check">
      <PassFail name={`supcheck-${r.id}`} value={passed} onChange={setPassed} />
      <textarea className={input} rows={2} placeholder="What the supplier said" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <FilePicker files={files} onChange={setFiles} max={MAX_ATTACHMENTS} accept={PHOTO_OR_PDF}
        label="The supplier's photos (optional)" icon={<Camera className="h-4 w-4" />} onError={setFileError} />
      {fileError && <p className="text-xs text-red-700">{fileError}</p>}
      <button type="button" className={primary} disabled={act.isPending || passed === null || !notes.trim()}
        onClick={() => act.mutate({ path: '/supplier-check', body: { passed, notes }, files })}>Save the supplier&apos;s check</button>
      <p className="text-[11px] text-gray-500">Operations then confirms it — they decide whose fault it is for the customer.</p>
      <ErrorLine error={act.error} />
    </Box>
  );
}

function PassFail({ value, onChange, name }: { value: boolean | null; onChange: (v: boolean) => void; name: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <label className="flex items-center gap-1.5"><input type="radio" name={name} checked={value === true} onChange={() => onChange(true)} /> Passed</label>
      <label className="flex items-center gap-1.5"><input type="radio" name={name} checked={value === false} onChange={() => onChange(false)} /> Failed</label>
    </div>
  );
}

function InspectionForm({ r }: { r: ReturnDetail }) {
  const act = useReturnAction(r.id);
  const atSupplier = r.pickupMode === 'supplier_direct';
  const [passed, setPassed] = useState<boolean | null>(atSupplier ? (r.inspection?.supplierCheck?.passed ?? null) : null);
  const [notes, setNotes] = useState('');
  const [disposition, setDisposition] = useState('');
  const [failAction, setFailAction] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState('');
  const [faults, setFaults] = useState<Record<string, { confirmed: ReturnFault; note: string }>>({});
  const [pickupCost, setPickupCost] = useState('');
  const [pickupReason, setPickupReason] = useState('');
  const effective = (l: ReturnDetail['lines'][number], key: string) => faults[key]?.confirmed || l.fault.confirmed || l.fault.claimed;
  const anyCustomer = r.lines.some((l, i) => effective(l, l.orderItemId || String(i)) === 'customer');

  const ready = passed !== null && notes.trim()
    && (passed ? !!disposition : !!failAction)
    && (atSupplier || files.length > 0)
    && (!Number(pickupCost) || pickupReason.trim());

  return (
    <Box title={atSupplier ? "Check 2 — confirm the supplier's check" : 'Check 2 — inspect the item'}>
      {atSupplier && r.inspection?.supplierCheck && (
        <p className="rounded bg-white p-2 text-xs text-gray-700">
          Supplier: <strong>{r.inspection.supplierCheck.passed ? 'passed' : 'failed'}</strong> — {r.inspection.supplierCheck.notes}
        </p>
      )}
      <PassFail name={`inspect-${r.id}`} value={passed} onChange={setPassed} />
      <textarea className={input} rows={2} placeholder="What you found" value={notes} onChange={(e) => setNotes(e.target.value)} />
      {passed === true && (
        <select className={input} value={disposition} onChange={(e) => setDisposition(e.target.value)} aria-label="What happens to the item">
          <option value="">What happens to the item?</option>
          {DISPOSITION_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      )}
      {passed === false && (
        <select className={input} value={failAction} onChange={(e) => setFailAction(e.target.value)} aria-label="After a failed inspection">
          <option value="">The item…</option>
          <option value="send_back">Goes back to the customer at their cost</option>
          <option value="hold">Is held for 30 days, then disposed of</option>
        </select>
      )}
      {r.lines.map((l, i) => {
        const key = l.orderItemId || String(i);
        const now = effective(l, key);
        return (
          <div key={key} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-gray-700">{l.name}:</span>
            <select className="rounded border border-gray-300 px-2 py-1" value={now}
              onChange={(e) => setFaults({ ...faults, [key]: { confirmed: e.target.value as ReturnFault, note: faults[key]?.note || '' } })}>
              <option value="ours">{FAULT_LABEL.ours}</option>
              <option value="customer">{FAULT_LABEL.customer}</option>
            </select>
            {faults[key] && faults[key].confirmed !== (l.fault.confirmed || l.fault.claimed) && (
              <input className="flex-1 rounded border border-gray-300 px-2 py-1" placeholder="Why change it? (required)"
                value={faults[key].note} onChange={(e) => setFaults({ ...faults, [key]: { ...faults[key], note: e.target.value } })} />
            )}
          </div>
        );
      })}
      {passed === true && anyCustomer && (
        <div className="grid gap-2 sm:grid-cols-2">
          <input className={input} type="number" min="0" placeholder="Real pickup cost (₹) to deduct" value={pickupCost} onChange={(e) => setPickupCost(e.target.value)} />
          <input className={input} placeholder="What for (courier + AWB, or receipt)" value={pickupReason} onChange={(e) => setPickupReason(e.target.value)} />
          <p className="text-[11px] text-gray-500 sm:col-span-2">Customer&apos;s own reason: the real pickup cost comes off their refund.</p>
        </div>
      )}
      <FilePicker files={files} onChange={setFiles} max={MAX_ATTACHMENTS} accept={PHOTO_OR_PDF}
        label={atSupplier ? 'Photos (optional)' : 'Photos of the item (at least one)'} icon={<Camera className="h-4 w-4" />} onError={setFileError} />
      {fileError && <p className="text-xs text-red-700">{fileError}</p>}
      <button type="button" className={primary} disabled={act.isPending || !ready}
        onClick={() => act.mutate({
          path: '/inspection',
          body: {
            passed, notes, disposition: disposition || undefined, failAction: failAction || undefined,
            faults: Object.keys(faults).length ? faults : undefined,
            pickupCostRupees: Number(pickupCost) || undefined,
            pickupCostReason: pickupReason || undefined,
          },
          files,
        })}>
        Save inspection
      </button>
      <ErrorLine error={act.error} />
    </Box>
  );
}

// ── The panel ─────────────────────────────────────────────────────────────────────

export default function ReturnPanel({ id, showRefund = false }: { id: string; showRefund?: boolean }) {
  const q = useQuery({
    queryKey: staffKeys.returnOne(id),
    queryFn: () => apiClient.get<Res>(`/staff/returns/${id}`),
  });
  if (q.isPending) return <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  if (q.isError || !q.data?.return) return <p role="alert" className="text-sm text-red-700">{errorMessage(q.error, 'Could not load this return.')}</p>;
  const r = q.data.return;
  const fileUrl = (fileId: string) => `/api/v1/staff/returns/${r.id}/files/${fileId}`;

  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <p><span className="text-gray-500">Customer:</span> {r.customerContact.name}{r.customerContact.phone ? ` · ${r.customerContact.phone}` : ''}</p>
          <p><span className="text-gray-500">Sold by:</span> {r.seller}{r.raisedBy ? ` · raised by ${r.raisedBy}` : r.origin === 'customer' ? ' · raised on the website' : ''}</p>
          <p><span className="text-gray-500">Problem:</span> {r.problemDescription}</p>
          {r.repeatReturns > 1 && (
            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5" /> {r.repeatReturns} returns from this customer in the last 6 months
            </p>
          )}
          {r.rejectionReason && <p className="text-red-700">Rejected: {r.rejectionReason}</p>}
        </div>
        <ul className="space-y-1">
          {r.lines.map((l, i) => (
            <li key={l.orderItemId || i} className="rounded border border-gray-200 bg-white p-2">
              <p className="font-medium text-gray-900">{l.name} × {l.quantity} <span className="font-normal text-gray-500">· {rupees(l.unitPrice)} each</span></p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                {l.reasonLabel} <FaultBadge fault={l.fault.confirmed || l.fault.claimed} confirmed={!!l.fault.confirmed} />
              </p>
              {l.fault.note && <p className="text-xs text-gray-500">{l.fault.note}</p>}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        {r.evidence.video?.url && <a className="flex items-center gap-1 text-blue-700 underline" href={r.evidence.video.url} target="_blank" rel="noopener noreferrer"><Video className="h-3.5 w-3.5" /> Video</a>}
        {r.evidence.proofOfPurchase?.url && <a className="flex items-center gap-1 text-blue-700 underline" href={r.evidence.proofOfPurchase.url} target="_blank" rel="noopener noreferrer"><FileText className="h-3.5 w-3.5" /> Proof of purchase</a>}
        {r.evidence.images.map((img, i) => <a key={img.url} className="text-blue-700 underline" href={img.url} target="_blank" rel="noopener noreferrer">Customer photo {i + 1}</a>)}
        {r.files.map((f) => <a key={f.id} className="text-blue-700 underline" href={fileUrl(f.id)} target="_blank" rel="noopener noreferrer">{f.purpose.replace(/_/g, ' ')}: {f.name || 'file'}</a>)}
      </div>

      {r.courier?.trackingNumber && (
        <p className="text-xs text-gray-600">Pickup: {r.courier.provider} · AWB {r.courier.trackingNumber}{r.courier.bookedAt ? ` · ${formatDateIST(r.courier.bookedAt)}` : ''}{r.pickupAttempts ? ` · ${r.pickupAttempts} failed attempt${r.pickupAttempts > 1 ? 's' : ''}` : ''}</p>
      )}

      {r.can.review && <ReviewForm r={r} />}
      {(r.can.pickup || r.can.droppedAtStore || r.can.received) && <PickupForm r={r} />}
      {r.can.supplierCheck && <SupplierCheckForm r={r} />}
      {r.can.inspect && <InspectionForm r={r} />}
      {showRefund && (r.can.refund || r.refundDetail?.status === 'completed' || r.refundDetail?.status === 'processing') && <ReturnRefundBox r={r} />}
      {r.supplierClaims.length > 0 || (r.can.supplierClaims && r.inspection?.passed) ? <SupplierClaims r={r} /> : null}

      <details className="text-xs text-gray-600">
        <summary className="cursor-pointer font-semibold text-gray-700">History</summary>
        <ol className="mt-2 space-y-1 border-l-2 border-gray-200 pl-3">
          {r.timeline.map((t, i) => (
            <li key={i}><span className="text-gray-400">{formatDateTimeIST(t.timestamp)}</span> — {t.note || t.status}</li>
          ))}
        </ol>
      </details>
    </div>
  );
}
