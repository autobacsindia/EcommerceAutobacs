'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Img from './Img';
import { ArrowRight, ArrowRightLong } from './icons';
import { journal, journalPosts } from './homeContent';

export default function Journal() {
  const cardRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [active, setActive] = useState(0);

  // Scroll-spy: highlight the index item for the card nearest viewport centre.
  useEffect(() => {
    const cards = cardRefs.current.filter(Boolean) as HTMLAnchorElement[];
    if (!cards.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const i = cards.indexOf(e.target as HTMLAnchorElement);
            if (i >= 0) setActive(i);
          }
        });
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    );
    cards.forEach((c) => obs.observe(c));
    return () => obs.disconnect();
  }, []);

  const jumpTo = (i: number) => {
    const card = cardRefs.current[i];
    if (!card) return;
    const y = card.getBoundingClientRect().top + window.scrollY - 130;
    window.scrollTo({ top: y, behavior: 'smooth' });
  };

  return (
    <section className="journal">
      <div className="journal-inner">
        <div className="journal-left">
          <div className="journal-eyebrow reveal">{journal.eyebrow}</div>
          <h2 className="reveal reveal-d1">
            {journal.titleTop}
            <br />
            <em>{journal.titleAccent}</em>
          </h2>
          <p className="journal-desc reveal reveal-d2">{journal.body}</p>
          <div className="journal-index reveal reveal-d2">
            {journalPosts.map((p, i) => (
              <button
                key={p.title}
                type="button"
                className={`ji-item${i === active ? ' active' : ''}`}
                onClick={() => jumpTo(i)}
              >
                <span className="ji-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="ji-t">{p.title}</span>
              </button>
            ))}
          </div>
          <Link className="journal-cta" href="/blog">
            All Articles <ArrowRightLong />
          </Link>
        </div>

        <div className="journal-right">
          {journalPosts.map((p, i) => (
            <Link
              href={p.href}
              className="journal-card reveal"
              key={p.title}
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
            >
              <div className="thumb">
                <span className="cat">{p.category}</span>
                <Img src={p.image} alt={p.title} />
              </div>
              <div className="journal-meta">
                <span>{p.date}</span>
                <span className="dot" />
                <span>{p.readTime}</span>
              </div>
              <h3>{p.title}</h3>
              <p>{p.excerpt}</p>
              <span className="journal-readlink">
                Read Article <ArrowRight />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
