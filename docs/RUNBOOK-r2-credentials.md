# Runbook — Cloudflare R2 credentials and buckets

Setup for the Cloudinary → R2 migration. Everything here is dashboard work plus
environment variables; no code changes.

**Read the ordering section before touching the frontend variable.** Setting it
early is the one step in here that breaks the live storefront.

---

## 0. What you are creating

| Thing | Value | Notes |
|---|---|---|
| Public bucket | `autobacs-public` | catalog imagery + generated variants. Gets a custom domain. |
| Private bucket | `autobacs-private` | careers PII, return evidence, invoices, shipping slips. **Never** gets a domain. |
| API token | one, scoped to both buckets | Object Read & Write |
| Custom domain | `img.autobacsindia.com` | on the **public** bucket only |

The two-bucket split is a structural guarantee, not a convention: there is no
public base URL configured for the private bucket, so no code path can mint a
permanent public link to an applicant's CV. Do not collapse them into one bucket
with a prefix.

---

## 1. Create the buckets

Cloudflare dashboard → **R2** → *Create bucket*.

1. Name `autobacs-public` — Location **Automatic**, or **APAC** to sit near your
   users. Leave public access **off** for now (step 4 handles delivery).
2. Repeat for `autobacs-private`.

⚠ On `autobacs-private`, never enable *Public Development URL* and never connect
a custom domain. Its contents are read only through short-lived presigned URLs
minted server-side.

---

## 2. Get the Account ID

R2 → the right-hand sidebar shows **Account ID** (a 32-character hex string).

It is also the first label in the S3 endpoint R2 shows you:
`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

This is the *Cloudflare account* id, not a bucket id and not the zone id.

→ `R2_ACCOUNT_ID`

---

## 3. Create the API token

R2 → **Manage R2 API Tokens** → *Create API token*.

- **Permissions:** `Object Read & Write`
- **Specify buckets:** apply to `autobacs-public` and `autobacs-private` only —
  not "all buckets". If this key ever leaks, the blast radius should be these two.
- **TTL:** leave forever, or set a rotation reminder.

On creation you get:

| Shown as | Env var |
|---|---|
| Access Key ID | `R2_ACCESS_KEY_ID` |
| Secret Access Key | `R2_SECRET_ACCESS_KEY` |

**The secret is displayed once.** Copy it straight into Railway. If you lose it,
delete the token and make a new one — it cannot be re-read.

Ignore the "Use jurisdiction-specific endpoints" option unless you have a data
residency requirement; it changes the endpoint host and the code builds the
standard one.

---

## 4. Connect the delivery domain

`autobacs-public` → **Settings** → *Public access* → **Custom Domains** →
*Connect Domain* → `img.autobacsindia.com`.

`autobacsindia.com` is already on Cloudflare (nameservers `zara`/`darl`), so the
DNS record is created for you and proxied. Wait for status **Active**.

Do **not** enable the `r2.dev` Public Development URL — it is rate-limited, not
meant for production, and bypasses the Worker.

---

## 5. Set the backend variables (Railway)

All five REQUIRED vars must be present or the provider refuses to start and names
what is missing.

```
R2_ACCOUNT_ID=<from step 2>
R2_ACCESS_KEY_ID=<from step 3>
R2_SECRET_ACCESS_KEY=<from step 3>
R2_PUBLIC_BUCKET=autobacs-public
R2_PRIVATE_BUCKET=autobacs-private
R2_PUBLIC_BASE_URL=https://img.autobacsindia.com
R2_SIGNED_GET_TTL_SECONDS=300
R2_SIGNED_PUT_TTL_SECONDS=900

# LEAVE THIS ALONE FOR NOW — see ordering below.
STORAGE_PROVIDER=cloudinary
```

`STORAGE_PROVIDER` is read per call, so flipping it later is an env change plus a
restart, and flipping it back is the rollback. Setting it to `r2` before the
bytes are copied points every write at an empty bucket.

---

## 6. Bucket CORS (needed for admin uploads)

The admin browser uploads directly to R2 with a presigned PUT, so the bucket must
allow it. `autobacs-public` → **Settings** → *CORS policy* → add:

```json
[
  {
    "AllowedOrigins": ["https://autobacsindia.com", "https://www.autobacsindia.com"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

Repeat on `autobacs-private` (careers and return-evidence uploads go there).
Add your Vercel preview origin too if you test uploads from a preview URL.

Without this the upload fails in the browser with an opaque CORS error while the
presigned URL itself is perfectly valid — a confusing hour if you skip it.

---

## 6b. The private bucket — what it does and does NOT need

Almost everything is shared with the public bucket. The full list:

| Item | `autobacs-private` |
|---|---|
| Bucket created (step 1) | yes |
| Inside the API token scope (step 3) | yes |
| `R2_PRIVATE_BUCKET` on Railway (step 5) | yes |
| **CORS policy** | **yes — careers/returns upload browser→R2 directly** |
| Custom domain | **never** |
| Public access / `r2.dev` URL | **never** |
| Bound to the image Worker | **never** |

Only CORS is private-bucket-specific work. Same JSON as step 6, on
`autobacs-private`. Put `https://www.autobacsindia.com` first — the apex
308-redirects to `www`, so that is the origin a browser actually sends.

The rest of that table is deliberate absence, and it is the whole security model:
with no domain and no public URL, an applicant's CV can only be read through a
presigned GET with a 300-second TTL minted server-side. Adding a domain "to make
debugging easier" would give every one of those files a permanent public address.

---

## 7. Deploy the image Worker

```bash
cd infra/cloudflare/image-worker
npx wrangler deploy
```

`wrangler.toml` already binds `autobacs-public` and routes
`img.autobacsindia.com/*`. The Worker resolves the extensionless variant URLs
(`/variants/.../w640`) to `.avif` or `.webp` from the request's Accept header.

Only the public bucket is bound. Never add the private bucket to this Worker.

**Authentication.** `wrangler deploy` needs Cloudflare credentials, and
`wrangler whoami` reporting *"You are not authenticated"* is the usual cause of a
failed deploy. Two ways:

*Interactive* — must run in a real terminal on your own machine. It opens a
browser and waits for you to approve on a `localhost` callback, so it cannot be
run over SSH, in CI, or by an agent:

```bash
npx wrangler login
npx wrangler deploy
```

*Token* — non-interactive, works anywhere, and is the more reliable option:

1. Cloudflare → **My Profile** → **API Tokens** → *Create Token*
2. Template: **Edit Cloudflare Workers**
3. Account Resources: your account · Zone Resources: `autobacsindia.com`

```bash
CLOUDFLARE_API_TOKEN=<token> npx wrangler deploy
```

⚠ This is a DIFFERENT token from the R2 one in step 3. Those are S3 object
credentials — they can read and write bucket contents and cannot deploy a
Worker. Using them here fails with an auth error that looks like a config
problem.

To prove the config is fine independently of auth:

```bash
npx wrangler deploy --dry-run
```

It should report the upload size and `env.BUCKET (autobacs-public)  R2 Bucket`.
If that passes and `deploy` fails, the problem is credentials or the route below.

**Possible route conflict.** Step 4 binds `img.autobacsindia.com` as an R2 custom
domain, and this Worker also claims a route on that hostname. Those can collide.
If the deploy errors about an overlapping route or the hostname being in use,
give the hostname to the Worker instead of to R2:

1. `autobacs-public` → Settings → Custom Domains → **remove** `img.autobacsindia.com`
2. DNS → add `img` as a **proxied** `AAAA` record pointing at `100::`
   (the standard placeholder for a Worker-only hostname)
3. `npx wrangler deploy` again

Nothing is lost: the Worker serves every object through its R2 binding, so the
custom domain was not doing any work once the Worker is in front of it.

---

### The Worker is not on the critical path

Deploy it any time before Phase 6. It exists only to resolve the extensionless
variant URLs (`/variants/.../w640` → `.avif`/`.webp`), and nothing requests those
until the URL rewrite starts putting R2 URLs into Mongo.

Meanwhile the R2 custom domain serves objects directly, so
`https://img.autobacsindia.com/<key>` resolves the moment the bytes land. A
failed Worker deploy does not block the byte copy or the variant backfill —
do those first and come back to it.

---

## 8. Frontend variable (Vercel)

```
NEXT_PUBLIC_IMAGE_BASE_URL=https://img.autobacsindia.com
```

This is the switch that activates R2 delivery: the loader rewrites images on
**this host** to variant URLs and leaves every other host on the Cloudinary path.

Setting it early is SAFE, contrary to what this runbook first claimed. The loader
only rewrites URLs whose host matches this value; every URL in Mongo is still
`res.cloudinary.com`, so they all take the Cloudinary branch untouched. Verified
against the live site on 2026-09-01: 80 Cloudinary URLs, 0 variant URLs, after the
variable was set.

It becomes load-bearing at Phase 6, when the URL rewrite starts putting
R2-hosted URLs into Mongo. From that point the variants must exist first.

---

## Ordering (the part that matters)

1. Buckets, token, domain, CORS, Worker — steps 1–7. **Nothing user-visible.**
2. Backend vars set, `STORAGE_PROVIDER=cloudinary`. Still nothing visible.
3. Copy the bytes:
   `npm run migrate-to-r2` (dry run), then `-- --apply`.
   Additive: writes only to R2, touches neither Cloudinary nor Mongo.
4. Generate variants (backfill).
5. Verify a variant URL by hand:
   `curl -I -H 'Accept: image/avif' https://img.autobacsindia.com/variants/<key>/w640`
   Expect `200` and `content-type: image/avif`.
6. **Then** set `NEXT_PUBLIC_IMAGE_BASE_URL` on Vercel.
7. Later, and separately: `STORAGE_PROVIDER=r2` to send new *uploads* to R2, then
   the URL rewrite in Mongo (products first as a canary).

Rollback at any point after step 6 is unsetting `NEXT_PUBLIC_IMAGE_BASE_URL` —
every image reverts to Cloudinary, because the original URLs are still in Mongo
and nothing has been deleted.

---

## Verifying credentials before you rely on them

```bash
cd Back-end/server
node --import=dotenv/config --input-type=module -e '
  import * as r2 from "./services/storage/r2Provider.js";
  await r2.putObject({ body: Buffer.from("ok"), key: "_healthcheck.txt", scope: "public", contentType: "text/plain" });
  console.log("write OK:", await r2.headObject({ key: "_healthcheck.txt", scope: "public" }));
  console.log("delete OK:", await r2.deleteObject({ key: "_healthcheck.txt", scope: "public" }));
'
```

A missing variable fails fast and names it. An auth failure surfaces as a 401/403
from the SDK.

## Troubleshooting

- **`Missing env: ...`** — one of the five REQUIRED vars is unset. The message names it.
- **SSL or DNS error on the S3 endpoint** — the SDK is using virtual-hosted-style
  (`<bucket>.<account>.r2.cloudflarestorage.com`). If your setup rejects it, add
  `forcePathStyle: true` to the `S3Client` in `services/storage/r2Provider.js`.
- **Custom domain stuck pending** — the zone must be in the same Cloudflare
  account as the bucket.
- **CORS error on admin upload** — step 6, and check the exact origin including scheme.
- **Variant URL 404s** — the variant has not been generated. The Worker falls back
  to the original at a short TTL, so check the original copied first.

## Security notes

- The R2 secret is a backend secret. It belongs in Railway only. Anything in
  `NEXT_PUBLIC_*` is public — never put the key there.
- The private bucket has no domain and no public URL by design. Its contents are
  reachable only through presigned GETs with a 300s TTL.
- Scope the token to the two buckets, not the whole account.
- Rotation: create a second token, swap the Railway vars, restart, then delete the
  old token. `deleteObject`/`putObject` are idempotent so a mid-rotation retry is safe.
