import apiClient from '@/lib/api-client';
import { postForm } from '@/lib/postForm';
import { formatDateIST } from '@/lib/datetime';
import { BRAND_NAME } from '@/lib/constants';
import { SUPPORT_PHONE_DISPLAY } from '@/lib/contactInfo';
import { rupees } from './pricing';

/**
 * Supplier price enquiries — the API (/api/supplier-enquiries) and the WhatsApp
 * message built from one. The message is built here, in the panel, and sent by
 * a person: wa.me opens WhatsApp with the text typed in, nothing is sent for them.
 */

export type EnquiryStatus = 'sent' | 'replied' | 'closed';
export const UNITS = ['pcs', 'sets', 'pairs', 'boxes', 'litres', 'kg', 'metres'] as const;
export type Unit = (typeof UNITS)[number];

export type EnquiryItem = {
  id: string;
  productId: string | null;
  name: string;
  brand: string;
  partNo: string;
  fitment: string;
  qty: number;
  unit: Unit;
  targetPaise: number | null;
  note: string;
  /** The catalogue product's photo (public URL, looked up by the server). */
  image?: string;
  /** Photos procurement uploaded — private, fetched through the API. */
  photos?: EnquiryPhoto[];
};

export type EnquiryPhoto = { id: string; name: string; contentType: string };
export const MAX_PHOTOS_PER_ITEM = 3;

export type Quote = {
  itemId: string;
  unitPaise: number | null;
  gstRate: number | null;
  gstIncluded: boolean;
  available: '' | 'yes' | 'partial' | 'no';
  dispatchDays: number | null;
  note: string;
};

export type EnquirySupplier = {
  id: string;
  supplierId: string;
  name: string;
  phone: string;
  sentAt: string | null;
  repliedAt: string | null;
  note: string;
  quotes: Quote[];
};

export type Enquiry = {
  id: string;
  ref: string;
  status: EnquiryStatus;
  neededBy: string | null;
  deliverTo: string;
  notes: string;
  showTargetPrice: boolean;
  contactName: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closedByName: string;
  closeNote: string;
  chosenSupplierRow: string | null;
  items: EnquiryItem[];
  suppliers: EnquirySupplier[];
  /** itemId → supplier row id with the lowest price incl. GST (worked out by the server). */
  best: Record<string, string>;
};

export type EnquiryRow = {
  id: string;
  ref: string;
  status: EnquiryStatus;
  createdAt: string;
  createdByName: string;
  neededBy: string | null;
  items: { name: string; qty: number; unit: Unit }[];
  itemCount: number;
  supplierCount: number;
  sentCount: number;
  repliedCount: number;
};

/** What the form sends (rupees as typed; the server converts to paise). */
export type EnquiryInput = {
  items: { id?: string; productId?: string | null; name: string; brand: string; partNo: string; fitment: string; qty: number; unit: Unit; target: string; note: string }[];
  supplierIds: string[];
  neededBy: string;
  deliverTo: string;
  notes: string;
  showTargetPrice: boolean;
  formKey?: string;
  updatedAt?: string;
};

export type QuoteInput = {
  quotes: { itemId: string; unitPrice: string; gstRate: number | ''; gstIncluded: boolean; available: Quote['available']; dispatchDays: string; note: string }[];
  note: string;
};

/** Query keys live with the others (hooks/queries/keys.ts). */
export { supplierEnquiryKeys as enquiryKeys } from '@/hooks/queries/keys';

type Page = { enquiries: EnquiryRow[]; nextAfter: string | null; summary?: { count: number; capped: boolean } };
export type CatalogProduct = { id: string; name: string; sku: string; image: string; price: number };

const BASE = '/supplier-enquiries';
export const listEnquiries = (params: Record<string, string>) => apiClient.get<Page>(`${BASE}?${new URLSearchParams(params)}`);
export const getEnquiry = (id: string) => apiClient.get<{ enquiry: Enquiry }>(`${BASE}/${encodeURIComponent(id)}`);
export const searchCatalog = (q: string) => apiClient.get<{ products: CatalogProduct[] }>(`${BASE}/products?q=${encodeURIComponent(q)}`);
export const createEnquiry = (body: EnquiryInput) => apiClient.post<{ enquiry: Enquiry }>(BASE, body);
export const updateEnquiry = (id: string, body: EnquiryInput) => apiClient.put<{ enquiry: Enquiry }>(`${BASE}/${encodeURIComponent(id)}`, body);
export const markSent = (id: string, rowId: string) => apiClient.post<{ enquiry: Enquiry }>(`${BASE}/${encodeURIComponent(id)}/suppliers/${encodeURIComponent(rowId)}/sent`, {});
export const saveQuote = (id: string, rowId: string, body: QuoteInput) => apiClient.put<{ enquiry: Enquiry }>(`${BASE}/${encodeURIComponent(id)}/suppliers/${encodeURIComponent(rowId)}/quote`, body);
export const closeEnquiry = (id: string, body: { note: string; chosenRowId: string | null }) => apiClient.post<{ enquiry: Enquiry }>(`${BASE}/${encodeURIComponent(id)}/close`, body);
export const photoUrl = (id: string, photoId: string) => `/api/v1${BASE}/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}`;
/** Upload up to MAX_PHOTOS_PER_ITEM photos to one item (multipart field `photo`). */
export function addPhotos(id: string, itemId: string, files: File[]) {
  const form = new FormData();
  for (const f of files) form.append('photo', f);
  return postForm<{ enquiry: Enquiry }>(`${BASE}/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/photos`, form);
}
export const removePhoto = (id: string, photoId: string) => apiClient.delete<{ enquiry: Enquiry }>(`${BASE}/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}`);
export const reopenEnquiry = (id: string) => apiClient.post<{ enquiry: Enquiry }>(`${BASE}/${encodeURIComponent(id)}/reopen`, {});

export const errorMessage = (e: unknown, fallback: string) =>
  (e as { rawData?: { message?: string } })?.rawData?.message || fallback;

// ── The WhatsApp message ────────────────────────────────────────────────────

export const COMPANY_WEBSITE = 'autobacsindia.com';

/**
 * The number as wa.me wants it: country code + digits. A 10-digit Indian number
 * (with or without a leading 0) gets 91; a number already carrying a country
 * code is kept. '' when it cannot be a phone number — then there is no link.
 */
export function waNumber(phone: string): string {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) return `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : '';
}

/** WhatsApp formatting markers in typed text would bold/strike half the message: neutralise them. */
const plain = (s: string) => s.replace(/[*_~`]/g, (c) => (c === '*' ? '∗' : c === '_' ? '‗' : c === '~' ? '∼' : 'ʼ'));

const SINGULAR: Record<Unit, string> = { pcs: 'pc', sets: 'set', pairs: 'pair', boxes: 'box', litres: 'litre', kg: 'kg', metres: 'metre' };
/** "10 pcs", "1 pc", "1 box". */
export const unitLabel = (qty: number, unit: Unit) => (qty === 1 ? SINGULAR[unit] ?? unit : unit);

/** A catalogue photo worth linking: an absolute http(s) URL only. */
const linkable = (url?: string) => (url && /^https?:\/\//i.test(url) ? url : '');
const photoCount = (n: number) => (n === 1 ? '1 photo' : `${n} photos`);

/**
 * The enquiry as one WhatsApp message, in three parts the supplier can answer
 * point by point: REQUIREMENT (what, how many, by when, where), REMARKS (our
 * notes) and PLEASE QUOTE (exactly what we need back).
 *
 * wa.me can only carry text, so a catalogue photo goes in as a link, and
 * uploaded photos are mentioned here and sent alongside (share sheet / download).
 */
export function enquiryMessage(e: Pick<Enquiry, 'ref' | 'createdAt' | 'neededBy' | 'deliverTo' | 'notes' | 'showTargetPrice' | 'contactName' | 'items'>, supplierName?: string): string {
  const lines: string[] = [];
  lines.push(`*${BRAND_NAME.toUpperCase()}*`, '_Price & availability enquiry_', '');
  lines.push(`Ref: *${e.ref}*`, `Date: ${formatDateIST(e.createdAt)}`, '');
  lines.push(supplierName ? `Dear ${plain(supplierName)},` : 'Dear Sir/Madam,');
  lines.push('Please send us your best quote for the items below.', '');

  lines.push('*REQUIREMENT*');
  e.items.forEach((it, i) => {
    lines.push(`*${i + 1}. ${plain(it.name)}*`);
    const id = [it.brand && `Brand: ${plain(it.brand)}`, it.partNo && `Part no: ${plain(it.partNo)}`].filter(Boolean).join(' · ');
    if (id) lines.push(`   ${id}`);
    if (it.fitment) lines.push(`   Fits: ${plain(it.fitment)}`);
    lines.push(`   Qty: *${it.qty} ${unitLabel(it.qty, it.unit)}*`);
    if (e.showTargetPrice && it.targetPaise) lines.push(`   Target price: ${rupees(it.targetPaise)} + GST per ${unitLabel(1, it.unit)}`);
    if (it.note) lines.push(`   Specs: ${plain(it.note)}`);
    const image = linkable(it.image);
    if (image) lines.push(`   Photo: ${image}`);
    const n = it.photos?.length || 0;
    if (n) lines.push(`   📷 ${photoCount(n)} sent with this message`);
  });
  lines.push('');
  if (e.neededBy) lines.push(`Needed by: *${formatDateIST(e.neededBy)}*`);
  if (e.deliverTo) lines.push(`Deliver to: ${plain(e.deliverTo)}`);
  if (e.neededBy || e.deliverTo) lines.push('');

  if (e.notes) lines.push('*REMARKS*', plain(e.notes), '');

  lines.push('*PLEASE QUOTE* (for each item)');
  lines.push('• Unit price (₹)', '• GST % — included or extra', '• Stock availability', '• Delivery / dispatch time', '');
  lines.push('Thank you,');
  lines.push(e.contactName ? `${plain(e.contactName)} · Procurement, ${BRAND_NAME}` : `Procurement, ${BRAND_NAME}`);
  lines.push(`📞 ${SUPPORT_PHONE_DISPLAY}`, `🌐 ${COMPANY_WEBSITE}`);
  return lines.join('\n');
}

/** wa.me link with the message typed in; '' when the supplier has no usable number. */
export function whatsappLink(phone: string, message: string): string {
  const n = waNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(message)}` : '';
}
