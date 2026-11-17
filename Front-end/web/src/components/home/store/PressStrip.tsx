import Link from 'next/link';
import Img from '../redesign/Img';
import type { StorePress } from './storeData';

/**
 * "As featured in" — the press items an admin ticked Featured on /admin/media.
 *
 * Each card links OUT to the publication (new tab), because the article is
 * theirs: we show the headline, our own photo and a short summary, never a copy
 * of the text. "All press" leads to /media, which lists every published item.
 *
 * Server-rendered from storeData (tag `home:press`, refreshed by every press
 * write), so it is in the initial HTML. Nothing featured → nothing rendered.
 */
export default function PressStrip({ press }: { press: StorePress[] }) {
  if (press.length === 0) return null;
  return (
    <section className="st-card" aria-labelledby="sh-press">
      <div className="st-row-head">
        <div>
          <h2 id="sh-press" className="st-h2">As featured in</h2>
          <p className="st-sub">What the press is saying about Autobacs India</p>
        </div>
        <Link href="/media" className="st-link">All press</Link>
      </div>
      <ul className="sh-press">
        {press.map((p) => (
          <li key={p.id} className="sh-press-card">
            <a href={p.url} target="_blank" rel="noopener noreferrer" className="sh-press-link">
              {p.image && (
                <span className="sh-press-photo">
                  <Img src={p.image} alt="" sizes="(max-width: 768px) 90vw, 400px" />
                </span>
              )}
              <span className="sh-press-body">
                <span className="sh-press-pub">
                  {p.publication}
                  {p.date && <span className="sh-press-date"> · {p.date}</span>}
                </span>
                <span className="sh-press-headline">{p.headline}</span>
                {p.excerpt && <span className="sh-press-excerpt">{p.excerpt}</span>}
                <span className="sh-press-cta">
                  Read on {p.publication} <span aria-hidden="true">→</span>
                  <span className="sh-sr-only"> (opens in a new tab)</span>
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
