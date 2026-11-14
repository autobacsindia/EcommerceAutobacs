'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, CheckCircle2, Copy, Download, ImageDown, Loader2, MessageCircle, Pencil, RotateCcw, Share2, Trash2, Trophy } from 'lucide-react';
import { formatDateIST, formatDateTimeIST } from '@/lib/datetime';
import { MessagePreview } from './MessagePreview';
import {
  closeEnquiry, enquiryKeys, enquiryMessage, errorMessage, getEnquiry, markSent, photoUrl, removePhoto, reopenEnquiry, saveQuote, unitLabel, whatsappLink,
  type Enquiry, type EnquirySupplier, type Quote, type QuoteInput,
} from './enquiry';
import { GST_RATES, gstOn, rupees } from './pricing';
import { canShareFiles, downloadFiles, photoFiles, photoTotal } from './enquiryPhotos';

const input = 'w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';

export const STATUS_LABEL: Record<Enquiry['status'], string> = { sent: 'Waiting for replies', replied: 'Replies in', closed: 'Closed' };
export const STATUS_CLASS: Record<Enquiry['status'], string> = {
  sent: 'bg-amber-100 text-amber-800', replied: 'bg-green-100 text-green-800', closed: 'bg-gray-200 text-gray-700',
};

export default function EnquiryDetail({ id, base }: { id: string; base: string }) {
  const q = useQuery({ queryKey: enquiryKeys.detail(id), queryFn: () => getEnquiry(id) });
  if (q.isLoading) return <DetailSkeleton />;
  if (q.isError || !q.data) {
    return (
      <div className="space-y-3">
        <Link href={base} className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"><ArrowLeft className="h-4 w-4" /> All enquiries</Link>
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load this enquiry.')} <button type="button" className="underline" onClick={() => q.refetch()}>Try again</button></p>
      </div>
    );
  }
  return <Loaded e={q.data.enquiry} base={base} />;
}

function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading enquiry">
      <div className="h-8 w-56 animate-pulse rounded bg-gray-200" />
      <div className="h-40 animate-pulse rounded-xl bg-gray-100" />
      <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
    </div>
  );
}

function Loaded({ e, base }: { e: Enquiry; base: string }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [quoteFor, setQuoteFor] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);
  const closed = e.status === 'closed';
  // Set by the form when the enquiry saved but a photo upload did not.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('photos') === 'failed') {
      setError('The enquiry is saved, but some photos did not upload. Add them again from Edit.');
    }
  }, []);

  const apply = (next: Enquiry) => {
    qc.setQueryData(enquiryKeys.detail(e.id), { enquiry: next });
    qc.invalidateQueries({ queryKey: enquiryKeys.all, refetchType: 'none' });
  };
  // Stamp "sent" in the background; the WhatsApp tab has already opened, so a failure only costs the tick.
  const stampSent = (row: EnquirySupplier) => {
    if (row.sentAt) return;
    markSent(e.id, row.id).then((r) => apply(r.enquiry)).catch(() => {});
  };

  async function shareImage() {
    setImgBusy(true);
    setError('');
    try {
      // Loaded only when asked for: keeps the canvas code out of every other page.
      const { renderEnquiryImage, shareOrDownload } = await import('./enquiryImage');
      const blob = await renderEnquiryImage(e);
      await shareOrDownload(blob, `${e.ref}.png`, `${e.ref} — price enquiry from Autobacs India`);
    } catch (err) {
      setError((err as Error)?.message || 'Could not make the picture.');
    } finally {
      setImgBusy(false);
    }
  }

  async function reopen() {
    try { apply((await reopenEnquiry(e.id)).enquiry); } catch (err) { setError(errorMessage(err, 'Could not reopen it.')); }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href={base} className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"><ArrowLeft className="h-4 w-4" /> All enquiries</Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold text-gray-900">
              {e.ref} <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLASS[e.status]}`}>{STATUS_LABEL[e.status]}</span>
            </h1>
            <p className="text-sm text-gray-500">
              By {e.createdByName || '—'} · {formatDateTimeIST(e.createdAt)}
              {e.neededBy && <> · needed by {formatDateIST(e.neededBy)}</>}
              {e.deliverTo && <> · to {e.deliverTo}</>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!closed && <Link href={`${base}/${e.id}/edit`} className={btn}><Pencil className="h-4 w-4" /> Edit</Link>}
            {!closed && <button type="button" className={btn} onClick={() => setClosing((c) => !c)}><CheckCircle2 className="h-4 w-4" /> Close</button>}
            {closed && <button type="button" className={btn} onClick={reopen}><RotateCcw className="h-4 w-4" /> Reopen</button>}
          </div>
        </div>
        {closed && (
          <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
            Closed by {e.closedByName || '—'} on {formatDateIST(e.closedAt)}
            {e.chosenSupplierRow && <> · went with <strong>{e.suppliers.find((s) => s.id === e.chosenSupplierRow)?.name}</strong></>}
            {e.closeNote && <> — {e.closeNote}</>}
          </p>
        )}
        {closing && <CloseForm e={e} onDone={(next) => { apply(next); setClosing(false); }} onCancel={() => setClosing(false)} />}
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-gray-900">Send on WhatsApp</h2>
              <button type="button" className={btn} onClick={shareImage} disabled={imgBusy}>
                {imgBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageDown className="h-4 w-4" />} Share as image
              </button>
            </div>
            <p className="text-xs text-gray-500">“Open WhatsApp” opens a chat with the message already typed in — press send there. Each supplier is marked sent the first time.</p>
            {photoTotal(e) > 0 && (
              <p className="rounded-lg bg-blue-50 p-2.5 text-xs text-blue-900">
                WhatsApp links carry text only. To send the photos too, use <strong>Share</strong> on a phone (text + photos together), or <strong>Download photos</strong> below and attach them in the chat.
              </p>
            )}
            <ul className="divide-y divide-gray-100">
              {e.suppliers.map((s) => (
                <SupplierRow key={s.id} e={e} row={s} closed={closed} onSent={() => stampSent(s)}
                  quoting={quoteFor === s.id} onQuote={() => setQuoteFor((x) => (x === s.id ? null : s.id))}
                  onSaved={(next) => { apply(next); setQuoteFor(null); }} />
              ))}
            </ul>
          </section>

          <Photos e={e} closed={closed} onChange={apply} onError={setError} />
          <Comparison e={e} />
        </div>

        <aside className="xl:sticky xl:top-4 xl:self-start">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">The message</h2>
          <MessagePreview text={enquiryMessage(e, e.suppliers[0]?.name)} />
        </aside>
      </div>
    </div>
  );
}

function SupplierRow({ e, row, closed, onSent, quoting, onQuote, onSaved }: {
  e: Enquiry; row: EnquirySupplier; closed: boolean; onSent: () => void; quoting: boolean; onQuote: () => void; onSaved: (e: Enquiry) => void;
}) {
  const message = enquiryMessage(e, row.name);
  const link = whatsappLink(row.phone, message);
  const [copied, setCopied] = useState(false);
  // After mount: the server render has no navigator, and the first client render must match it.
  const [canShare, setCanShare] = useState(false);
  useEffect(() => { setCanShare(typeof navigator.share === 'function'); }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onSent();
    } catch { /* clipboard blocked: the preview is still selectable */ }
  }
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState('');
  async function share() {
    setShareError('');
    setSharing(true);
    try {
      // Text + the uploaded photos together where the phone can; text alone otherwise.
      const files = photoTotal(e) > 0 && canShareFiles() ? await photoFiles(e) : [];
      await navigator.share(files.length ? { text: message, files } : { text: message });
      onSent();
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') setShareError((err as Error)?.message || 'Could not share.');
    } finally {
      setSharing(false);
    }
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-gray-900">{row.name}</div>
          <div className="text-xs text-gray-500">
            {row.phone || 'No WhatsApp number saved'}
            {' · '}
            {row.repliedAt ? <span className="text-green-700">Replied {formatDateTimeIST(row.repliedAt)}</span>
              : row.sentAt ? <span>Sent {formatDateTimeIST(row.sentAt)}</span>
              : <span className="text-amber-700">Not sent yet</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {link ? (
            <a href={link} target="_blank" rel="noopener noreferrer" onClick={onSent}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#128c3f] px-3 py-1.5 text-sm font-semibold text-[#fff] hover:bg-[#0f7535]">
              <MessageCircle className="h-4 w-4" /> Open WhatsApp
            </a>
          ) : null}
          <button type="button" className={btn} onClick={copy}>{copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy'}</button>
          {canShare && <button type="button" className={btn} onClick={share} disabled={sharing}>{sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />} Share</button>}
          {!closed && <button type="button" className={btn} onClick={onQuote} aria-expanded={quoting}>{row.repliedAt ? 'Edit reply' : 'Record reply'}</button>}
        </div>
      </div>
      {shareError && <p role="alert" className="text-sm text-red-700">{shareError}</p>}
      {row.note && <p className="text-sm text-gray-600">“{row.note}”</p>}
      {quoting && <QuoteForm e={e} row={row} onSaved={onSaved} onCancel={onQuote} />}
    </li>
  );
}

/** Each item's photos: the catalogue one (sent as a link) and uploaded ones (private), with remove and download. */
function Photos({ e, closed, onChange, onError }: { e: Enquiry; closed: boolean; onChange: (e: Enquiry) => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const withPhotos = e.items.map((it, i) => ({ it, n: i + 1 })).filter(({ it }) => it.image || it.photos?.length);
  if (!withPhotos.length) return null;
  const total = photoTotal(e);

  async function download() {
    setBusy('download');
    onError('');
    try { downloadFiles(await photoFiles(e)); } catch (err) { onError((err as Error)?.message || 'Could not download the photos.'); } finally { setBusy(null); }
  }
  async function remove(photoId: string) {
    if (!window.confirm('Remove this photo?')) return;
    setBusy(photoId);
    onError('');
    try { onChange((await removePhoto(e.id, photoId)).enquiry); } catch (err) { onError(errorMessage(err, 'Could not remove the photo.')); } finally { setBusy(null); }
  }

  const thumb = 'relative block h-20 w-20 overflow-hidden rounded-lg border border-gray-200 bg-gray-50';
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-900">Photos</h2>
        {total > 0 && (
          <button type="button" className={btn} onClick={download} disabled={busy === 'download'}>
            {busy === 'download' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download photos ({total})
          </button>
        )}
      </div>
      <ul className="space-y-3">
        {withPhotos.map(({ it, n }) => (
          <li key={it.id}>
            <div className="mb-1 text-sm font-medium text-gray-800">{n}. {it.name}</div>
            <div className="flex flex-wrap gap-2">
              {it.image && (
                <a href={it.image} target="_blank" rel="noopener noreferrer" className={thumb} title="Catalogue photo — goes in the message as a link">
                  {/* eslint-disable-next-line @next/next/no-img-element -- catalogue thumbnail */}
                  <img src={it.image} alt={`${it.name} (catalogue)`} loading="lazy" className="h-full w-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 text-center text-[10px] text-[#fff]">Catalogue</span>
                </a>
              )}
              {(it.photos ?? []).map((p) => (
                <div key={p.id} className={thumb}>
                  <a href={photoUrl(e.id, p.id)} target="_blank" rel="noopener noreferrer" title={p.name}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- private photo, streamed by our API */}
                    <img src={photoUrl(e.id, p.id)} alt={p.name || 'Photo'} loading="lazy" className="h-full w-full object-cover" />
                  </a>
                  {!closed && (
                    <button type="button" aria-label={`Remove photo ${p.name}`} onClick={() => remove(p.id)} disabled={busy === p.id}
                      className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-gray-700 shadow hover:text-red-600 disabled:opacity-50">
                      {busy === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

type QuoteDraft = QuoteInput['quotes'][number];
const draftOf = (itemId: string, q?: Quote): QuoteDraft => ({
  itemId,
  unitPrice: q?.unitPaise == null ? '' : q.unitPaise % 100 === 0 ? String(q.unitPaise / 100) : (q.unitPaise / 100).toFixed(2),
  gstRate: q?.gstRate ?? 18,
  gstIncluded: q?.gstIncluded ?? false,
  available: q?.available ?? '',
  dispatchDays: q?.dispatchDays == null ? '' : String(q.dispatchDays),
  note: q?.note ?? '',
});

function QuoteForm({ e, row, onSaved, onCancel }: { e: Enquiry; row: EnquirySupplier; onSaved: (e: Enquiry) => void; onCancel: () => void }) {
  const [drafts, setDrafts] = useState<QuoteDraft[]>(() => e.items.map((i) => draftOf(i.id, row.quotes.find((q) => q.itemId === i.id))));
  const [note, setNote] = useState(row.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (i: number, patch: Partial<QuoteDraft>) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function save() {
    setBusy(true);
    setError('');
    try {
      onSaved((await saveQuote(e.id, row.id, { quotes: drafts, note })).enquiry);
    } catch (err) {
      setError(errorMessage(err, 'Could not save the reply. Please try again.'));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/40 p-3" role="group" aria-label={`Reply from ${row.name}`}>
      {e.items.map((it, i) => (
        <div key={it.id} className="space-y-2 rounded-lg bg-white p-2.5">
          <div className="text-sm font-medium text-gray-900">{i + 1}. {it.name} <span className="font-normal text-gray-500">· {it.qty} {unitLabel(it.qty, it.unit)}</span></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <label className="text-xs text-gray-600">Price / unit (₹)
              <input className={input} inputMode="decimal" value={drafts[i].unitPrice} onChange={(ev) => set(i, { unitPrice: ev.target.value })} /></label>
            <label className="text-xs text-gray-600">GST
              <select className={input} value={drafts[i].gstRate} onChange={(ev) => set(i, { gstRate: ev.target.value === '' ? '' : Number(ev.target.value) })}>
                {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                <option value="">Not said</option>
              </select></label>
            <label className="text-xs text-gray-600">Price is
              <select className={input} value={drafts[i].gstIncluded ? 'incl' : 'excl'} onChange={(ev) => set(i, { gstIncluded: ev.target.value === 'incl' })}>
                <option value="excl">+ GST</option><option value="incl">incl. GST</option>
              </select></label>
            <label className="text-xs text-gray-600">In stock?
              <select className={input} value={drafts[i].available} onChange={(ev) => set(i, { available: ev.target.value as QuoteDraft['available'] })}>
                <option value="">—</option><option value="yes">Yes</option><option value="partial">Partly</option><option value="no">No</option>
              </select></label>
            <label className="text-xs text-gray-600">Dispatch (days)
              <input className={input} inputMode="numeric" value={drafts[i].dispatchDays} onChange={(ev) => set(i, { dispatchDays: ev.target.value })} /></label>
          </div>
          <input aria-label={`Note for ${it.name}`} className={input} maxLength={300} placeholder="Note (optional)" value={drafts[i].note} onChange={(ev) => set(i, { note: ev.target.value })} />
        </div>
      ))}
      <textarea aria-label="Overall note" rows={2} className={input} maxLength={500} placeholder="Anything else they said (validity, payment terms…)" value={note} onChange={(ev) => setNote(ev.target.value)} />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save reply
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100">Cancel</button>
      </div>
    </div>
  );
}

const withGst = (q: Quote) => (q.unitPaise == null ? null : q.gstIncluded || !q.gstRate ? q.unitPaise : q.unitPaise + gstOn(q.unitPaise, q.gstRate));
const AVAIL: Record<string, string> = { yes: 'In stock', partial: 'Partly in stock', no: 'Not available', '': '' };

/** Per item, every supplier's answer side by side; the cheapest incl. GST marked (the server picks it). */
function Comparison({ e }: { e: Enquiry }) {
  const anyQuote = e.suppliers.some((s) => s.quotes.length);
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
      <h2 className="text-base font-semibold text-gray-900">Quotes</h2>
      {!anyQuote && <p className="text-sm text-gray-500">No replies recorded yet. When a supplier replies on WhatsApp, press “Record reply” beside them.</p>}
      {e.items.map((it, i) => {
        const rows = e.suppliers
          .map((s) => ({ s, q: s.quotes.find((q) => q.itemId === it.id) }))
          .filter((x): x is { s: EnquirySupplier; q: Quote } => !!x.q)
          .sort((a, b) => (withGst(a.q) ?? Infinity) - (withGst(b.q) ?? Infinity));
        return (
          <div key={it.id} className="rounded-lg border border-gray-200">
            <div className="border-b border-gray-100 px-3 py-2 text-sm">
              <span className="font-medium text-gray-900">{i + 1}. {it.name}</span>
              <span className="text-gray-500"> · {it.qty} {unitLabel(it.qty, it.unit)}{[it.brand, it.partNo].filter(Boolean).length ? ` · ${[it.brand, it.partNo].filter(Boolean).join(' · ')}` : ''}</span>
              {it.targetPaise != null && <span className="text-gray-500"> · target {rupees(it.targetPaise)} + GST</span>}
            </div>
            {rows.length === 0 ? <p className="px-3 py-2 text-sm text-gray-400">No quotes yet.</p> : (
              <ul className="divide-y divide-gray-100">
                {rows.map(({ s, q }) => {
                  const best = e.best[it.id] === s.id;
                  const unit = withGst(q);
                  return (
                    <li key={s.id} className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2 text-sm ${best ? 'bg-green-50' : ''}`}>
                      <span className="min-w-0">
                        <span className="font-medium text-gray-900">{s.name}</span>
                        {best && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-xs font-semibold text-[#fff]"><Trophy className="h-3 w-3" /> Best price</span>}
                        <span className="block text-xs text-gray-500">
                          {[AVAIL[q.available], q.dispatchDays != null ? `dispatch in ${q.dispatchDays} day${q.dispatchDays === 1 ? '' : 's'}` : '', q.note].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </span>
                      <span className="text-right tabular-nums">
                        {unit == null ? <span className="text-gray-400">No price</span> : (
                          <>
                            <span className="font-semibold text-gray-900">{rupees(unit)}</span><span className="text-xs text-gray-500"> /{unitLabel(1, it.unit)} incl. GST</span>
                            <span className="block text-xs text-gray-500">
                              {q.gstRate == null ? 'GST not said' : q.gstIncluded ? `${q.gstRate}% GST included` : `${rupees(q.unitPaise!)} + ${q.gstRate}% GST`}
                              {' · '}total {rupees(unit * it.qty)}
                            </span>
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}

function CloseForm({ e, onDone, onCancel }: { e: Enquiry; onDone: (e: Enquiry) => void; onCancel: () => void }) {
  const [chosen, setChosen] = useState<string>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true);
    setError('');
    try { onDone((await closeEnquiry(e.id, { note, chosenRowId: chosen || null })).enquiry); } catch (err) {
      setError(errorMessage(err, 'Could not close it.'));
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3" role="group" aria-label="Close enquiry">
      <label className="block text-sm text-gray-700">Which supplier did we go with?
        <select className={`${input} mt-1`} value={chosen} onChange={(ev) => setChosen(ev.target.value)}>
          <option value="">None / not decided</option>
          {e.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <input aria-label="Closing note" className={input} maxLength={500} placeholder="Note (optional), e.g. ordered 10 pcs" value={note} onChange={(ev) => setNote(ev.target.value)} />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Close enquiry
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100">Cancel</button>
      </div>
    </div>
  );
}
