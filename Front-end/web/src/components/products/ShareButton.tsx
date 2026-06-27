'use client';

import { useState } from 'react';
import { Share2, Copy, Check, X } from 'lucide-react';
import { SITE_URL } from '@/lib/siteUrl';

interface ShareButtonProps {
  productName: string;
  productUrl?: string;   // optional override; defaults to window.location.href
  price?: number;
  imageUrl?: string;
}

export default function ShareButton({ productName, productUrl, price, imageUrl }: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const getUrl = () => {
    if (productUrl) return productUrl;
    if (typeof window !== 'undefined') return window.location.href;
    return SITE_URL;
  };

  const shareText = price
    ? `${productName} — ₹${Number(price).toLocaleString('en-IN')} | Autobacs India`
    : `${productName} | Autobacs India`;

  // --- Native Web Share API (mobile browsers / Chrome Android) ---
  const handleNativeShare = async () => {
    const url = getUrl();
    if (navigator.share) {
      try {
        await navigator.share({ title: shareText, url });
      } catch {
        // User cancelled — no-op
      }
      return;
    }
    // Fallback: open the popover
    setOpen(true);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(getUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Older browsers: use execCommand
      const el = document.createElement('input');
      el.value = getUrl();
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const encodedUrl  = encodeURIComponent(getUrl());
  const encodedText = encodeURIComponent(shareText);

  const shareLinks = [
    {
      label: 'WhatsApp',
      href: `https://wa.me/?text=${encodedText}%20${encodedUrl}`,
      color: 'bg-[#25D366] hover:bg-[#1ebe5c]',
      icon: (
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white" xmlns="http://www.w3.org/2000/svg">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
          <path d="M12 0C5.373 0 0 5.373 0 12c0 2.115.549 4.103 1.508 5.832L.057 23.997l6.305-1.43A11.944 11.944 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.79 9.79 0 01-5.028-1.387l-.36-.214-3.742.849.878-3.649-.235-.374A9.786 9.786 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/>
        </svg>
      ),
    },
    {
      label: 'Facebook',
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      color: 'bg-[#1877F2] hover:bg-[#1566d0]',
      icon: (
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white" xmlns="http://www.w3.org/2000/svg">
          <path d="M24 12.073C24 5.404 18.627 0 12 0S0 5.404 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.97h-1.513c-1.491 0-1.956.932-1.956 1.886v2.269h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
        </svg>
      ),
    },
    {
      label: 'Twitter / X',
      href: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
      color: 'bg-black hover:bg-gray-800',
      icon: (
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white" xmlns="http://www.w3.org/2000/svg">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.849L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="relative">
      {/* Share trigger button */}
      <button
        onClick={handleNativeShare}
        title="Share this product"
        className="px-4 py-4 border border-gray-200 rounded-xl transition-all flex items-center justify-center hover:bg-gray-50 text-gray-400 hover:text-blue-600"
        aria-label="Share product"
      >
        <Share2 className="h-6 w-6" />
      </button>

      {/* Fallback popover (shown only when navigator.share is unavailable) */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <div className="absolute right-0 bottom-full mb-2 z-50 bg-white rounded-2xl shadow-xl border border-gray-100 p-4 w-64">
            <div className="flex items-center justify-between mb-3">
              <span className="font-semibold text-gray-900 text-sm">Share this product</span>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Social buttons */}
            <div className="flex gap-2 mb-4">
              {shareLinks.map(({ label, href, color, icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Share on ${label}`}
                  className={`flex-1 flex items-center justify-center p-2.5 rounded-xl ${color} transition-colors`}
                  aria-label={`Share on ${label}`}
                >
                  {icon}
                </a>
              ))}
            </div>

            {/* Copy link */}
            <button
              onClick={handleCopy}
              className="w-full flex items-center gap-2 px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-green-600 flex-shrink-0" />
                  <span className="text-green-600 font-medium">Link copied!</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{getUrl()}</span>
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
