import React from 'react';
import { render, screen } from '@testing-library/react';
import SeoScoreBadge from './SeoScoreBadge';
import SeoScorePanel from '@/components/ui/SeoScorePanel';
import { seoDataFromProduct, type ScorableProduct } from '@/lib/seoScore';

const product: ScorableProduct = {
  name: 'Ironman Snorkel for Toyota Hilux',
  slug: 'ironman-snorkel-for-toyota-hilux',
  description: '<p>Take your Hilux to the next level with the Ironman Snorkel.</p>',
  shortDescription: 'Ironman Snorkel for Toyota Hilux. Built for durability and dust protection.',
  brand: '',
  images: [{ url: 'a.jpg', public_id: 'a', alt: '' }],
  categories: [{ name: 'Snorkel' }],
  tags: ['snorkel'],
  features: [],
  whyChoose: [],
};

describe('SeoScoreBadge', () => {
  it('shows the same score the product editor shows for that product', () => {
    // The editor panel, fed the product the way the edit page loads it.
    const { container, unmount } = render(<SeoScorePanel data={seoDataFromProduct(product)} />);
    const editorScore = container.querySelector('svg text')?.textContent;
    unmount();

    render(<SeoScoreBadge product={product} href="/admin/products/edit/1" />);
    const badge = screen.getByRole('link');

    expect(editorScore).toMatch(/^\d+$/);
    expect(badge).toHaveTextContent(new RegExp(`^${editorScore}`));
  });

  it('links to the product editor and says what the number means', () => {
    render(<SeoScoreBadge product={{}} href="/admin/products/edit/abc" />);
    const badge = screen.getByRole('link', { name: 'SEO score 2 out of 100, Poor' });
    expect(badge).toHaveAttribute('href', '/admin/products/edit/abc');
    expect(badge).toHaveTextContent('2Poor');
  });
});
