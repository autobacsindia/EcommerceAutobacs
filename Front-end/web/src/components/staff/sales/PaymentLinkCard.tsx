'use client';

import { useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Check, Copy, Download, MessageCircle, Share2 } from 'lucide-react';
import { formatDateTimeIST } from '@/lib/datetime';
import { rupees } from './types';

/** wa.me wants the number with country code and digits only. */
export function whatsappNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
}

export function paymentMessage(o: { customerName: string; orderNumber: string; amount: number; url: string }) {
  const first = o.customerName.trim().split(/\s+/)[0] || 'there';
  return [
    `Hi ${first}, thank you for choosing Autobacs India.`,
    `Order ${o.orderNumber} — amount payable ${rupees(o.amount)}.`,
    `Pay securely with Razorpay (UPI, card or net banking): ${o.url}`,
    'This link is valid for 48 hours.',
  ].join('\n');
}

/**
 * The QR + link a sales member sends to the customer. The QR encodes the Razorpay
 * payment link itself, so scanning it opens the same checkout as tapping the link —
 * one payable thing per order, which the webhook ties back to the order.
 */
export default function PaymentLinkCard({
  url,
  orderNumber,
  amount,
  customerName,
  customerPhone,
  expiresAt,
}: {
  url: string;
  orderNumber: string;
  amount: number;
  customerName: string;
  customerPhone: string;
  expiresAt: string | null;
}) {
  const qrRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState('');
  const message = paymentMessage({ customerName, orderNumber, amount, url });

  /** A shareable PNG: brand, amount, order and the QR — not just a bare square. */
  async function qrImage(): Promise<Blob | null> {
    const qr = qrRef.current;
    if (!qr) return null;
    const W = 600;
    const H = 820;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#0b1f3a';
    g.fillRect(0, 0, W, 96);
    g.textAlign = 'center';
    g.fillStyle = '#ffffff';
    g.font = 'bold 34px system-ui, -apple-system, sans-serif';
    g.fillText('Autobacs India', W / 2, 60);
    g.fillStyle = '#0b1f3a';
    g.font = 'bold 44px system-ui, -apple-system, sans-serif';
    g.fillText(`Pay ${rupees(amount)}`, W / 2, 168);
    g.fillStyle = '#4b5563';
    g.font = '24px system-ui, -apple-system, sans-serif';
    g.fillText(`Order ${orderNumber}`, W / 2, 208);
    g.drawImage(qr, (W - 440) / 2, 240, 440, 440);
    g.fillStyle = '#111827';
    g.font = '24px system-ui, -apple-system, sans-serif';
    g.fillText('Scan with any UPI app or phone camera', W / 2, 726);
    g.fillStyle = '#6b7280';
    g.font = '20px system-ui, -apple-system, sans-serif';
    g.fillText('Secure payment by Razorpay · valid for 48 hours', W / 2, 766);
    return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  }

  const fileName = `Autobacs-payment-${orderNumber}.png`;

  async function shareQr() {
    setNote('');
    const blob = await qrImage();
    if (!blob) return;
    const file = new File([blob], fileName, { type: 'image/png' });
    // Phones: the system share sheet, so the QR goes straight into WhatsApp.
    if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: message });
        return;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
      }
    }
    // Desktop: save the image, to attach in WhatsApp Web.
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setNote('QR image saved — attach it in WhatsApp.');
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNote('Could not copy — select the link and copy it by hand.');
    }
  }

  const wa = `https://wa.me/${whatsappNumber(customerPhone)}?text=${encodeURIComponent(message)}`;
  const canShareFiles = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
      <div className="mx-auto shrink-0 rounded-xl border border-gray-200 bg-white p-3 sm:mx-0">
        <QRCodeCanvas ref={qrRef} value={url} size={176} marginSize={1} level="M" aria-label={`QR code for ${url}`} />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Payment link</p>
          <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-sm font-medium text-blue-700 hover:underline">
            {url}
          </a>
          {expiresAt && <p className="mt-1 text-xs text-gray-500">Valid until {formatDateTimeIST(expiresAt)}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-[#25D366] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1ebe5b]"
          >
            <MessageCircle className="h-4 w-4" /> Send on WhatsApp
          </a>
          <button
            type="button"
            onClick={shareQr}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            {canShareFiles ? <Share2 className="h-4 w-4" /> : <Download className="h-4 w-4" />} Share QR image
          </button>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy message'}
          </button>
        </div>
        {note && <p className="text-xs text-gray-600">{note}</p>}
      </div>
    </div>
  );
}
