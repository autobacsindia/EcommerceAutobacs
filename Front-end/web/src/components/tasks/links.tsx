/**
 * Web links inside task text (comments, the description) become chips with the
 * site's logo: a Drive link shows the Drive mark and "Google Drive", a YouTube
 * link the YouTube mark, anything else a globe and the site's name. The logos
 * are bundled (react-icons' Simple Icons set), so showing a link never calls the
 * linked site or a favicon service.
 *
 * Only http(s) links are ever made clickable, and they open in a new tab with
 * no referrer or window access (`noopener noreferrer`).
 */
import { Fragment, type ComponentType, type ReactNode } from 'react';
import { Globe } from 'lucide-react';
import {
  SiClickup, SiDropbox, SiFacebook, SiFigma, SiGithub, SiGmail, SiGooglecalendar, SiGoogledocs, SiGoogleforms, SiGooglemaps,
  SiGooglemeet, SiGooglephotos, SiGooglesheets, SiGoogleslides, SiInstagram, SiLoom, SiNotion, SiRazorpay, SiShopify, SiTelegram,
  SiTrello, SiWetransfer, SiWhatsapp, SiX, SiYoutube, SiZoho, SiZoom,
} from 'react-icons/si';

type IconProps = { className?: string; style?: React.CSSProperties; 'aria-hidden'?: boolean };

/** Google Drive's three-colour mark (the single-colour one reads as a plain triangle). */
function DriveMark({ className }: IconProps) {
  return (
    <svg viewBox="0 0 87.3 78" className={className} aria-hidden>
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44A9.06 9.06 0 0 0 0 53h27.5z" fill="#00ac47" />
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z" fill="#ea4335" />
      <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="M73.4 26.5 60.7 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
    </svg>
  );
}

export type LinkKind = { name: string; Icon: ComponentType<IconProps>; colour?: string };

const GLOBE: LinkKind = { name: '', Icon: Globe };

/** Hosts we know, with a path test where one host serves several products. Checked in order. */
const KNOWN: { test: (host: string, path: string) => boolean; kind: LinkKind }[] = [
  { test: (h, p) => h === 'docs.google.com' && p.startsWith('/document'), kind: { name: 'Google Docs', Icon: SiGoogledocs, colour: '#4285F4' } },
  { test: (h, p) => h === 'docs.google.com' && p.startsWith('/spreadsheets'), kind: { name: 'Google Sheets', Icon: SiGooglesheets, colour: '#0F9D58' } },
  { test: (h, p) => h === 'docs.google.com' && p.startsWith('/presentation'), kind: { name: 'Google Slides', Icon: SiGoogleslides, colour: '#F4B400' } },
  { test: (h, p) => (h === 'docs.google.com' && p.startsWith('/forms')) || h === 'forms.gle', kind: { name: 'Google Forms', Icon: SiGoogleforms, colour: '#7248B9' } },
  { test: (h) => h === 'drive.google.com' || h === 'docs.google.com', kind: { name: 'Google Drive', Icon: DriveMark } },
  { test: (h) => h === 'meet.google.com', kind: { name: 'Google Meet', Icon: SiGooglemeet, colour: '#00897B' } },
  { test: (h) => h === 'calendar.google.com', kind: { name: 'Google Calendar', Icon: SiGooglecalendar, colour: '#4285F4' } },
  { test: (h) => h === 'photos.google.com' || h === 'photos.app.goo.gl', kind: { name: 'Google Photos', Icon: SiGooglephotos, colour: '#EA4335' } },
  { test: (h, p) => h === 'maps.google.com' || h === 'maps.app.goo.gl' || (h === 'google.com' && p.startsWith('/maps')) || h === 'goo.gl', kind: { name: 'Google Maps', Icon: SiGooglemaps, colour: '#34A853' } },
  { test: (h) => h === 'mail.google.com', kind: { name: 'Gmail', Icon: SiGmail, colour: '#EA4335' } },
  { test: (h) => h === 'youtube.com' || h === 'youtu.be' || h === 'm.youtube.com', kind: { name: 'YouTube', Icon: SiYoutube, colour: '#FF0000' } },
  { test: (h) => h === 'wa.me' || h.endsWith('whatsapp.com'), kind: { name: 'WhatsApp', Icon: SiWhatsapp, colour: '#25D366' } },
  { test: (h) => h === 'instagram.com', kind: { name: 'Instagram', Icon: SiInstagram, colour: '#E4405F' } },
  { test: (h) => h === 'facebook.com' || h === 'fb.com' || h === 'fb.watch' || h === 'm.facebook.com', kind: { name: 'Facebook', Icon: SiFacebook, colour: '#1877F2' } },
  { test: (h) => h === 'x.com' || h === 'twitter.com', kind: { name: 'X', Icon: SiX, colour: 'currentColor' } },
  { test: (h) => h === 't.me' || h === 'telegram.me', kind: { name: 'Telegram', Icon: SiTelegram, colour: '#26A5E4' } },
  { test: (h) => h === 'figma.com', kind: { name: 'Figma', Icon: SiFigma, colour: '#F24E1E' } },
  { test: (h) => h === 'dropbox.com', kind: { name: 'Dropbox', Icon: SiDropbox, colour: '#0061FF' } },
  { test: (h) => h === 'wetransfer.com' || h === 'we.tl', kind: { name: 'WeTransfer', Icon: SiWetransfer, colour: '#409FFF' } },
  { test: (h) => h === 'github.com', kind: { name: 'GitHub', Icon: SiGithub, colour: 'currentColor' } },
  { test: (h) => h === 'notion.so' || h.endsWith('.notion.site'), kind: { name: 'Notion', Icon: SiNotion, colour: 'currentColor' } },
  { test: (h) => h === 'trello.com', kind: { name: 'Trello', Icon: SiTrello, colour: '#0052CC' } },
  { test: (h) => h === 'app.clickup.com' || h === 'clickup.com', kind: { name: 'ClickUp', Icon: SiClickup, colour: '#7B68EE' } },
  { test: (h) => h === 'zoom.us' || h.endsWith('.zoom.us'), kind: { name: 'Zoom', Icon: SiZoom, colour: '#0B5CFF' } },
  { test: (h) => h === 'loom.com', kind: { name: 'Loom', Icon: SiLoom, colour: '#625DF5' } },
  { test: (h) => h.endsWith('zoho.in') || h.endsWith('zoho.com'), kind: { name: 'Zoho', Icon: SiZoho, colour: '#E42527' } },
  { test: (h) => h.endsWith('razorpay.com'), kind: { name: 'Razorpay', Icon: SiRazorpay, colour: '#0C2451' } },
  { test: (h) => h.endsWith('myshopify.com') || h === 'shopify.com', kind: { name: 'Shopify', Icon: SiShopify, colour: '#7AB55C' } },
];

/** What a link points at: a known product, or a globe with the site's own name. */
export function linkKind(url: URL): LinkKind {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const hit = KNOWN.find((k) => k.test(host, url.pathname));
  return hit ? hit.kind : { ...GLOBE, name: host };
}

/**
 * Where links start: http(s):// or a bare "www.". The match stops at white space
 * and at characters that never end a real link; trailing punctuation is trimmed
 * after (see `trimTail`), so "see https://x.com/a." links to /a, not /a.
 */
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

/** Drop sentence punctuation stuck to the end, and a ")" that has no "(" inside the link. */
function trimTail(raw: string): string {
  let s = raw.replace(/[.,;:!?*_~]+$/, '');
  while (s.endsWith(')') && (s.match(/\(/g)?.length ?? 0) < (s.match(/\)/g)?.length ?? 0)) s = s.slice(0, -1).replace(/[.,;:!?]+$/, '');
  while (s.endsWith(']') && !s.includes('[')) s = s.slice(0, -1);
  return s;
}

/** The address as a URL — only http(s), or nothing (never a javascript: or data: link). */
export function safeUrl(raw: string): URL | null {
  try {
    const u = new URL(/^www\./i.test(raw) ? `https://${raw}` : raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

/** The short tail after the name: "drive.google.com/file/d/1Rq…" → "/file/d/1Rq…". */
function shortPath(u: URL, max = 32): string {
  const rest = `${u.pathname === '/' ? '' : u.pathname}${u.search}`;
  return rest.length > max ? `${rest.slice(0, max - 1)}…` : rest;
}

/** One link as a chip: logo, the product (or site) name, and a quiet piece of the address. */
export function LinkChip({ url, href }: { url: URL; href: string }) {
  const kind = linkKind(url);
  const known = kind.Icon !== Globe;
  const tail = shortPath(url);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      title={href}
      onClick={(e) => e.stopPropagation()}
      className="tk-link mx-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-px align-middle text-[13px] font-medium no-underline"
    >
      <kind.Icon aria-hidden className="h-3.5 w-3.5 shrink-0" style={kind.colour ? { color: kind.colour } : undefined} />
      <span className="shrink-0">{known ? kind.name : url.hostname.replace(/^www\./, '')}</span>
      {tail && <span className="tk-link-tail min-w-0 truncate font-normal">{tail}</span>}
    </a>
  );
}

/**
 * Text with every web link turned into a chip; `plain` renders whatever is
 * between links (so @mentions keep their own highlighting).
 */
export function Linkified({ text, plain = (s) => s }: { text: string; plain?: (s: string, key: string) => ReactNode }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const start = m.index ?? 0;
    const raw = trimTail(m[0]);
    const url = safeUrl(raw);
    if (!url) continue;
    if (start > last) out.push(<Fragment key={`t${last}`}>{plain(text.slice(last, start), `t${last}`)}</Fragment>);
    out.push(<LinkChip key={`l${start}`} url={url} href={url.href} />);
    last = start + raw.length;
  }
  if (last === 0) return <>{plain(text, 't0')}</>;
  if (last < text.length) out.push(<Fragment key={`t${last}`}>{plain(text.slice(last), `t${last}`)}</Fragment>);
  return <>{out}</>;
}
