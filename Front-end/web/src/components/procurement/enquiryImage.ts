import { formatDateIST } from '@/lib/datetime';
import { BRAND_NAME } from '@/lib/constants';
import { SUPPORT_PHONE_DISPLAY } from '@/lib/contactInfo';
import { COMPANY_WEBSITE, unitLabel, type Enquiry } from './enquiry';
import { rupees } from './pricing';

/**
 * The enquiry as a branded PNG (logo, ref, items, contact) — for when a plain
 * WhatsApp text is not enough. Drawn on a canvas in the browser; nothing uploaded.
 * Phones get the native share sheet (Web Share API with a file); everything else
 * downloads the picture.
 */

const W = 1080;
const PAD = 64;
const BLUE = '#0b3d91';
const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // no logo is better than no picture
    img.src = src;
  });
}

/** Word-wrap `text` to `max` px; returns the lines. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > max && line) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

type Draw = (ctx: CanvasRenderingContext2D) => number; // returns the height used

export async function renderEnquiryImage(e: Pick<Enquiry, 'ref' | 'createdAt' | 'neededBy' | 'deliverTo' | 'notes' | 'showTargetPrice' | 'contactName' | 'items'>): Promise<Blob> {
  const logo = await loadImage('/images/autobacs-logo.png');
  // Lay out once on a scratch canvas to learn the height, then draw for real.
  const plan: Draw[] = [];
  const text = (s: string, size: number, { color = INK, weight = 400, gap = 10, indent = 0 } = {}): Draw => (ctx) => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    const lines = wrap(ctx, s, W - PAD * 2 - indent);
    lines.forEach((l, i) => ctx.fillText(l, PAD + indent, size + i * size * 1.3));
    return lines.length * size * 1.3 + gap;
  };
  const rule = (gap = 24): Draw => (ctx) => { ctx.fillStyle = LINE; ctx.fillRect(PAD, gap / 2, W - PAD * 2, 2); return gap; };

  plan.push((ctx) => {
    if (logo) {
      const h = 84;
      const w = (logo.width / logo.height) * h;
      ctx.drawImage(logo, PAD, 0, w, h);
      return h + 28;
    }
    return text(BRAND_NAME.toUpperCase(), 44, { weight: 800, color: BLUE })(ctx);
  });
  plan.push(text('Price & availability enquiry', 40, { weight: 700, color: BLUE, gap: 14 }));
  plan.push(text(`Ref ${e.ref}  ·  ${formatDateIST(e.createdAt)}`, 26, { color: MUTED, gap: 6 }));
  if (e.neededBy) plan.push(text(`Needed by ${formatDateIST(e.neededBy)}`, 26, { color: MUTED, gap: 6 }));
  if (e.deliverTo) plan.push(text(`Deliver to ${e.deliverTo}`, 26, { color: MUTED, gap: 6 }));
  plan.push(rule(40));
  e.items.forEach((it, i) => {
    plan.push(text(`${i + 1}. ${it.name}`, 30, { weight: 700, gap: 6 }));
    const id = [it.brand && `Brand: ${it.brand}`, it.partNo && `Part no: ${it.partNo}`, it.fitment && `Fits: ${it.fitment}`].filter(Boolean).join('  ·  ');
    if (id) plan.push(text(id, 24, { color: MUTED, gap: 4, indent: 34 }));
    const qty = `Qty: ${it.qty} ${unitLabel(it.qty, it.unit)}`;
    const target = e.showTargetPrice && it.targetPaise ? `   ·   Target: ${rupees(it.targetPaise)} + GST` : '';
    plan.push(text(`${qty}${target}`, 26, { weight: 600, gap: it.note ? 4 : 18, indent: 34 }));
    if (it.note) plan.push(text(`Note: ${it.note}`, 24, { color: MUTED, gap: 18, indent: 34 }));
  });
  if (e.notes) { plan.push(rule()); plan.push(text(`Notes: ${e.notes}`, 26, { gap: 10 })); }
  plan.push(rule(40));
  plan.push(text('Please reply with price per unit (and GST %), stock available and dispatch time.', 26, { gap: 24 }));
  plan.push(text(e.contactName ? `${e.contactName} · Procurement, ${BRAND_NAME}` : `Procurement, ${BRAND_NAME}`, 26, { weight: 700, gap: 6 }));
  plan.push(text(`${SUPPORT_PHONE_DISPLAY}  ·  ${COMPANY_WEBSITE}`, 26, { color: MUTED, gap: 0 }));

  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('This browser cannot draw the picture.');
  const heights = plan.map((d) => { measure.save(); const h = d(measure); measure.restore(); return h; });
  const BAND = 14;
  const H = Math.ceil(BAND + PAD + heights.reduce((a, b) => a + b, 0) + PAD);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the picture.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = BLUE;
  ctx.fillRect(0, 0, W, BAND);
  let y = BAND + PAD;
  plan.forEach((d, i) => { ctx.save(); ctx.translate(0, y); d(ctx); ctx.restore(); y += heights[i]; });

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the picture.'))), 'image/png');
  });
}

/** Share sheet with the picture where the browser can (phones); otherwise download it. */
export async function shareOrDownload(blob: Blob, filename: string, text: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text });
      return 'shared';
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return 'cancelled';
      // Fall through to the download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
