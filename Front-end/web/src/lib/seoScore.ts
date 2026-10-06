/**
 * Product SEO score — the ONE implementation.
 *
 * Used live by the product editor's SEO panel (components/ui/SeoScorePanel) and by
 * the admin Products list, so the number in the list is always the number the
 * editor shows when that product is opened (the editor starts with no focus
 * keyword, so the list shows the base score out of 100).
 *
 * Pure functions only: no React, no I/O.
 */

export interface SeoData {
  name: string;
  description: string;
  shortDescription: string;
  brand: string;
  slug: string;
  existingImages: { url: string; public_id: string; alt?: string; isPrimary?: boolean }[];
  newImageCount: number;
  selectedCategories: string[];
  tagsInput: string;
  features: string[];
  whyChoose: string[];
}

export interface SeoCheck {
  label: string;
  earned: number;
  possible: number;
  tip?: string;
}

export interface SeoGroup {
  title: string;
  checks: SeoCheck[];
  isKeywordGroup?: boolean;
}

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, '').trim();
}

// ── Base groups (100 pts) ───────────────────────────────────────────────────

export function buildBaseGroups(data: SeoData): SeoGroup[] {
  const groups: SeoGroup[] = [];

  // Group 1: Title & Permalink — 20 pts
  const nameLen = data.name.trim().length;
  const slugWords = data.slug.split('-').filter(Boolean).length;
  groups.push({
    title: 'Title & Permalink',
    checks: [
      {
        label: 'Product name is set',
        earned: nameLen > 0 ? 5 : 0,
        possible: 5,
        tip: nameLen === 0 ? 'Enter a product name.' : undefined,
      },
      {
        label: `Title length — ${nameLen} chars (30–60 ideal)`,
        earned: nameLen >= 30 && nameLen <= 60 ? 8 : nameLen >= 20 && nameLen < 70 ? 4 : nameLen > 0 ? 1 : 0,
        possible: 8,
        tip: nameLen > 0 && (nameLen < 30 || nameLen > 60) ? `Ideal is 30–60 chars (currently ${nameLen}).` : undefined,
      },
      {
        label: `URL slug — ${slugWords} word${slugWords !== 1 ? 's' : ''} (3+ ideal)`,
        earned: slugWords >= 3 ? 5 : slugWords >= 1 ? 2 : 0,
        possible: 5,
        tip: slugWords < 3 ? 'Edit the permalink to include more keywords.' : undefined,
      },
      {
        label: `Slug length — ${data.slug.length} chars (<60 ideal)`,
        earned: data.slug.length <= 60 ? 2 : data.slug.length <= 80 ? 1 : 0,
        possible: 2,
        tip: data.slug.length > 60 ? 'Shorten the URL slug below 60 characters.' : undefined,
      },
    ],
  });

  // Group 2: Description — 30 pts
  const descText = stripHtml(data.description);
  const wordCount = descText ? descText.split(/\s+/).filter(Boolean).length : 0;
  const hasHeadings = /<h[2-3]/i.test(data.description);
  const hasLists = /<(ul|ol)/i.test(data.description);
  groups.push({
    title: 'Description',
    checks: [
      {
        label: 'Description is set',
        earned: descText.length > 0 ? 5 : 0,
        possible: 5,
        tip: descText.length === 0 ? 'Write a product description.' : undefined,
      },
      {
        label: `Word count — ${wordCount} words (150+ ideal)`,
        earned: wordCount >= 150 ? 10 : wordCount >= 75 ? 6 : wordCount >= 30 ? 3 : 0,
        possible: 10,
        tip: wordCount < 150 ? `Write ${150 - wordCount} more words for better depth.` : undefined,
      },
      {
        label: 'Uses H2 / H3 headings',
        earned: hasHeadings ? 8 : 0,
        possible: 8,
        tip: !hasHeadings ? 'Use Heading 2 or 3 in the toolbar to structure content.' : undefined,
      },
      {
        label: 'Uses bullet or numbered lists',
        earned: hasLists ? 7 : 0,
        possible: 7,
        tip: !hasLists ? 'Add a list to improve readability and scannability.' : undefined,
      },
    ],
  });

  // Group 3: Short Description — 10 pts
  const sdLen = data.shortDescription.trim().length;
  groups.push({
    title: 'Short Description',
    checks: [
      {
        label: 'Short description is set',
        earned: sdLen > 0 ? 5 : 0,
        possible: 5,
        tip: sdLen === 0 ? 'Add a short description shown in product cards.' : undefined,
      },
      {
        label: `Length — ${sdLen} chars (50+ ideal)`,
        earned: sdLen >= 50 ? 5 : sdLen > 0 ? 2 : 0,
        possible: 5,
        tip: sdLen > 0 && sdLen < 50 ? `Add ${50 - sdLen} more characters.` : undefined,
      },
    ],
  });

  // Group 4: Images — 15 pts
  const totalImages = data.existingImages.length + data.newImageCount;
  const imgsWithAlt = data.existingImages.filter(img => (img.alt ?? '').trim().length > 0).length;
  const altScore =
    data.existingImages.length === 0 ? 0
    : imgsWithAlt === data.existingImages.length ? 5
    : imgsWithAlt > 0 ? 2 : 0;
  groups.push({
    title: 'Images',
    checks: [
      {
        label: 'Has at least 1 image',
        earned: totalImages >= 1 ? 5 : 0,
        possible: 5,
        tip: totalImages === 0 ? 'Upload a product image.' : undefined,
      },
      {
        label: `Image count — ${totalImages} (3+ ideal)`,
        earned: totalImages >= 3 ? 5 : totalImages >= 1 ? 2 : 0,
        possible: 5,
        tip: totalImages < 3 ? `Upload ${3 - totalImages} more images.` : undefined,
      },
      {
        label: `Alt text — ${imgsWithAlt} / ${data.existingImages.length} images`,
        earned: altScore,
        possible: 5,
        tip: data.existingImages.length > 0 && imgsWithAlt < data.existingImages.length
          ? 'Add alt text to every image for SEO and accessibility.'
          : undefined,
      },
    ],
  });

  // Group 5: Taxonomy — 15 pts
  const tagCount = data.tagsInput.split(',').map(t => t.trim()).filter(Boolean).length;
  groups.push({
    title: 'Taxonomy',
    checks: [
      {
        label: 'Category assigned',
        earned: data.selectedCategories.length >= 1 ? 5 : 0,
        possible: 5,
        tip: data.selectedCategories.length === 0 ? 'Assign at least one category.' : undefined,
      },
      {
        label: 'Brand is set',
        earned: data.brand.trim().length > 0 ? 5 : 0,
        possible: 5,
        tip: !data.brand.trim() ? 'Enter the product brand.' : undefined,
      },
      {
        label: `Tags — ${tagCount} added (5+ ideal)`,
        earned: tagCount >= 5 ? 5 : tagCount >= 3 ? 3 : tagCount >= 1 ? 1 : 0,
        possible: 5,
        tip: tagCount < 5 ? `Add ${5 - tagCount} more relevant tags.` : undefined,
      },
    ],
  });

  // Group 6: Rich Content — 10 pts
  const validFeatures = data.features.filter(f => f.trim()).length;
  const validWhyChoose = data.whyChoose.filter(w => w.trim()).length;
  groups.push({
    title: 'Rich Content',
    checks: [
      {
        label: `Key features — ${validFeatures} (3+ ideal)`,
        earned: validFeatures >= 3 ? 5 : validFeatures >= 1 ? 2 : 0,
        possible: 5,
        tip: validFeatures < 3 ? 'Add at least 3 key product features.' : undefined,
      },
      {
        label: `Why-choose points — ${validWhyChoose} (3+ ideal)`,
        earned: validWhyChoose >= 3 ? 5 : validWhyChoose >= 1 ? 2 : 0,
        possible: 5,
        tip: validWhyChoose < 3 ? 'Add "Why choose" points to help customers and boost SEO.' : undefined,
      },
    ],
  });

  return groups; // total possible = 100
}

// ── Focus keyword group (+20 pts) ──────────────────────────────────────────

export function buildKeywordGroup(data: SeoData, keyword: string): SeoGroup {
  const kw = keyword.toLowerCase().trim();
  const checks: SeoCheck[] = [];

  // 1. Keyword in title — 5 pts
  const inTitle = data.name.toLowerCase().includes(kw);
  checks.push({
    label: `Keyword in product title`,
    earned: inTitle ? 5 : 0,
    possible: 5,
    tip: !inTitle ? `Add "${keyword}" to the product title.` : undefined,
  });

  // 2. Keyword in URL slug — 4 pts
  const slugKw = kw.replace(/\s+/g, '-');
  const inSlug = data.slug.toLowerCase().includes(slugKw);
  checks.push({
    label: `Keyword in URL slug`,
    earned: inSlug ? 4 : 0,
    possible: 4,
    tip: !inSlug ? `Edit the permalink to include "${keyword}".` : undefined,
  });

  // 3. Keyword in opening 200 chars of description — 4 pts
  const descPlain = stripHtml(data.description).toLowerCase();
  const inOpening = descPlain.slice(0, 200).includes(kw);
  checks.push({
    label: `Keyword in opening paragraph`,
    earned: inOpening ? 4 : 0,
    possible: 4,
    tip: !inOpening ? `Mention "${keyword}" near the start of the description.` : undefined,
  });

  // 4. Keyword in short description — 3 pts
  const inShortDesc = data.shortDescription.toLowerCase().includes(kw);
  checks.push({
    label: `Keyword in short description`,
    earned: inShortDesc ? 3 : 0,
    possible: 3,
    tip: !inShortDesc ? `Include "${keyword}" in the short description.` : undefined,
  });

  // 5. Keyword density in description — 4 pts (ideal 0.5–2.5 %)
  const totalWords = descPlain.split(/\s+/).filter(Boolean).length;
  const kwWordCount = kw.split(/\s+/).length;
  let occurrences = 0;
  let pos = 0;
  while ((pos = descPlain.indexOf(kw, pos)) !== -1) { occurrences++; pos += kw.length; }
  const density = totalWords > 0 ? (occurrences * kwWordCount / totalWords) * 100 : 0;
  const goodDensity = density >= 0.5 && density <= 2.5;
  checks.push({
    label: `Keyword density — ${density.toFixed(1)}% (0.5–2.5% ideal)`,
    earned: goodDensity ? 4 : density > 0 ? 1 : 0,
    possible: 4,
    tip: density < 0.5 && totalWords > 0
      ? `Use "${keyword}" more naturally in the description.`
      : density > 2.5
        ? `"${keyword}" is overused (${density.toFixed(1)}%) — ease off to avoid stuffing.`
        : undefined,
  });

  return {
    title: `Focus Keyword — "${keyword}"`,
    checks,
    isKeywordGroup: true,
  };
}

// ── Scoring ─────────────────────────────────────────────────────────────────

/** Groups (base, plus the keyword group when a keyword is given) and the 0–100 score. */
export function computeSeoScore(data: SeoData, focusKeyword = ''): { score: number; groups: SeoGroup[] } {
  const baseGroups = buildBaseGroups(data);
  const kw = focusKeyword.trim();
  const groups = kw ? [...baseGroups, buildKeywordGroup(data, kw)] : baseGroups;
  const allChecks = groups.flatMap(g => g.checks);
  const totalPossible = allChecks.reduce((s, c) => s + c.possible, 0);
  const totalEarned = allChecks.reduce((s, c) => s + c.earned, 0);
  const score = totalPossible > 0 ? Math.round((totalEarned / totalPossible) * 100) : 0;
  return { score, groups };
}

export type SeoRating = 'good' | 'needs-work' | 'poor';

/** The editor's bands: 70+ Good, 40–69 Needs Work, below 40 Poor. */
export function seoRating(score: number): { rating: SeoRating; label: string } {
  if (score >= 70) return { rating: 'good', label: 'Good' };
  if (score >= 40) return { rating: 'needs-work', label: 'Needs Work' };
  return { rating: 'poor', label: 'Poor' };
}

/** A saved product as the API returns it — only the fields the score reads. */
export interface ScorableProduct {
  name?: string | null;
  description?: string | null;
  shortDescription?: string | null;
  brand?: string | null;
  slug?: string | null;
  images?: { url?: string | null; public_id?: string | null; alt?: string | null; isPrimary?: boolean | null }[] | null;
  categories?: unknown[] | null;
  category?: unknown;
  tags?: string[] | null;
  features?: string[] | null;
  whyChoose?: string[] | null;
}

/**
 * A saved product → the editor's form values, exactly as the edit page loads them
 * (images with alt, categories by count, tags joined with ", ", no new uploads).
 * Keep in step with the loader in app/admin/products/edit/[id]/page.tsx.
 */
export function seoDataFromProduct(p: ScorableProduct): SeoData {
  const categories = Array.isArray(p.categories) && p.categories.length
    ? p.categories.map(String)
    : p.category ? [String(p.category)] : [];
  return {
    name: p.name || '',
    description: p.description || '',
    shortDescription: p.shortDescription || '',
    brand: p.brand || '',
    slug: p.slug || '',
    existingImages: (p.images || []).map((img) => ({
      url: img?.url || '',
      public_id: img?.public_id || '',
      alt: img?.alt || '',
      isPrimary: img?.isPrimary || false,
    })),
    newImageCount: 0,
    selectedCategories: categories,
    tagsInput: Array.isArray(p.tags) ? p.tags.join(', ') : '',
    features: p.features || [],
    whyChoose: p.whyChoose || [],
  };
}

/** The base score (no focus keyword) the editor shows when this product is opened. */
export const productSeoScore = (p: ScorableProduct): number => computeSeoScore(seoDataFromProduct(p)).score;
