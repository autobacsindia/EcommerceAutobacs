import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import SlugField, { slugify } from './SlugField';

/** The real screens hold the slug in their form state; this mirrors that. */
function Harness({ initialTitle = '', existing = false, initialSlug = '' }) {
  const [title, setTitle] = useState(initialTitle);
  const [slug, setSlug] = useState(initialSlug);
  return (
    <>
      <input aria-label="title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <SlugField title={title} value={slug} onChange={setSlug} existing={existing} />
    </>
  );
}

const slugInput = () => screen.getByRole('textbox', { name: /product url/i }) as HTMLInputElement;
const typeTitle = (v: string) => fireEvent.change(screen.getByLabelText('title'), { target: { value: v } });

describe('slugify', () => {
  // These must match Back-end/server/utils/slug.js exactly, or the admin is
  // shown one URL and the product saves with another.
  it.each([
    ['Bushranger MKII Winch | 12,000LB | SYNTHETIC', 'bushranger-mkii-winch-12-000lb-synthetic'],
    ['Toyota A&B  Kit', 'toyota-a-b-kit'],
    ['  Dr. Nano 7 ', 'dr-nano-7'],
    ['---Already-Slugged---', 'already-slugged'],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe('SlugField on a new product', () => {
  it('fills itself in from the title', () => {
    render(<Harness />);
    typeTitle('Ironman 4x4 Snorkel');
    expect(slugInput().value).toBe('ironman-4x4-snorkel');
  });

  it('keeps tracking the title until the admin edits it', () => {
    render(<Harness />);
    typeTitle('Winch');
    expect(slugInput().value).toBe('winch');
    typeTitle('Winch Pro');
    expect(slugInput().value).toBe('winch-pro');
  });

  it('stops tracking once edited, so fixing a typo in the title cannot discard it', () => {
    render(<Harness />);
    typeTitle('Winch Pro');
    fireEvent.change(slugInput(), { target: { value: 'best-winch' } });
    expect(slugInput().value).toBe('best-winch');

    typeTitle('Winch Professional');
    expect(slugInput().value).toBe('best-winch'); // untouched by the title edit
  });

  it('normalises as you type, so the preview is the URL that will be saved', () => {
    render(<Harness />);
    fireEvent.change(slugInput(), { target: { value: 'My Winch & Rope!!' } });
    expect(slugInput().value).toBe('my-winch-rope');
  });
});

describe('SlugField on an existing product', () => {
  it('never rewrites a live URL from the title', () => {
    render(<Harness existing initialSlug="original-url" initialTitle="Original" />);
    typeTitle('A Completely New Title');
    // The URL is indexed and shared; only a deliberate edit may change it.
    expect(slugInput().value).toBe('original-url');
  });

  it('still allows a deliberate change, and warns about the consequence', () => {
    render(<Harness existing initialSlug="original-url" />);
    fireEvent.change(slugInput(), { target: { value: 'new-url' } });
    expect(slugInput().value).toBe('new-url');
    expect(screen.getByText(/old address will stop working/i)).toBeInTheDocument();
  });
});
