'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, PartyPopper, Tag, X } from 'lucide-react';
import { formatRupees } from '@/lib/formatRupees';
import type { DeliveryFeesQuote } from '@/hooks/useCheckoutQuote';

/**
 * Itemised delivery fees + the Black Friday "Apply offer" button.
 *
 * Every figure comes from the server quote (`quote.deliveryFees`); this renders it and
 * collects one intent — "apply the offer". It never computes or zeroes a fee itself:
 * money is server-confirmed before the UI commits to it, so the "₹0" and the
 * celebration appear only once a quote comes back with `offer.applied`.
 *
 * `fees === null` means the shop has fees switched off: shipping is then paid to the
 * courier on delivery, exactly as before, and that is what this shows.
 */

interface Props {
  fees: DeliveryFeesQuote | null | undefined;
  /** A quote is in flight. */
  loading?: boolean;
  /** The customer's intent (useDeliveryFeeOffer). */
  requested: boolean;
  onRequestChange: (next: boolean) => void;
  /** Cart / first checkout step: a PIN box (no address chosen yet). */
  pinInput?: { value: string; onChange: (pin: string) => void };
  format?: (n: number) => string;
  /** Test seam — forces the no-motion rendering. */
  reducedMotionOverride?: boolean;
}

const defaultFormat = (n: number) => formatRupees(n ?? 0, { exact: true });

export default function DeliveryFeeBreakdown({
  fees, loading = false, requested, onRequestChange, pinInput, format = defaultFormat, reducedMotionOverride,
}: Props) {
  if (fees === undefined) return null; // no quote yet
  if (fees === null) {
    return (
      <div className="flex justify-between text-sm">
        <span className="text-ink-muted font-display">Shipping</span>
        <span className="text-ink-muted font-display text-xs">Extra — paid on delivery</span>
      </div>
    );
  }

  const { offer } = fees;
  // The tap is waiting for the server: block a second tap (double-tap guard) and show
  // a spinner instead of a ₹0 the server has not confirmed yet.
  const pending = loading || offer.requested !== requested;
  const waived = offer.applied && !pending;

  const km = typeof fees.distanceKm === 'number' ? fees.distanceKm.toLocaleString('en-IN') : null;
  const placeName = [fees.place?.district, fees.place?.state].filter(Boolean).join(', ');

  return (
    <div className="space-y-2" data-testid="delivery-fees">
      <p className="text-[12px] font-display font-bold text-ink-muted uppercase tracking-[0.12em] pt-1">
        Delivery fees
      </p>
      {pinInput && <PinBox value={pinInput.value} onChange={pinInput.onChange} />}
      {fees.needsPin ? (
        <p className="text-sm text-ink-muted font-display" data-testid="delivery-fees-need-pin">
          Enter your PIN code to see delivery charges.
        </p>
      ) : (
        <>
          {(placeName || km) && (
            <p className="text-xs text-ink-muted font-display" data-testid="delivery-place">
              {placeName || `PIN ${fees.pin}`}{km ? ` · ~${km} km from ${fees.origin || 'Delhi'}` : ''}
            </p>
          )}
          <ul className="space-y-1.5">
            {fees.lines.map((l) => (
              <li key={l.code} className="flex justify-between text-sm">
                <span className="text-ink-muted font-display">{l.label}</span>
                <span className={`font-display ${waived ? 'text-ink-muted line-through' : 'text-ink/70'}`}>
                  {format(l.amount)}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between text-sm font-semibold">
            <span className="font-display text-ink">Delivery fees total</span>
            <span className={`font-display ${waived ? 'text-green-700' : 'text-ink'}`}>
              {waived ? format(0) : format(fees.total)}
            </span>
          </div>
        </>
      )}

      {offer.available && !waived && (
        <button
          type="button"
          onClick={() => onRequestChange(true)}
          disabled={pending}
          aria-busy={pending}
          className="w-full mt-2 rounded-lg bg-[#E3132C] hover:bg-[#c40f25] text-[#fff] font-display font-extrabold uppercase tracking-[0.08em] py-3.5 px-4 shadow-lg shadow-red-600/30 ring-2 ring-[#E3132C]/30 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-wait transition-colors"
        >
          {pending
            ? <><Loader2 className="h-5 w-5 animate-spin" /> Applying…</>
            : <><Tag className="h-5 w-5" /> Apply Black Friday offer{fees.total > 0 ? ` — save ${format(fees.total)}` : ''}</>}
        </button>
      )}

      {waived && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-green-600/40 bg-green-600/10 px-3 py-2">
          <span className="text-sm font-display font-bold text-green-700">
            {fees.needsPin
              ? 'Black Friday offer applied — every delivery fee will be ₹0'
              : `Black Friday offer applied — you saved ${format(offer.saving)}`}
          </span>
          <button
            type="button"
            onClick={() => onRequestChange(false)}
            className="text-xs font-display text-ink-muted underline hover:text-ink"
          >
            Remove
          </button>
        </div>
      )}

      {offer.error === 'offer_ended' && !pending && (
        <p role="alert" className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-display text-amber-800">
          The Black Friday offer has ended, so the delivery fees above now apply. Your total has been updated.
        </p>
      )}

      <FeeOfferCelebration
        applied={waived}
        saving={offer.saving}
        format={format}
        reducedMotionOverride={reducedMotionOverride}
      />
    </div>
  );
}

/**
 * "Congratulations! You saved ₹X" — once per transition into applied (a re-quote that
 * still has it applied says nothing). Dismissible, never blocks checkout, and all
 * motion sits behind prefers-reduced-motion.
 */
function FeeOfferCelebration({
  applied, saving, format, reducedMotionOverride,
}: { applied: boolean; saving: number; format: (n: number) => string; reducedMotionOverride?: boolean }) {
  const [shown, setShown] = useState(false);
  const [frozenSaving, setFrozenSaving] = useState(0);
  // "Worth celebrating" = applied with a real saving. A tap before the PIN is known
  // (saving 0) celebrates once the PIN prices the fees, not before.
  const worth = applied && saving > 0;
  const wasWorth = useRef(worth);

  useEffect(() => {
    if (worth && !wasWorth.current) {
      setFrozenSaving(saving);
      setShown(true);
    }
    wasWorth.current = worth;
  }, [worth, saving]);

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShown(false); };
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => setShown(false), 6000);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(t); };
  }, [shown]);

  if (!shown) return null;

  const reduced = reducedMotionOverride
    ?? (typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="fee-offer-title">
      <style>{`
        @keyframes abFeePop { from { opacity: 0; transform: translateY(12px) scale(0.95); } to { opacity: 1; transform: none; } }
        @keyframes abFeeConfetti { 0% { transform: translateY(-10vh) rotate(0); opacity: 1; } 100% { transform: translateY(70vh) rotate(540deg); opacity: 0; } }
      `}</style>
      <button type="button" aria-label="Dismiss" className="absolute inset-0 bg-black/60" onClick={() => setShown(false)} />
      {!reduced && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {Array.from({ length: 28 }, (_, i) => (
            <span
              key={i}
              className="absolute top-0 block h-2.5 w-1.5 rounded-sm"
              style={{
                left: `${(i * 37) % 100}%`,
                background: ['#E3132C', '#111111', '#FFFFFF', '#F5B54A'][i % 4],
                animation: `abFeeConfetti ${1.6 + (i % 5) * 0.25}s ease-in ${(i % 7) * 0.08}s forwards`,
              }}
            />
          ))}
        </div>
      )}
      <div
        className="relative w-full max-w-sm rounded-xl border-2 border-[#E3132C] bg-[#0b0b0b] p-6 text-center text-[#fff] shadow-2xl"
        style={reduced ? undefined : { animation: 'abFeePop 360ms cubic-bezier(0.16,1,0.3,1)' }}
      >
        <button type="button" onClick={() => setShown(false)} aria-label="Close" className="absolute right-3 top-3 text-white/60 hover:text-white">
          <X size={18} />
        </button>
        <PartyPopper size={34} className={`mx-auto mb-3 text-[#E3132C] ${reduced ? '' : 'animate-bounce'}`} />
        <p className="text-xs font-display font-bold uppercase tracking-[0.2em] text-[#E3132C]">Black Friday</p>
        <h2 id="fee-offer-title" className="mt-1 text-xl font-display font-extrabold">Congratulations!</h2>
        <p className="mt-2 text-lg font-display">
          You saved <span className="font-extrabold text-[#F5B54A]">{format(frozenSaving)}</span>
        </p>
        <p className="mt-1 text-xs text-white/70 font-display">Every delivery fee is ₹0 on this order.</p>
        <button
          type="button"
          onClick={() => setShown(false)}
          className="mt-5 w-full rounded-lg bg-[#E3132C] py-2.5 text-sm font-display font-bold uppercase tracking-wide hover:bg-[#c40f25]"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

/** 6-digit PIN box: reports a PIN only once it is complete and valid. */
function PinBox({ value, onChange }: { value: string; onChange: (pin: string) => void }) {
  const [draft, setDraft] = useState(value);
  // Remember what the box reported: an incomplete PIN reports '' — copying that
  // back would wipe the five digits still being typed (or corrected).
  const reported = useRef(value);
  useEffect(() => {
    if (value !== reported.current) { reported.current = value; setDraft(value); }
  }, [value]);
  const invalid = draft.length === 6 && !/^[1-9]\d{5}$/.test(draft);
  return (
    <div>
      <label htmlFor="delivery-pin" className="sr-only">Delivery PIN code</label>
      <input
        id="delivery-pin"
        inputMode="numeric"
        autoComplete="postal-code"
        placeholder="Enter PIN code"
        maxLength={6}
        value={draft}
        onChange={(e) => {
          const next = e.target.value.replace(/\D/g, '').slice(0, 6);
          setDraft(next);
          const pin = /^[1-9]\d{5}$/.test(next) ? next : '';
          reported.current = pin;
          onChange(pin);
        }}
        aria-invalid={invalid}
        className="w-full bg-obsidian-raised border border-hairline text-ink rounded-lg px-3 py-2 text-sm font-display focus:outline-none focus:border-gold"
      />
      {invalid && <p className="mt-1 text-xs text-red-600 font-display">Please enter a valid 6-digit PIN code.</p>}
    </div>
  );
}
