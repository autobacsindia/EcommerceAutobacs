'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { API_ENDPOINTS } from '@/lib/constants';
import './press.css';

// ── Press card shape (from /media/press) ────────────────────────────────────
interface PressCard {
  _id: string;
  publication: string;
  date: string;
  headline: string;
  excerpt: string;
  url: string;
  image: string;
  tilt: number | null;
  tape: '' | 'left' | 'center' | 'right';
}

// ── Fixed page chrome (owner-supplied; edit here) ───────────────────────────
const MASTHEAD = {
  eyebrow: 'EST. 2015 · Roavion Automotive Pvt. Ltd.',
  title: 'Autobacs India,',
  titleEm: 'in the press',
  lede: 'From a $1M revenue milestone to a structured import model reshaping the premium aftermarket — here’s where the story has been told.',
};

const CONTACT = {
  label: 'Get in touch →',
  url: 'mailto:info@autobacsindia.com',
};

const TICKER = [
  'Autobacs India', '$1M Revenue Milestone', 'Business Standard', 'ThePrint',
  'Dailyhunt', 'BrandValley Times', 'The Indian Post', 'MyNation',
  'USA News', 'News 18', 'ANI', 'Blunt Times',
  'Roavion Automotive Pvt. Ltd.', '100+ Installation Locations', 'Premium Aftermarket',
];

// Presentation fallbacks when a card leaves tilt/tape unset (matches design).
const TILTS = [-1.4, 1.1, -0.8, 1.3, -1.2, 0.9];
const TAPES: PressCard['tape'][] = ['left', 'center', 'right'];

function Ticker() {
  // Duplicated once so the -50% translate loops seamlessly.
  const items = [...TICKER, ...TICKER];
  return (
    <div className="abi-ticker-wrap" aria-hidden="true">
      <div className="abi-track">
        {items.map((word, i) => (
          <span key={i}>
            {word}
            <span className="abi-bull" style={{ paddingLeft: 0 }}>&#9679;</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function PressCardEl({ card, index }: { card: PressCard; index: number }) {
  const tilt = card.tilt ?? TILTS[index % TILTS.length];
  const tape = card.tape || TAPES[index % TAPES.length];
  const href = card.url?.trim() || '#';
  const style = { '--tilt': `${tilt}deg`, animationDelay: `${index * 70}ms` } as CSSProperties;

  return (
    <a
      className={`abi-clip abi-tape-${tape}`}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={style}
      aria-label={`Read the ${card.publication} story`}
    >
      <span className="abi-stripe" aria-hidden="true" />
      <span className="abi-head">
        <span className="abi-pub">{card.publication}</span>
        <span className="abi-date">{card.date}</span>
      </span>
      <span className="abi-rule" />
      <span className="abi-title">{card.headline}</span>
      <span className="abi-figure">
        {card.image?.trim()
          ? <img src={card.image.trim()} alt={`${card.publication} feature on Autobacs India`} loading="lazy" />
          : <span className="abi-figure-empty">{card.publication}</span>}
      </span>
      <span className="abi-excerpt">{card.excerpt}</span>
      <span className="abi-read">Read the full story <span aria-hidden="true">&#8594;</span></span>
    </a>
  );
}

export default function MediaPressPage() {
  const [cards, setCards] = useState<PressCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/v1${API_ENDPOINTS.MEDIA_PRESS}`);
        const data = await res.json();
        if (data.success) setCards(data.data);
      } catch (_) {}
      finally { setLoading(false); }
    })();
  }, []);

  // "Featured in" row — unique publications, original order.
  const featuredPubs = Array.from(new Set(cards.map(c => c.publication)));

  return (
    <div id="abi-press">
      <Ticker />

      <header className="abi-masthead">
        <div className="abi-eyebrow">{MASTHEAD.eyebrow}</div>
        <div className="abi-h1">{MASTHEAD.title}<br /><em>{MASTHEAD.titleEm}</em></div>
        <p className="abi-lede">{MASTHEAD.lede}</p>
        {featuredPubs.length > 0 && (
          <div className="abi-featured">
            <span className="abi-fi-label">Featured in</span>
            {featuredPubs.map((pub, i) => (
              <span key={pub}>
                <span className="abi-fi-name">{pub}</span>
                {i < featuredPubs.length - 1 && <span className="abi-dot">&nbsp;&bull;</span>}
              </span>
            ))}
          </div>
        )}
      </header>

      <main className="abi-board">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="abi-skel" />)
          : cards.length === 0
            ? <p className="abi-empty">Press coverage is on its way — check back soon.</p>
            : cards.map((card, i) => <PressCardEl key={card._id} card={card} index={i} />)}
      </main>

      <footer className="abi-foot">
        <hr />
        <h3>Press &amp; media enquiries</h3>
        <p>Writing about India&rsquo;s premium automotive aftermarket? We&rsquo;d love to share our story, data and imagery.</p>
        <a className="abi-btn" href={CONTACT.url}>{CONTACT.label}</a>
      </footer>
    </div>
  );
}
