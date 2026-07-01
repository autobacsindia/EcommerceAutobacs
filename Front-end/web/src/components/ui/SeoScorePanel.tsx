'use client';

import { useMemo, useState } from 'react';
import { CheckCircle, XCircle, AlertCircle, Search } from 'lucide-react';

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

interface Check {
  label: string;
  earned: number;
  possible: number;
  tip?: string;
}

interface Group {
  title: string;
  checks: Check[];
  isKeywordGroup?: boolean;
}

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, '').trim();
}

// ── Base groups (100 pts) ───────────────────────────────────────────────────

function buildBaseGroups(data: SeoData): Group[] {
  const groups: Group[] = [];

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

function buildKeywordGroup(data: SeoData, keyword: string): Group {
  const kw = keyword.toLowerCase().trim();
  const checks: Check[] = [];

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

// ── Component ───────────────────────────────────────────────────────────────

export default function SeoScorePanel({ data }: { data: SeoData }) {
  const [focusKeyword, setFocusKeyword] = useState('');

  const { score, groups } = useMemo(() => {
    const baseGroups = buildBaseGroups(data);
    const kw = focusKeyword.trim();
    const allGroups: Group[] = kw
      ? [...baseGroups, buildKeywordGroup(data, kw)]
      : baseGroups;

    const allChecks = allGroups.flatMap(g => g.checks);
    const totalPossible = allChecks.reduce((s, c) => s + c.possible, 0);
    const totalEarned  = allChecks.reduce((s, c) => s + c.earned,   0);
    const score = totalPossible > 0 ? Math.round((totalEarned / totalPossible) * 100) : 0;
    return { score, groups: allGroups };
  }, [data, focusKeyword]);

  const scoreColor   = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444';
  const scoreLabel   = score >= 70 ? 'Good'    : score >= 40 ? 'Needs Work' : 'Poor';
  const scoreLabelCls = score >= 70 ? 'text-green-600' : score >= 40 ? 'text-amber-500' : 'text-red-500';

  const radius       = 40;
  const circumference = 2 * Math.PI * radius;
  const dashOffset   = circumference - (score / 100) * circumference;

  return (
    <div className="bg-obsidian rounded-lg shadow p-4 space-y-4">
      <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">SEO Score</h2>

      {/* ── Focus Keyword input ── */}
      <div>
        <label className="block text-xs font-medium text-ink-muted mb-1">
          Focus Keyword
        </label>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted pointer-events-none" />
          <input
            type="text"
            value={focusKeyword}
            onChange={(e) => setFocusKeyword(e.target.value)}
            placeholder="e.g. toyota fortuner body kit"
            className="w-full pl-7 pr-3 py-1.5 border border-hairline rounded text-xs focus:outline-none focus:ring-2 focus:ring-gold text-ink bg-obsidian placeholder:text-ink-muted"
          />
        </div>
        <p className="text-[10px] text-ink-muted mt-1">
          {focusKeyword.trim()
            ? 'Keyword checks active — 20 bonus points included in score'
            : 'Enter a keyword to unlock +20 keyword-specific checks'}
        </p>
      </div>

      {/* ── Score circle ── */}
      <div className="flex flex-col items-center py-1">
        <svg width="104" height="104" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="10" />
          <circle
            cx="50" cy="50" r={radius}
            fill="none"
            stroke={scoreColor}
            strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
          <text x="50" y="46" textAnchor="middle" dominantBaseline="middle" fontSize="22" fontWeight="bold" fill={scoreColor}>
            {score}
          </text>
          <text x="50" y="63" textAnchor="middle" fontSize="9" fill="#9ca3af">/ 100</text>
        </svg>
        <span className={`text-sm font-semibold mt-1 ${scoreLabelCls}`}>{scoreLabel}</span>
        <span className="text-[10px] text-ink-muted mt-0.5">Updates live as you fill the form</span>
      </div>

      {/* ── Check groups ── */}
      <div className="space-y-2">
        {groups.map(group => {
          const groupEarned   = group.checks.reduce((s, c) => s + c.earned,   0);
          const groupPossible = group.checks.reduce((s, c) => s + c.possible, 0);
          const allPassed     = groupEarned === groupPossible;

          return (
            <details
              key={group.title}
              className={`border rounded-md overflow-hidden ${group.isKeywordGroup ? 'border-blue-200' : 'border-hairline'}`}
              open
            >
              <summary className={`flex items-center justify-between px-3 py-2 text-xs font-semibold cursor-pointer select-none list-none
                ${group.isKeywordGroup
                  ? allPassed ? 'bg-blue-50 text-gold' : 'bg-blue-50 text-gold'
                  : allPassed ? 'bg-green-50 text-green-700' : 'bg-obsidian-deep text-ink/80'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {group.isKeywordGroup && (
                    <Search className="h-3 w-3 shrink-0" />
                  )}
                  {group.title}
                </span>
                <span className={`ml-2 shrink-0 ${allPassed ? (group.isKeywordGroup ? 'text-gold' : 'text-green-600') : 'text-ink-muted'}`}>
                  {groupEarned}/{groupPossible}
                </span>
              </summary>

              <div className="divide-y divide-gray-50">
                {group.checks.map(check => {
                  const passed  = check.earned === check.possible;
                  const partial = check.earned > 0 && !passed;

                  return (
                    <div key={check.label} className="px-3 py-2 flex items-start gap-2">
                      <span className="mt-0.5 shrink-0">
                        {passed
                          ? <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                          : partial
                            ? <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                            : <XCircle className="h-3.5 w-3.5 text-red-400" />
                        }
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-ink/80 leading-snug">{check.label}</p>
                        {check.tip && (
                          <p className="text-[10px] text-ink-muted mt-0.5 leading-snug">{check.tip}</p>
                        )}
                      </div>
                      <span className={`text-[10px] font-medium shrink-0
                        ${passed ? 'text-green-600' : partial ? 'text-amber-500' : 'text-red-400'}`}
                      >
                        {check.earned}/{check.possible}
                      </span>
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}

        {/* Placeholder when no keyword yet */}
        {!focusKeyword.trim() && (
          <div className="border border-dashed border-blue-200 rounded-md px-3 py-4 text-center">
            <Search className="h-4 w-4 text-blue-200 mx-auto mb-1.5" />
            <p className="text-xs text-ink-muted leading-snug">
              Enter a focus keyword above to check title, slug, description placement, and keyword density
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
