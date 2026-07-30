/**
 * Careers page renders its OPEN ROLES from data (not hardcoded markup):
 *   - one accordion card per posting, with escaped title/department/bullets
 *   - the apply-form <select> gains one <option> per posting (+ the static
 *     "Other / Open Application")
 *   - HTML-special characters in copy are escaped, not injected raw
 *   - empty postings degrades to the open-application fallback, no crash
 *
 * The component injects author-controlled markup via dangerouslySetInnerHTML and
 * re-attaches imperative behaviour in an effect; here we assert the rendered DOM.
 */

import { render } from '@testing-library/react';
import CareersApplication, { type CareerPosting } from './CareersApplication';

const posting = (over: Partial<CareerPosting> = {}): CareerPosting => ({
  _id: over._id || 'id1',
  department: 'Marketing',
  title: 'Marketing Manager',
  slug: 'marketing-manager',
  tagline: 'Own the story.',
  experience: '3-5 years exp',
  intro: 'We are building a category.',
  responsibilities: ['The engine', 'The campaigns'],
  requirements: ['Prove it'],
  closer: 'This is the moment.',
  ...over,
});

describe('CareersApplication — data-driven roles', () => {
  it('renders one card and one <option> per posting', () => {
    const postings = [
      posting({ _id: 'a', title: 'Marketing Manager', slug: 'marketing-manager' }),
      posting({ _id: 'b', title: 'Operations Executive', slug: 'operations-executive', department: 'Operations' }),
    ];
    const { container } = render(<CareersApplication postings={postings} />);

    expect(container.querySelectorAll('.rv-role-card')).toHaveLength(2);

    // Titles appear in the cards.
    expect(container.innerHTML).toContain('Marketing Manager');
    expect(container.innerHTML).toContain('Operations Executive');

    // The role <select> has: placeholder + 2 postings + "Other" = 4 options.
    const select = container.querySelector('#rv-role-select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual([
      '',
      'Marketing Manager',
      'Operations Executive',
      'Other / Open Application',
    ]);

    // Apply button carries the exact role for the dropdown auto-fill contract.
    const applyRoles = Array.from(container.querySelectorAll('.rv-apply-btn'))
      .map((b) => b.getAttribute('data-role'));
    expect(applyRoles).toContain('Marketing Manager');
  });

  it('escapes HTML-special characters in role copy', () => {
    const postings = [
      posting({ title: 'Jr. Accounts & Finance', slug: 'jr-accounts', responsibilities: ['GST & TDS <filings>'] }),
    ];
    const { container } = render(<CareersApplication postings={postings} />);
    // Raw markup must be escaped — no injected <filings> element, entity present.
    expect(container.querySelector('filings')).toBeNull();
    expect(container.innerHTML).toContain('GST &amp; TDS');
    // The decoded <select> value round-trips the ampersand for the auto-fill match.
    const select = container.querySelector('#rv-role-select') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toContain('Jr. Accounts & Finance');
  });

  it('renders a category-card grid (drill-down) in first-seen order with counts', () => {
    const postings = [
      posting({ _id: '1', title: 'CMO', slug: 'cmo', category: 'Leadership / Executive' }),
      posting({ _id: '2', title: 'COO', slug: 'coo', category: 'Leadership / Executive' }),
      posting({ _id: '3', title: 'Marketing Manager', slug: 'mm', category: 'Growth' }),
    ];
    const { container } = render(<CareersApplication postings={postings} />);

    // One card per category (not per role), in arrival order.
    const cards = Array.from(container.querySelectorAll('.rv-cat-card'));
    expect(cards).toHaveLength(2);
    const names = cards.map((c) => c.querySelector('.rv-cat-card-name')?.textContent);
    expect(names).toEqual(['Leadership / Executive', 'Growth']); // leadership first

    // Each card targets a panel; the counts reflect the group sizes.
    const leadershipCard = cards[0];
    expect(leadershipCard.querySelector('.rv-cat-card-count')?.textContent).toContain('2');
    const targetId = leadershipCard.getAttribute('data-cat-target');
    const panel = container.querySelector(`.rv-cat-panel[data-cat-panel="${targetId}"]`) as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.style.display).toBe('none'); // panels are hidden until a card is clicked
    expect(panel.querySelectorAll('.rv-role-card')).toHaveLength(2); // CMO + COO live inside

    // All three role cards still render across panels, with globally-unique ids.
    expect(container.querySelectorAll('.rv-role-card')).toHaveLength(3);
    const ids = Array.from(container.querySelectorAll('.rv-role-card')).map((c) => c.getAttribute('data-role-id'));
    expect(new Set(ids).size).toBe(3);
  });

  it('renders a flat list (no cards) when no role has a category', () => {
    const postings = [posting({ title: 'Solo Role', slug: 'solo' })];
    const { container } = render(<CareersApplication postings={postings} />);
    expect(container.querySelectorAll('.rv-role-card')).toHaveLength(1);
    expect(container.querySelectorAll('.rv-cat-card')).toHaveLength(0);
  });

  it('falls back gracefully when there are no open roles', () => {
    const { container } = render(<CareersApplication postings={[]} />);
    expect(container.querySelectorAll('.rv-role-card')).toHaveLength(0);
    // Only the placeholder + "Other" remain selectable.
    const select = container.querySelector('#rv-role-select') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'Other / Open Application']);
    expect(container.innerHTML).toContain('New roles are being finalised');
  });
});
