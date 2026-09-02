'use client';

import { useEffect, useRef, useState } from 'react';
import { X, CheckCircle, ChevronRight, ChevronLeft, AlertCircle, Video, FileText, Image as ImageIcon, Loader2 } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS, RETURN_REASONS, RETURN_WINDOW_DAYS } from '@/lib/constants';
import {
  getReturnUploadSignature,
  uploadReturnFile,
  type ReturnCredentials,
  type ReturnResourceType,
} from '@/lib/returnUploads';
import OrderItemCard from './shared/OrderItemCard';

interface OrderItem {
  _id: string;
  product?: { _id: string; name: string; price: number; images?: Array<{ url: string; alt?: string }> };
  quantity: number;
  price: number;
  name?: string;
  image?: string;
}

interface SelectedItem { productId: string; quantity: number }
interface Uploaded {
  publicId: string;
  // Which store holds it. Sent back with the ref so the API verifies against the
  // store the file actually went to — during the migration both hold live
  // evidence, and a customer may have started this form before a provider flip.
  provider: 'cloudinary' | 'r2';
  resourceType: ReturnResourceType;
  fileName: string;
}

interface ReturnRequestModalProps {
  orderId: string;
  orderNumber: string;
  /**
   * ELIGIBLE items only — delivered, and still inside their own return window. On a
   * split order each line's window runs from the parcel it arrived in, so the caller
   * filters (see lib/orderFulfilment.ts) rather than this modal re-deriving it.
   */
  items: OrderItem[];
  /**
   * How many lines were filtered OUT as ineligible. Shown so a customer looking at a
   * short list understands why, instead of assuming the form is broken.
   */
  excludedCount?: number;
  /** Delivery date of the OLDEST eligible line — drives the "delivered N days ago" copy. */
  deliveredAt: string;
  /**
   * Debit-card EMI: the bank holds one loan against the whole order and cannot unwind
   * part of it, so a refund is all-or-nothing. When true, every item must come back.
   * Display + guard-rail only — createReturnRequest re-checks on the server.
   */
  fullRefundOnly?: boolean;
  /** e.g. "Debit Card EMI · HDFC" — names the constraint in the notice. */
  paidByLabel?: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

const MB = 1024 * 1024;
const VIDEO_MAX = 60 * MB;
const PROOF_MAX = 15 * MB;
const PHOTO_MAX = 10 * MB;

export default function ReturnRequestModal({ orderId, orderNumber, items, excludedCount = 0, deliveredAt, fullRefundOnly = false, paidByLabel, onClose, onSuccess }: ReturnRequestModalProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedItems, setSelectedItems] = useState<Map<string, SelectedItem>>(new Map());
  const [returnReason, setReturnReason] = useState('');
  const [description, setDescription] = useState('');
  const [video, setVideo] = useState<Uploaded | null>(null);
  const [proof, setProof] = useState<Uploaded | null>(null);
  const [photos, setPhotos] = useState<Uploaded[]>([]);
  const [uploading, setUploading] = useState<{ slot: string; pct: number } | null>(null);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // A refund on this order is all-or-nothing, and only a MULTI-item order can get that
  // wrong — returning the only line of a single-item order is already a full return, so
  // those customers must never see the notice.
  const mustReturnEverything = fullRefundOnly && items.length > 1;

  const selectAllItems = () =>
    setSelectedItems(
      new Map(items.map((i) => [i._id, { productId: i.product?._id || i._id, quantity: i.quantity }]))
    );

  const allItemsSelected =
    selectedItems.size === items.length &&
    items.every((i) => selectedItems.get(i._id)?.quantity === i.quantity);

  // Start with everything selected so the default action is the one that works. The
  // customer can still change it — validateStep explains why it has to go back.
  useEffect(() => {
    if (mustReturnEverything) selectAllItems();
    // Items are fixed for the lifetime of the modal; run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mustReturnEverything]);


  // One signed params set is reused for every file in this submission.
  /*
    Cached for the CLOUDINARY path only, where one folder signature covers every
    file in the submission. The R2 path cannot reuse anything: a presigned PUT is
    bound to a single object key, so it is minted per file at selection time.
  */
  const sigRef = useRef<ReturnCredentials | null>(null);
  const totalSteps = 4;

  const daysSinceDelivery = deliveredAt
    ? Math.floor((Date.now() - new Date(deliveredAt).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // ── Eligibility gate: 4-day window ─────────────────────────────────────────
  if (deliveredAt && daysSinceDelivery > RETURN_WINDOW_DAYS) {
    return (
      <Shell>
        <div className="p-6 max-w-md">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center">
              <AlertCircle className="h-10 w-10 text-red-500" />
            </div>
          </div>
          <h3 className="text-xl font-bold text-center mb-2">Return window closed</h3>
          <p className="text-ink-muted text-center mb-6">
            Returns must be raised within {RETURN_WINDOW_DAYS} days of delivery. This order was delivered {daysSinceDelivery} days ago.
          </p>
          <button onClick={onClose} className="w-full bg-gold text-obsidian px-4 py-3 rounded-lg font-medium">Close</button>
        </div>
      </Shell>
    );
  }

  /*
    Debit-card EMI is all-or-nothing at the bank, so every line must come back — but on
    a split order a line can fall out of its own window while the others are still in
    theirs. Those two rules cannot both be satisfied, and letting the customer build a
    request the server will refuse (or worse, one we collect goods for and then cannot
    refund) is the wrong failure. Send them to a human instead.
  */
  if (fullRefundOnly && excludedCount > 0) {
    return (
      <Shell>
        <div className="p-6 max-w-md">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center">
              <AlertCircle className="h-10 w-10 text-red-500" />
            </div>
          </div>
          <h3 className="text-xl font-bold text-center mb-2">This one needs a human</h3>
          <p className="text-ink-muted text-center mb-6">
            {paidByLabel ? `${paidByLabel} orders` : 'This order'} can only be refunded in full,
            so every item has to come back — but {excludedCount === 1 ? 'one item is' : `${excludedCount} items are`}{' '}
            already outside {excludedCount === 1 ? 'its' : 'their'} return window.
            Please contact support and we&apos;ll sort it out with you.
          </p>
          <button onClick={onClose} className="w-full bg-gold text-obsidian px-4 py-3 rounded-lg font-medium">Close</button>
        </div>
      </Shell>
    );
  }

  const ensureCredentials = async (slot: string, contentType: string) => {
    // A cached Cloudinary signature is reusable; anything else (no cache yet, or
    // an R2 deployment) needs a fresh call bound to this slot and file.
    if (sigRef.current && sigRef.current.provider !== 'r2') return sigRef.current;
    const creds = await getReturnUploadSignature(slot, contentType);
    if (creds.provider !== 'r2') sigRef.current = creds;
    return creds;
  };

  const handleUpload = async (
    file: File, slot: 'video' | 'proof' | 'photo', resourceType: ReturnResourceType, maxBytes: number,
  ) => {
    if (file.size > maxBytes) {
      setError(`${slot === 'video' ? 'Video' : slot === 'proof' ? 'Proof of purchase' : 'Photo'} is too large (max ${Math.round(maxBytes / MB)}MB).`);
      return;
    }
    setError(null);
    try {
      /*
        Photo slots are INDEXED server-side (photo0…photo4) so each upload gets a
        key bound to its own slot. Using the count of already-uploaded photos as
        the index is safe because uploads are sequential here — the input is
        disabled while one is in flight.
      */
      const slotName = slot === 'photo' ? `photo${photos.length}` : slot;
      const creds = await ensureCredentials(slotName, file.type || 'application/octet-stream');
      setUploading({ slot, pct: 0 });
      const res = await uploadReturnFile(
        file, creds, resourceType, (pct) => setUploading({ slot, pct }), slotName,
      );
      const up: Uploaded = {
        publicId: res.publicId, provider: res.provider, resourceType, fileName: file.name,
      };
      if (slot === 'video') setVideo(up);
      else if (slot === 'proof') setProof(up);
      else setPhotos((p) => [...p, up].slice(0, 5));
    } catch (e) {
      setError((e as Error).message || 'Upload failed. Please try again.');
    } finally {
      setUploading(null);
    }
  };

  const handleItemSelect = (item: OrderItem, selected: boolean) => {
    const next = new Map(selectedItems);
    if (selected) next.set(item._id, { productId: item.product?._id || item._id, quantity: 1 });
    else next.delete(item._id);
    setSelectedItems(next);
  };
  const handleQuantityChange = (itemId: string, quantity: number) => {
    const next = new Map(selectedItems);
    const it = next.get(itemId);
    if (it) next.set(itemId, { ...it, quantity });
    setSelectedItems(next);
  };

  const validateStep = (step: number): string | null => {
    switch (step) {
      case 1:
        if (selectedItems.size === 0) return 'Select at least one item to return.';
        if (mustReturnEverything && !allItemsSelected) {
          return 'This order was paid by EMI on a debit card, so it can only be refunded in full. Every item has to be returned.';
        }
        break;
      case 2:
        if (!returnReason) return 'Select a reason for the return.';
        if (!description.trim()) return 'Describe the problem.';
        if (description.length > 2000) return 'Description cannot exceed 2000 characters.';
        break;
      case 3:
        if (!video) return 'A continuous unboxing video is required.';
        if (!proof) return 'Proof of purchase is required.';
        break;
      case 4: if (!policyAccepted) return 'Please accept the return policy to continue.'; break;
    }
    return null;
  };

  const handleNext = () => {
    const err = validateStep(currentStep);
    if (err) { setError(err); return; }
    setError(null);
    if (currentStep < totalSteps) setCurrentStep(currentStep + 1);
  };
  const handleBack = () => { setError(null); if (currentStep > 1) setCurrentStep(currentStep - 1); };

  const handleSubmit = async () => {
    for (const s of [1, 2, 3, 4]) {
      const err = validateStep(s);
      if (err) { setError(err); setCurrentStep(s); return; }
    }
    try {
      setIsSubmitting(true);
      setError(null);
      const payload = {
        orderId,
        items: Array.from(selectedItems.values()).map((s) => ({ productId: s.productId, quantity: s.quantity, reason: returnReason })),
        problemDescription: description.trim(),
        /*
          `provider` rides along so the API verifies each asset against the store
          it actually went to. Everything else about the file — size, format —
          the server re-derives there; these two fields are the whole claim.
        */
        video: { publicId: video!.publicId, provider: video!.provider, resourceType: video!.resourceType },
        proofOfPurchase: { publicId: proof!.publicId, provider: proof!.provider, resourceType: proof!.resourceType },
        images: photos.map((p) => ({ publicId: p.publicId, provider: p.provider, resourceType: p.resourceType })),
      };
      await apiClient.post(API_ENDPOINTS.RETURN_CREATE, payload);
      setSuccess(true);
    } catch (e) {
      setError((e as Error).message || 'Failed to submit return request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <Shell wide>
        <div className="p-6">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center">
              <CheckCircle className="h-10 w-10 text-green-500" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-center mb-2">Request submitted</h3>
          <p className="text-ink-muted text-center mb-6">
            Your return request for order #{orderNumber} has been received. We review every request within <strong>3–5 business days</strong> and will email you the decision.
          </p>
          <div className="bg-gold/10 border border-gold/40 rounded-lg p-4 mb-6 text-sm text-gold space-y-2">
            <p>1. We review your request and the unboxing video.</p>
            <p>2. If approved, <strong>we arrange the return pickup</strong>.</p>
            <p>3. After the item reaches us and passes inspection, your refund is issued to your original payment method.</p>
          </div>
          <button onClick={() => { onSuccess(); onClose(); }} className="w-full bg-gold text-obsidian px-4 py-3 rounded-lg font-medium">Done</button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell wide>
      {/* Header */}
      <div className="sticky top-0 bg-obsidian border-b border-hairline z-10">
        <div className="flex items-center justify-between p-6">
          <div>
            <h3 className="text-2xl font-bold">Request a return</h3>
            <p className="text-sm text-ink-muted mt-1">Order #{orderNumber}</p>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink transition" disabled={isSubmitting}><X className="h-6 w-6" /></button>
        </div>
        <div className="px-6 pb-4">
          <div className="flex items-center justify-between mb-2">
            {[1, 2, 3, 4].map((step) => (
              <div key={step} className="flex items-center flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${step <= currentStep ? 'bg-gold text-obsidian' : 'bg-obsidian-raised text-ink-muted'}`}>{step}</div>
                {step < 4 && <div className={`flex-1 h-1 mx-2 ${step < currentStep ? 'bg-gold' : 'bg-obsidian-raised'}`} />}
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-ink-muted">
            <span>Items</span><span>Reason</span><span>Evidence</span><span>Review</span>
          </div>
        </div>
      </div>

      <div className="p-6">
        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6"><p className="text-sm text-red-400">{error}</p></div>}

        {/* Step 1 — Items */}
        {currentStep === 1 && (
          <div className="space-y-4">
            <div>
              <h4 className="font-bold text-lg mb-1">Select items</h4>
              <p className="text-sm text-ink-muted mb-4">
                {mustReturnEverything
                  ? 'All items in this order need to be returned together — see below.'
                  : 'Choose which item(s) you want to return.'}
              </p>
              {/* A short list on a bigger order looks like a bug unless we say why. */}
              {excludedCount > 0 && (
                <p className="text-sm text-ink-muted border border-hairline rounded-lg p-3">
                  {excludedCount === 1 ? '1 item from this order is' : `${excludedCount} items from this order are`}{' '}
                  not shown: {excludedCount === 1 ? 'it has' : 'they have'} either not been delivered yet,
                  or {excludedCount === 1 ? 'its' : 'their'} {RETURN_WINDOW_DAYS}-day return window has closed.
                </p>
              )}
            </div>

            {/* Debit-card EMI: said here, at the first step, so nothing is shipped and no
                pickup is paid for before the customer knows the order is all-or-nothing. */}
            {mustReturnEverything && (
              <div className="rounded-lg border border-gold/30 bg-gold/5 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 shrink-0 text-gold" />
                  <div className="space-y-2 text-sm">
                    <p className="font-semibold text-ink/90">
                      This order was paid using {paidByLabel || 'Debit Card EMI'}.
                    </p>
                    <p className="text-ink-muted leading-relaxed">
                      Your bank can only cancel the whole EMI plan — it can&apos;t refund part of it. To get a
                      refund, all items in this order need to come back. You can re-order anything you&apos;d
                      like to keep straight away.
                    </p>
                    {!allItemsSelected && (
                      <button
                        type="button"
                        onClick={selectAllItems}
                        className="rounded-lg bg-gold px-4 py-2 font-medium text-obsidian transition hover:opacity-90"
                      >
                        Return all items
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
            {items.map((item) => {
              const isSelected = selectedItems.has(item._id);
              const sel = selectedItems.get(item._id);
              return (
                <div key={item._id}>
                  <OrderItemCard item={item} mode="select" selected={isSelected} onSelect={(s) => handleItemSelect(item, s)} />
                  {isSelected && sel && (
                    <div className="ml-14 mt-2 flex items-center gap-4">
                      <label className="text-sm font-medium text-ink/80">Quantity:</label>
                      <div className="flex items-center border border-hairline rounded-lg overflow-hidden">
                        <button type="button" onClick={() => handleQuantityChange(item._id, Math.max(1, sel.quantity - 1))} className="px-3 py-1 bg-obsidian-raised">-</button>
                        <span className="px-4 py-1 min-w-[3rem] text-center">{sel.quantity}</span>
                        <button type="button" onClick={() => handleQuantityChange(item._id, Math.min(item.quantity, sel.quantity + 1))} className="px-3 py-1 bg-obsidian-raised">+</button>
                      </div>
                      <span className="text-sm text-ink-muted">of {item.quantity}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Step 2 — Reason */}
        {currentStep === 2 && (
          <div className="space-y-6">
            <div>
              <h4 className="font-bold text-lg mb-1">Reason for return</h4>
              <p className="text-sm text-ink-muted mb-4">We accept returns only for these reasons.</p>
            </div>
            <div className="space-y-3">
              {RETURN_REASONS.map((reason) => (
                <label key={reason.value} className={`flex p-4 border rounded-lg cursor-pointer transition ${returnReason === reason.value ? 'border-gold bg-gold/10' : 'border-hairline'}`}>
                  <input type="radio" name="returnReason" value={reason.value} checked={returnReason === reason.value} onChange={(e) => setReturnReason(e.target.value)} className="h-4 w-4 text-gold mt-1" />
                  <div className="ml-3">
                    <span className="font-medium text-ink">{reason.label}</span>
                    <p className="text-sm text-ink-muted mt-1">{reason.description}</p>
                  </div>
                </label>
              ))}
            </div>
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-ink/80 mb-2">Describe the problem <span className="text-red-500">*</span></label>
              <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={2000}
                placeholder="Tell us exactly what's wrong…" className="w-full px-4 py-3 border border-hairline rounded-lg bg-obsidian-deep focus:outline-none focus:ring-2 focus:ring-gold resize-none" />
              <p className="text-xs text-ink-muted mt-1 text-right">{description.length}/2000</p>
            </div>
          </div>
        )}

        {/* Step 3 — Evidence */}
        {currentStep === 3 && (
          <div className="space-y-6">
            <div>
              <h4 className="font-bold text-lg mb-1">Mandatory evidence</h4>
              <p className="text-sm text-ink-muted">A continuous, uncut unboxing video and proof of purchase are <strong>required</strong> — a request without both cannot be reviewed.</p>
            </div>

            <UploadRow
              icon={<Video className="h-5 w-5" />} label="Unboxing video" required uploaded={video} accept="video/*"
              busy={uploading?.slot === 'video' ? uploading.pct : null} hint="Continuous, uncut, from the sealed package. Max 60MB."
              onFile={(f) => handleUpload(f, 'video', 'video', VIDEO_MAX)} onRemove={() => setVideo(null)} />

            <UploadRow
              icon={<FileText className="h-5 w-5" />} label="Proof of purchase" required uploaded={proof} accept="image/*,application/pdf"
              busy={uploading?.slot === 'proof' ? uploading.pct : null} hint="Invoice, order confirmation or payment receipt (image or PDF). Max 15MB."
              onFile={(f) => handleUpload(f, 'proof', f.type === 'application/pdf' ? 'raw' : 'image', PROOF_MAX)} onRemove={() => setProof(null)} />

            <div>
              <UploadRow
                icon={<ImageIcon className="h-5 w-5" />} label={`Photos (optional, up to 5)`} uploaded={null} accept="image/*"
                busy={uploading?.slot === 'photo' ? uploading.pct : null} hint="Close-up photos of the issue. Max 10MB each." disabled={photos.length >= 5}
                onFile={(f) => handleUpload(f, 'photo', 'image', PHOTO_MAX)} onRemove={() => {}} />
              {photos.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {photos.map((p, i) => (
                    <li key={p.publicId} className="flex items-center justify-between text-sm bg-obsidian-deep rounded px-3 py-2">
                      <span className="truncate">{p.fileName}</span>
                      <button onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))} className="text-ink-muted hover:text-red-400"><X className="h-4 w-4" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Step 4 — Review */}
        {currentStep === 4 && (
          <div className="space-y-6">
            <div>
              <h4 className="font-bold text-lg mb-1">Review &amp; submit</h4>
              <p className="text-sm text-ink-muted">Please confirm before submitting.</p>
            </div>
            <div className="border border-hairline rounded-lg p-4 text-sm space-y-2">
              <Row k="Reason" v={RETURN_REASONS.find((r) => r.value === returnReason)?.label || '—'} />
              <p className="font-medium text-ink pt-1">Items</p>
              {Array.from(selectedItems.entries()).map(([id, s]) => {
                const it = items.find((i) => i._id === id);
                return <div key={id} className="text-ink/80">{(it?.product?.name || it?.name || 'Item')} × {s.quantity}</div>;
              })}
              <div className="pt-2 border-t border-hairline flex gap-4 text-ink-muted text-xs">
                <span>Video ✓</span><span>Proof ✓</span>{photos.length > 0 && <span>{photos.length} photo(s)</span>}
              </div>
            </div>
            <div className="bg-obsidian-deep rounded-lg p-4 text-xs text-ink-muted">
              Refund (if approved) is issued to your original payment method after the item is received and passes inspection. The original delivery charge is not refundable. Approval is at our discretion, subject to warehouse verification.
            </div>
            <label className="flex items-start gap-3 p-4 bg-obsidian-deep rounded-lg cursor-pointer">
              <input type="checkbox" checked={policyAccepted} onChange={(e) => setPolicyAccepted(e.target.checked)} className="h-5 w-5 text-gold rounded mt-0.5" />
              <span className="text-sm text-ink/80">I confirm the details above are accurate and I have read the return policy.</span>
            </label>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 bg-obsidian border-t border-hairline p-6 flex justify-between z-10">
        <button onClick={currentStep === 1 ? onClose : handleBack} disabled={isSubmitting}
          className="px-6 py-2 border border-hairline rounded-lg text-ink/80 font-medium hover:bg-obsidian-deep transition flex items-center gap-2">
          {currentStep > 1 && <ChevronLeft className="h-4 w-4" />}{currentStep === 1 ? 'Cancel' : 'Back'}
        </button>
        <button onClick={currentStep === totalSteps ? handleSubmit : handleNext} disabled={isSubmitting || !!uploading}
          className="px-6 py-2 rounded-lg text-obsidian font-medium bg-gold hover:opacity-90 transition flex items-center gap-2 disabled:opacity-50">
          {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</> : currentStep === totalSteps ? 'Submit request' : <>Next <ChevronRight className="h-4 w-4" /></>}
        </button>
      </div>
    </Shell>
  );
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-obsidian-deep/70 flex items-center justify-center p-4 z-50">
      <div className={`bg-obsidian rounded-lg w-full ${wide ? 'max-w-3xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto border border-hairline`}>{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><span className="text-ink-muted">{k}</span><span className="text-ink">{v}</span></div>;
}

function UploadRow({
  icon, label, hint, required, uploaded, accept, busy, disabled, onFile, onRemove,
}: {
  icon: React.ReactNode; label: string; hint: string; required?: boolean; uploaded: Uploaded | null;
  accept: string; busy: number | null; disabled?: boolean; onFile: (f: File) => void; onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className={`border rounded-lg p-4 ${uploaded ? 'border-green-500/40 bg-green-500/5' : 'border-hairline'}`}>
      <div className="flex items-center gap-3">
        <div className="text-gold">{icon}</div>
        <div className="flex-1">
          <p className="font-medium text-ink text-sm">{label}{required && <span className="text-red-500"> *</span>}</p>
          <p className="text-xs text-ink-muted">{hint}</p>
        </div>
        {uploaded ? (
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            <button onClick={onRemove} className="text-ink-muted hover:text-red-400"><X className="h-4 w-4" /></button>
          </div>
        ) : busy !== null ? (
          <span className="text-xs text-gold">{busy}%</span>
        ) : (
          <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()}
            className="text-sm px-3 py-1.5 rounded border border-gold text-gold hover:bg-gold/10 disabled:opacity-40">Upload</button>
        )}
      </div>
      {busy !== null && <div className="mt-2 h-1 bg-obsidian-raised rounded overflow-hidden"><div className="h-full bg-gold" style={{ width: `${busy}%` }} /></div>}
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
    </div>
  );
}
