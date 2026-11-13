# Website address (URL) clean-up — for the marketing team

The list is in [url-cleanup-2026-11.csv](url-cleanup-2026-11.csv). It comes from the live
sitemap and the live shop on 13 Nov 2026. Nothing has been changed yet.

## What is in the list (232 rows)

| Kind | Rows | What to do |
|---|---|---|
| Product addresses to rename | 53 | Typos, junk like `https-yourstore-com-…`, "product" alone, the `″` inch sign |
| Products to decide on | 2 | Same name twice with different prices. Are they really two products? |
| Product addresses to keep | 5 | They look odd ("-2", "Mark 2") but are real model names |
| Blog addresses to rename | 3 | `/14710-2`, `/14659-2`, and the 🚗 emoji one |
| Categories to merge | 30 | e.g. "Tail Lamp" and "Tail Light" are the same thing |
| Categories to rename | 11 | Typos and "-2" endings |
| Categories with 1 product | 87 | Thin pages. Merge them into a bigger category or add products |
| Categories with 0 products | 41 | Already hidden from Google. Switch off, or add products |

Two things to fix urgently (wrong product behind the address):

- `/products/real-carbon-fiber-rear-spoiler-wing-for-bmw-g20-…` is actually a **carbon
  bonnet**, not a spoiler. It is also listed under Spoilers.
- `/products/bushranger-snatch-strap-11000kg` is actually a **M.A.R.K. Sports** strap.

## How to rename (after the update is live)

1. Open the product, category or blog post in admin.
2. Change the **URL** box to the "Suggested new URL" ending, and save.
3. The old address now sends visitors and Google to the new one automatically (a
   permanent "301" redirect), usually within 5 minutes. Rankings carry over.

Rules:

- **One at a time, in the order of the list.** The two snatch-strap rows must be done
  in order: the first frees the address the second one needs.
- If admin says the address is already taken, keep the old one and tell the developer.
- Brands: renaming the brand **name** changes its address too, and that redirects as well.

## Merging two categories

1. Move every product from the category being merged into the one being kept.
2. Switch the merged category off.
3. Send the developer the list of merged addresses. A developer has to add the redirect
   for a merged (switched-off) category. Without it, the old category address shows
   "not found".

Do the merges in a small batch, then send the whole batch to the developer at once.
