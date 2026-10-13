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
import { MessageCircle, Send, X, Search, ExternalLink, ArrowRight } from 'lucide-react';
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
        className="fixed bottom-5 right-4 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-[#0a5c33] text-white shadow-lg transition hover:bg-[#084a29] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#0a5c33]/30 md:bottom-6"
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
          className="fixed inset-x-3 bottom-24 z-[60] flex max-h-[min(34rem,calc(100dvh-8rem))] flex-col overflow-hidden rounded-2xl border border-[#dfe3e2] bg-white shadow-2xl sm:inset-x-auto sm:right-4 sm:w-[23rem] md:bottom-28"
        >
          <header className="flex items-center gap-3 bg-[#121414] px-4 py-3 text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0a5c33]">
              <MessageCircle className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">Roavion Help</p>
              <p className="truncate text-[11px] text-white/60">Answers from our own pages</p>
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

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {turns.map((t) => (
              <div key={t.id} className={t.from === 'you' ? 'flex justify-end' : ''}>
                <div
                  className={
                    t.from === 'you'
                      ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-[#0a5c33] px-3.5 py-2 text-[13.5px] leading-5 text-white'
                      : 'max-w-[92%] rounded-2xl rounded-bl-sm bg-[#f2f8f4] px-3.5 py-2.5 text-[13.5px] leading-[1.5] text-[#0f1111]'
                  }
                >
                  {t.text}

                  {t.searching && (
                    <p className="mt-2 flex items-center gap-2 text-[12px] text-[#5f6363]">
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
                            className="flex items-center gap-2 rounded-lg border border-[#dfe3e2] bg-white px-2.5 py-2 transition hover:border-[#0a5c33]"
                          >
                            <span className="line-clamp-2 flex-1 text-[12.5px] leading-4 text-[#0f1111]">{p.text}</span>
                            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#0a5c33]" />
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
                            className="inline-flex items-center gap-1 rounded-full bg-[#0a5c33] px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#084a29]"
                          >
                            {a.label} <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <Link
                            key={a.label}
                            href={a.href}
                            onClick={() => setOpen(false)}
                            className="inline-flex items-center gap-1 rounded-full border border-[#0a5c33] px-3 py-1.5 text-[12px] font-semibold text-[#0a5c33] transition hover:bg-[#0a5c33] hover:text-white"
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
                          className="rounded-full bg-white px-2.5 py-1 text-[11.5px] text-[#5f6363] ring-1 ring-[#dfe3e2] transition hover:text-[#0a5c33] hover:ring-[#0a5c33]"
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
                    className="rounded-full border border-[#dfe3e2] bg-white px-3 py-1.5 text-[12px] text-[#333838] transition hover:border-[#0a5c33] hover:text-[#0a5c33]"
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
            className="flex items-center gap-2 border-t border-[#dfe3e2] px-3 py-2.5"
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about a part, order or delivery"
              aria-label="Ask a question"
              className="min-w-0 flex-1 rounded-full bg-[#eef1f0] px-3.5 py-2 text-[13px] text-[#0f1111] placeholder:text-[#5f6363] focus:outline-none focus:ring-2 focus:ring-[#0a5c33]/30"
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

          <div className="flex items-center justify-center gap-3 border-t border-[#dfe3e2] bg-[#f7f9f8] px-3 py-2 text-[11px] text-[#5f6363]">
            <a href={whatsappLink()} target="_blank" rel="noopener noreferrer" className="hover:text-[#0a5c33]">
              WhatsApp
            </a>
            <span aria-hidden="true">·</span>
            <a href={`tel:${SUPPORT_PHONE_TEL}`} className="hover:text-[#0a5c33]">
              {SUPPORT_PHONE_DISPLAY}
            </a>
            <span aria-hidden="true">·</span>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-[#0a5c33]">
              Email
            </a>
          </div>
        </div>
      )}
    </>
  );
}
