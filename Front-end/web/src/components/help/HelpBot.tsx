'use client';

/**
 * The help bot — the floating button bottom-right and the panel it opens.
 *
 * It answers from the site's own FAQ and from live product data, never from a
 * language model. See `lib/help/intents.ts` for why: a bot that paraphrases a
 * shipping threshold or a return window is stating policy it might get wrong,
 * and on a shop that is a legal problem rather than a tone one. Every reply
 * here is either a literal FAQ sentence or a link to the page that owns the
 * answer, and product results come from the same API the search bar uses — so
 * a price in this panel is the price the server would charge.
 *
 * It does not need an account, it never collects personal details, and the one
 * thing it cannot answer it hands to a human on WhatsApp.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageCircle, Send, X, Search, ExternalLink, ArrowRight, Phone, Mail } from 'lucide-react';
import apiClient from '@/lib/api';
import { capture } from '@/lib/analytics';
import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_TEL, SUPPORT_EMAIL, whatsappLink } from '@/lib/contactInfo';
import { STARTERS, answerFor, type Action } from '@/lib/help/intents';

interface Suggestion {
  id: string;
  text: string;
  slug?: string;
  type?: string;
  imageUrl?: string;
}

interface Turn {
  id: number;
  from: 'you' | 'bot';
  text: string;
  actions?: Action[];
  followUps?: string[];
  products?: Suggestion[];
  searching?: boolean;
}

/**
 * A product page: on phones its sticky Add-to-cart bar owns the bottom edge,
 * so the launcher sits above it. Nothing may cover Add to cart.
 */
const isProductPage = (pathname: string | null) =>
  !!pathname && /^\/products\/(?!search(\/|$))[^/]+$/.test(pathname);

/** Where a chat bubble would be in the way or out of place. */
function isSuppressed(pathname: string | null): boolean {
  if (!pathname) return false;
  const p = pathname.replace(/\/+$/, '') || '/';
  return (
    p.startsWith('/admin') ||
    p === '/team' || p.startsWith('/team/') ||
    p.startsWith('/checkout') ||      // nothing competes with Pay
    p.startsWith('/staff-invite') ||
    p === '/careers' ||
    p === '/login' || p === '/register'
  );
}

/** WhatsApp's own mark — the generic chat bubble is not recognisable as it. */
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.04 21.5h-.01a9.45 9.45 0 0 1-4.82-1.32l-.35-.21-3.58.94.96-3.49-.23-.36a9.45 9.45 0 0 1-1.45-5.04c0-5.22 4.25-9.47 9.48-9.47 2.53 0 4.91.99 6.7 2.78a9.41 9.41 0 0 1 2.77 6.7c0 5.22-4.25 9.47-9.47 9.47zm8.06-17.53A11.3 11.3 0 0 0 12.04.63C5.76.63.65 5.74.65 12.02c0 2.01.52 3.97 1.52 5.69L.55 23.6l6.03-1.58a11.37 11.37 0 0 0 5.45 1.39h.01c6.28 0 11.39-5.11 11.39-11.39 0-3.04-1.18-5.9-3.33-8.05z" />
    </svg>
  );
}

const GREETING =
  "Hi! I can help you find a part, check an order, or explain delivery and returns. What do you need?";

export default function HelpBot() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const push = useCallback((turn: Omit<Turn, 'id'>) => {
    const id = nextId.current++;
    setTurns((t) => [...t, { ...turn, id }]);
    return id;
  }, []);

  /** Answer a question: match an intent, then fill in live data if it asked. */
  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q) return;
      push({ from: 'you', text: q });
      setDraft('');
      capture('help_bot_question', { question: q });

      const answer = answerFor(q);
      const id = push({
        from: 'bot',
        text: answer.text,
        actions: answer.actions,
        followUps: answer.followUps,
        searching: answer.search,
      });

      if (!answer.search) return;

      // Live catalogue, the same endpoint the search bar uses — so the bot can
      // never offer a product that is not really there.
      try {
        const data = await apiClient.get<{ suggestions?: Suggestion[] }>(
          `/products/suggestions?q=${encodeURIComponent(q)}&limit=5`,
        );
        const products = (data.suggestions ?? []).filter((s) => s.type === 'product' && s.slug);
        setTurns((t) =>
          t.map((turn) =>
            turn.id === id
              ? {
                  ...turn,
                  searching: false,
                  products,
                  text: products.length
                    ? turn.text
                    : `I couldn't find anything for “${q}”. Our team can look properly for you.`,
                  actions: products.length
                    ? [{ label: `See all results for “${q}”`, href: `/products/search?q=${encodeURIComponent(q)}` }]
                    : [{ label: 'Ask on WhatsApp', href: whatsappLink(`Hi, I'm looking for: ${q}`), external: true }],
                }
              : turn,
          ),
        );
      } catch {
        setTurns((t) =>
          t.map((turn) =>
            turn.id === id
              ? {
                  ...turn,
                  searching: false,
                  text: "I couldn't reach the catalogue just now. Our team can help straight away.",
                  actions: [{ label: 'Ask on WhatsApp', href: whatsappLink(`Hi, I'm looking for: ${q}`), external: true }],
                }
              : turn,
          ),
        );
      }
    },
    [push],
  );

  // Greet once, the first time it is opened.
  useEffect(() => {
    if (open && turns.length === 0) push({ from: 'bot', text: GREETING });
  }, [open, turns.length, push]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, open]);

  // Escape closes, and focus goes to the field on open — basic panel manners.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open]);

  if (isSuppressed(pathname)) return null;

  const showStarters = turns.length <= 1;
  // Clear of the sticky Add-to-cart bar (~72px + the iOS home indicator).
  const onProduct = isProductPage(pathname);
  const launcherBottom = onProduct ? 'bottom-24 md:bottom-6' : 'bottom-5 md:bottom-6';
  const panelBottom = onProduct ? 'bottom-44 md:bottom-28' : 'bottom-24 md:bottom-28';

  return (
    <>
      {/* Launcher */}
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) capture('help_bot_open');
        }}
        aria-expanded={open}
        aria-controls="help-bot-panel"
        aria-label={open ? 'Close help' : 'Open help'}
        className={`fixed ${launcherBottom} right-4 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-[#0a5c33] text-white shadow-lg ring-[3px] ring-white shadow-xl shadow-black/30 transition hover:bg-[#084a29] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#0a5c33]/40`}
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>

      {open && (
        <div
          id="help-bot-panel"
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label="Help"
          className={`fixed inset-x-3 ${panelBottom} z-[60] flex max-h-[min(34rem,calc(100dvh-9rem))] flex-col overflow-hidden rounded-2xl border border-hairline bg-white shadow-2xl sm:inset-x-auto sm:right-4 sm:w-[23rem]`}
        >
          <header className="flex items-center gap-3 bg-[#121414] px-4 py-3 text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0a5c33]">
              <MessageCircle className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[15px] font-bold tracking-[-0.01em]">Roavion Help</p>
              <p className="truncate text-[11.5px] text-white/70">Real answers, from our own pages</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close help"
              className="rounded p-1 text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="flex-1 space-y-3.5 overflow-y-auto bg-gold-soft px-4 py-4">
            {turns.map((t) => (
              <div key={t.id} className={t.from === 'you' ? 'flex justify-end' : ''}>
                <div
                  className={
                    t.from === 'you'
                      ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-[#0a5c33] px-4 py-2.5 text-[14.5px] leading-[1.45] text-white shadow-sm'
                      : 'max-w-[92%] rounded-2xl rounded-bl-sm border border-hairline bg-white px-4 py-3 text-[14.5px] leading-[1.55] text-ink shadow-sm'
                  }
                >
                  {t.text}

                  {t.searching && (
                    <p className="mt-2 flex items-center gap-2 text-[12px] text-ink-muted">
                      <Search className="h-3.5 w-3.5 animate-pulse" /> Searching the catalogue…
                    </p>
                  )}

                  {!!t.products?.length && (
                    <ul className="mt-2.5 space-y-1.5">
                      {t.products.map((p) => (
                        <li key={p.id}>
                          <Link
                            href={`/products/${p.slug}`}
                            onClick={() => setOpen(false)}
                            className="flex items-center gap-2 rounded-xl border border-hairline bg-obsidian px-3 py-2.5 transition hover:border-[#0a5c33] hover:bg-white"
                          >
                            <span className="line-clamp-2 flex-1 text-[13px] leading-[1.35] text-ink">{p.text}</span>
                            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gold" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}

                  {!!t.actions?.length && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {t.actions.map((a) =>
                        a.external ? (
                          <a
                            key={a.label}
                            href={a.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-full bg-[#0a5c33] px-3.5 py-2 text-[12.5px] font-semibold text-white transition hover:bg-[#084a29]"
                          >
                            {a.label} <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <Link
                            key={a.label}
                            href={a.href}
                            onClick={() => setOpen(false)}
                            className="inline-flex items-center gap-1 rounded-full border-[1.5px] border-[#0a5c33] px-3.5 py-2 text-[12.5px] font-semibold text-gold transition hover:bg-[#0a5c33] hover:text-white"
                          >
                            {a.label}
                          </Link>
                        ),
                      )}
                    </div>
                  )}

                  {!!t.followUps?.length && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.followUps.map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => ask(f)}
                          className="rounded-full bg-white px-2.5 py-1 text-[11.5px] text-ink-muted ring-1 ring-[#dfe3e2] transition hover:text-gold hover:ring-[#0a5c33]"
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* The chips people see before typing anything. */}
            {showStarters && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => ask(s)}
                    className="rounded-full border border-hairline bg-white px-3.5 py-2 text-[13px] font-medium text-[#333838] shadow-sm transition hover:border-[#0a5c33] hover:bg-gold-soft hover:text-gold"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div ref={endRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(draft);
            }}
            className="flex items-center gap-2 border-t border-hairline px-3 py-2.5"
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about a part, order or delivery"
              aria-label="Ask a question"
              className="min-w-0 flex-1 rounded-full border border-hairline bg-obsidian px-4 py-2.5 text-[14px] text-ink placeholder:text-ink-muted focus:border-[#0a5c33] focus:outline-none focus:ring-2 focus:ring-[#0a5c33]/20"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label="Send"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0a5c33] text-white transition hover:bg-[#084a29] disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>

          {/* The launcher is now the only floating button, so the three human
              channels live here as real targets rather than a caption. */}
          <div className="grid grid-cols-3 gap-px border-t border-hairline bg-[#dfe3e2]">
            <a
              href={whatsappLink()}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-0.5 bg-obsidian py-2 text-[11px] font-semibold text-ink transition hover:bg-gold-soft hover:text-gold"
            >
              <WhatsAppIcon className="h-4 w-4 text-[#25D366]" />
              WhatsApp
            </a>
            <a
              href={`tel:${SUPPORT_PHONE_TEL}`}
              className="flex flex-col items-center gap-0.5 bg-obsidian py-2 text-[11px] font-semibold text-ink transition hover:bg-gold-soft hover:text-gold"
            >
              <Phone className="h-4 w-4 text-gold" />
              <span className="sr-only">Call </span>{SUPPORT_PHONE_DISPLAY}
            </a>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="flex flex-col items-center gap-0.5 bg-obsidian py-2 text-[11px] font-semibold text-ink transition hover:bg-gold-soft hover:text-gold"
            >
              <Mail className="h-4 w-4 text-gold" />
              Email
            </a>
          </div>
        </div>
      )}
    </>
  );
}
