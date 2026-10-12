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

  it('renders every role up front, grouped under department headings', () => {
    const postings = [
      posting({ _id: '1', title: 'CMO', slug: 'cmo', category: 'Leadership / Executive' }),
      posting({ _id: '2', title: 'COO', slug: 'coo', category: 'Leadership / Executive' }),
      posting({ _id: '3', title: 'Marketing Manager', slug: 'mm', category: 'Growth' }),
    ];
    const { container } = render(<CareersApplication postings={postings} />);

    // One heading per category (not per role), in arrival order.
    const heads = Array.from(container.querySelectorAll('.rv-cat-head'));
    expect(heads.map((h) => h.querySelector('.rv-cat-head-name')?.textContent)).toEqual([
      'Leadership / Executive',
      'Growth',
    ]);
    expect(heads[0].querySelector('.rv-cat-head-count')?.textContent).toContain('2');

    // The point of the change: no role is hidden behind a drill-down. All three
    // are in the DOM and visible, with globally-unique accordion ids.
    const cards = Array.from(container.querySelectorAll('.rv-role-card'));
    expect(cards).toHaveLength(3);
    expect(new Set(cards.map((c) => c.getAttribute('data-role-id'))).size).toBe(3);
    expect(container.querySelectorAll('[style*="display:none"] .rv-role-card')).toHaveLength(0);

    // Leadership's two roles sit under its heading, Growth's one under its own.
    const groups = Array.from(container.querySelectorAll('.rv-cat-roles'));
    expect(groups.map((g) => g.querySelectorAll('.rv-role-card').length)).toEqual([2, 1]);
  });

  it('states the open-role count on the hero call to action', () => {
    const { container } = render(
      <CareersApplication postings={[posting({ title: 'A', slug: 'a' }), posting({ _id: '2', title: 'B', slug: 'b' })]} />,
    );
    expect(container.querySelector('.rv-btn-primary')?.textContent).toContain('(2)');
  });

  it('carries its own minimal chrome: logo and a way home, nothing else', () => {
    const { container } = render(<CareersApplication postings={[]} />);
    const bar = container.querySelector('.rv-topbar') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.querySelector('.rv-topbar-logo')?.getAttribute('href')).toBe('/');
    expect(bar.querySelector('.rv-topbar-home')?.getAttribute('href')).toBe('/');
    // No search, no vehicle picker, no department nav — the store header is
    // suppressed on this route (ConditionalHeader).
    expect(bar.querySelectorAll('input, select')).toHaveLength(0);
  });

  it('renders a flat list (no headings) when no role has a category', () => {
    const postings = [posting({ title: 'Solo Role', slug: 'solo' })];
    const { container } = render(<CareersApplication postings={postings} />);
    expect(container.querySelectorAll('.rv-role-card')).toHaveLength(1);
    expect(container.querySelectorAll('.rv-cat-head')).toHaveLength(0);
  });

  it('falls back gracefully when there are no open roles', () => {
    const { container } = render(<CareersApplication postings={[]} />);
    expect(container.querySelectorAll('.rv-role-card')).toHaveLength(0);
    // Only the placeholder + "Other" remain selectable.
    const select = container.querySelector('#rv-role-select') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'Other / Open Application']);
    expect(container.innerHTML).toContain('New roles are being finalised');
    // The count placeholder must resolve even with nothing to count.
    expect(container.innerHTML).not.toContain('ROLE_COUNT');
  });
});
