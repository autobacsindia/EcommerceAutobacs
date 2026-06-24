import { jest } from '@jest/globals';

// The script imports the Product model (for its run() path) but does not connect
// to Mongo at import time; the migration runner is guarded behind an isMain check.
const {
  looksLikeHtml, htmlBlocks, textBlocks, partition, coalesceItems,
} = await import('../../../scripts/split-description-sections.js');

describe('split-description-sections parser', () => {
  const NAME = 'Toyota Hilux Roof Rail with Cross Bar';

  const HTML = `
    <h2>Toyota Hilux Roof Rail with Cross Bar</h2>
    <p>The <strong>Toyota Hilux Roof Rail with Cross Bar</strong> is a smart upgrade for owners who need more carrying flexibility.</p>
    <h3>Key Features</h3>
    <p><strong>Extra Cargo Space –</strong> Allows you to carry additional luggage and gear.</p>
    <p><strong>Accessory Ready –</strong> Supports mounts for roof racks and bike carriers.</p>
    <h3>Why Choose the Toyota Hilux Roof Rail with Cross Bar</h3>
    <p><strong>Reliable strength –</strong> Offers stable performance while carrying heavy gear.</p>`;

  const TEXT = [
    'Toyota Hilux Roof Rail with Cross Bar',
    'The Toyota Hilux Roof Rail with Cross Bar is a smart upgrade for owners.',
    'Key Features',
    'Extra Cargo Space – Allows you to carry additional luggage and gear.',
    'Accessory Ready – Supports mounts for roof racks and bike carriers.',
    'Why Choose the Toyota Hilux Roof Rail with Cross Bar',
    'Reliable strength – Offers stable performance while carrying heavy gear.',
  ].join('\n');

  it('detects HTML vs flattened text', () => {
    expect(looksLikeHtml(HTML)).toBe(true);
    expect(looksLikeHtml(TEXT)).toBe(false);
  });

  it('parses the HTML branch into intro / features / whyChoose', () => {
    const r = partition(htmlBlocks(HTML), NAME);
    expect(r.matched).toBe(true);
    expect(r.features).toHaveLength(2);
    expect(r.features[0]).toMatch(/Extra Cargo Space – Allows/);
    expect(r.whyChoose).toHaveLength(1);
    expect(r.whyChoose[0]).toMatch(/Reliable strength –/);
    // Intro keeps the paragraph, drops the duplicate <h2> title and the headings.
    expect(r.description).toMatch(/smart upgrade/);
    expect(r.description).not.toMatch(/Key Features/i);
    expect(r.description).not.toMatch(/Why Choose/i);
  });

  it('parses the flattened-text branch into intro / features / whyChoose', () => {
    const r = partition(textBlocks(TEXT), NAME);
    expect(r.matched).toBe(true);
    expect(r.features).toHaveLength(2);
    expect(r.whyChoose).toHaveLength(1);
    expect(r.description).toBe('The Toyota Hilux Roof Rail with Cross Bar is a smart upgrade for owners.');
  });

  it('reports no match when there are no headings (left untouched)', () => {
    const r = partition(textBlocks('Just a plain description with no sections.'), NAME);
    expect(r.matched).toBe(false);
    expect(r.features).toEqual([]);
    expect(r.whyChoose).toEqual([]);
  });

  it('coalesces a separator-less continuation into the previous item', () => {
    const merged = coalesceItems([
      'Better ride comfort – Reduces stiffness',
      'This results in smoother travel across all roads.',
      'Durable construction – Built to last',
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe('Better ride comfort – Reduces stiffness This results in smoother travel across all roads.');
    expect(merged[1]).toBe('Durable construction – Built to last');
  });

  it('keeps colon-title items separate and normalizes them to "Title – desc"', () => {
    const items = coalesceItems([
      'BMW M4 CS Inspired Design:Delivers a sharp rear look.',
      'High-Brightness LED Illumination:Provides strong visibility.',
      'Premium ABS Construction:Durable housing resists heat.',
    ]);
    expect(items).toHaveLength(3); // not merged into one
    expect(items[0]).toBe('BMW M4 CS Inspired Design – Delivers a sharp rear look.');
    expect(items[1]).toBe('High-Brightness LED Illumination – Provides strong visibility.');
  });

  it('parses a colon-style flattened product into multiple feature items', () => {
    const colonText = [
      'Fortuner Tail Light',
      'A bold rear upgrade.',
      'Key Features',
      'BMW M4 CS Inspired Design:Delivers a sharp rear look.',
      'High-Brightness LED Illumination:Provides strong visibility.',
      'Why Choose Fortuner Tail Light',
      'Enhanced Road Presence:Gives a wider stance.',
    ].join('\n');
    const r = partition(textBlocks(colonText), 'Fortuner Tail Light');
    expect(r.features).toHaveLength(2);
    expect(r.whyChoose).toHaveLength(1);
    expect(r.features[0]).toMatch(/BMW M4 CS Inspired Design – Delivers/);
  });
});
