# ADR: Autobacs Partner — supplier self-service app

Status: accepted by the owner 2026-11-22 (name **Autobacs Partner**, logo **A — "AB badge"**).

## Decision

Suppliers get their own mobile app (`Mobile/autobacs-partner`, Expo, same stack as
`Mobile/roavion`) to sign up, send documents, and list products with **their cost**
and **in/low/out** stock. Procurement approves suppliers and products in the staff
panel and **sets the selling price**. Customers only ever see `Product.price`.

## The safety line (non-negotiable)

1. **Supplier data never reaches customers raw.** A `SupplierListing` is a separate
   record. It becomes / updates a `Product` only through procurement approval.
   Public queries keep their `isActive: true` filter.
2. **Cost never touches `Product`.** It lives only in `SupplierListing.costPaise` and
   `SupplierPriceReview`. So no product API, cache key, CDN entry or Atlas Search
   index can carry it. Do not add a cost/margin field to `Product`.
3. **Suppliers see only their own data**, built through the allow-lists in
   `utils/supplierPortalView.js`. Every supplier query filters on
   `supplierAccount: req.supplier._id`. Never `productId`, selling price, margin,
   other suppliers, or staff identity. (The public website price is public by
   nature; the app just never shows or links to it.)
4. **A supplier cost change never changes a live price.** It upserts the ONE pending
   `SupplierPriceReview` for that listing; procurement applies or keeps.
5. **Stock stays `in/low/out`.** Suppliers cannot set `backorder`. No quantities,
   no reservations. A live listing with `drivesStock: true` pushes its availability
   to `Product.stock` (then purges cache). Out of stock = `stock: 'out'`, NOT
   `isActive: false` — the page stays indexed and shows "out of stock".
6. **Separate auth.** `SupplierAccount` (not `User`). Tokens signed with a key derived
   from the JWT secret (`middleware/supplierAuth.js`), audience `autobacs-partner`,
   Authorization header only, `sessionVersion` checked on every request. A
   supplier token fails `protect`; a staff/customer token fails `protectSupplier`.
7. **Every go-live** (new product, linked product, price change, stock change)
   purges Redis `route:*`/`public:*` + Cloudflare for that product, through the
   existing product write/purge helpers — never a new cache path.

## Records (foundation PR)

| Model | Purpose |
|---|---|
| `SupplierAccount` | supplier login + documents + status (`email_unverified → draft → in_review → approved`, plus `changes_requested`, `rejected`, `suspended`); `supplierId` links the procurement `Supplier` on approval |
| `SupplierListing` | a supplier's product: words, private photos, `costPaise` (ex-GST, integer), `gstPct`, `availability`, `rev` (CAS for approval), `productId` once live |
| `SupplierPriceReview` | cost change on a live product → one pending review per listing; applied/kept rows = price history |
| `MarginRule` | `default` / `category:<id>` target + floor margin (bp of price ex-GST). Built-in 30% / 10% |

Shared helpers: `config/supplierPortal.js`, `utils/supplierPricing.js`
(`suggestSellingPrice`, `marginOfPrice`, `checkPrice`),
`services/supplierPortal/marginRules.js` (`resolveMarginRule`), `repositories/marginRuleRepository.js`,
`utils/supplierPortalView.js`, `middleware/supplierAuth.js`.
Indexes: `npm run create-supplier-portal-indexes -- --apply` after deploy (all new, empty collections).

Margin example: cost ₹1,800 + 18% GST, 30% margin → price ex-GST ₹2,571.43 →
incl. GST ₹3,034.29 → suggested **₹3,035**.

## Build split (one PR each, no shared files)

| # | Piece | Owns |
|---|---|---|
| 1 | Foundation (this) | the files above |
| 2 | Supplier API `/api/v1/partner/*` | `routes/partner.js`, `services/supplierPortal/*` (except `marginRules.js`), `tests/partner*.test.js` |
| 3 | Procurement review API + staff panel | `routes/procurementPartners.js`, `services/procurementPartners/*`, `Front-end/web/src/components/procurement/partners/*` + its panel route, `tests/procurementPartners*.test.js` |
| 4 | Mobile app | `Mobile/autobacs-partner/**` only |

`routes/index.js` gets one mount line from each of 2 and 3 (trivial merge).

## Out of scope for v1 (later versions)

Several suppliers per product with best-pick, Excel bulk upload, supplier
scorecard, supplier payments/credit view, purchase orders in the app,
push/WhatsApp alerts, 7-day "stock still right?" nudge, phone-OTP sign-in
(needs DLT registration), real stock quantities (needs its own ADR).
