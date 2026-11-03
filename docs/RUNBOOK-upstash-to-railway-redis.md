# Runbook — move the cache Redis from Upstash to Railway, then cancel Upstash

**Why:** Upstash costs about $25 a month. It holds the website's short-term memory: saved copies of
pages, login sessions and a few small payment/chat records. A small Redis inside Railway can do the
same job for about $1–3 a month.

**Who does what:** the code change is merged first, through a normal PR. The steps in Railway and
Upstash are done by the owner in the dashboards. Nobody needs to copy a password or connection
address by hand. Railway fills it in through a *reference variable*.

---

## What lives in this Redis (and what happens when it starts empty)

The new Redis starts **empty**. This table shows everything that was in Upstash, and why starting
empty is safe.

| What | Kept for | Effect of starting empty |
|---|---|---|
| Saved copies of pages/API answers (`v3:*`, `ctag:*`, old `route:*`/`public:*`) | ≤ 2 h | The first visitor to each page waits a moment; then it's fast again. |
| Login sessions (`session:*`) | 30 days | **Nobody is logged out.** On a miss the server checks the database and re-saves the session (`utils/sessionManager.js`). |
| Razorpay "already seen this event" marks (`razorpay:event:*`) | 24 h | Safe: fulfilment itself refuses to process a payment twice. |
| Guest checkout tokens (`guest_order:v1:*`) | 30 min | Safe: a hashed copy is on the order in the database. |
| Google/Facebook sign-in codes (`oauth:*`) | 60 s | Anyone signing in at the exact moment just clicks the button again. |
| Chat online/typing/live alerts | seconds | Back within a minute. |
| Link previews in chat | 24 h | Fetched again when next needed. |
| Daily-job "already done today" marks and locks (`cron:*`) | ≤ 36 h | Jobs run on their normal schedule. |
| Popular-search suggestions (`search:analytics:*`, `search:zero:*`) | 90 days | Start again from zero and refill over a few weeks. |
| "Last Razorpay webhook seen" (`razorpay:webhook:last_seen`) | no expiry (one key) | At most one false "webhooks may be down" alert, cleared by the next payment. |

**Staff do not need to be told to log in again.** Warn them only that the site may feel slightly
slower for the first few minutes.

Not affected: the order/email queue, background jobs, login rate limits and CSRF. These already run on
the **other** Railway Redis (`QUEUE_REDIS_URL`).

---

## Step 0 — Deploy the code first

Merge the PR that adds `utils/redisTransport.js`. It makes every Redis client work with Railway's
private network: plain `redis://` and IPv6 DNS. It is harmless while `REDIS_URL` still points at
Upstash.

After the deploy, check the Railway deploy log for `✓ Redis connection verified` and
`[Redis] connection ready`. If they're there, the site is still on Upstash and healthy.

## Step 1 — Create the new Redis in Railway

1. Railway → project **bountiful-surprise** → environment **production**.
2. **+ New → Database → Add Redis.**
3. Rename the new service to **`Redis-Cache`**: click it → Settings → Name. The variable in Step 2
   uses this exact name.
4. Wait until it shows **Active**. Don't change any of its settings.

Leave the existing **`Redis`** service (the one with `redis-volume`) alone. That one runs the order queue.

## Step 2 — Point the website at it

1. Click the **EcommerceAutobacs** service → **Variables**.
2. First write down where the current `REDIS_URL` points. Click the eye icon and note only the host:
   the part after `@` and before `:`, for example `xyz-12345.upstash.io`. This is for the rollback.
   Don't copy the password.
3. Edit `REDIS_URL` and replace its whole value with exactly:

   ```
   ${{Redis-Cache.REDIS_URL}}
   ```

   Railway swaps in the private address and password of the new service automatically.
4. Click **Deploy** on the staged changes. Railway restarts both copies of the server one after the
   other, so the site stays up.

Don't touch `QUEUE_REDIS_URL`.

## Step 3 — Check it worked (about 10 minutes)

1. **Deploy log** of EcommerceAutobacs: look for `✓ Redis connection verified (attempt 1 …)` and
   `[Redis] connection ready`. If you see `FATAL: Redis is required` or `ENOTFOUND`, roll back
   (below).
2. **Site loads:** open https://autobacsindia.com, a category page and a product page.
3. **Still logged in:** open the staff panel in a browser that was already logged in. You should
   **not** be asked to log in again. Log out and back in once to check login.
4. **Cache works:** run this twice. The second time should say `HIT`.

   ```bash
   curl -s -D - -o /dev/null https://api.autobacsindia.com/api/v1/categories | grep -i x-cache
   ```

5. **Memory:** Railway → `Redis-Cache` → Metrics. Memory should climb to a few tens of MB and then
   level off. It should not keep growing.
6. **Payments:** the next real order should show as paid and send its email as usual.

## Step 4 — Watch for 24 hours

- Sentry: no new `Redis unavailable` errors.
- `Redis-Cache` memory stays flat. Every key in it expires on its own, so it can't fill up over time.
- No complaints about logins or the staff chat.

## Step 5 — Cancel Upstash (only after 24 quiet hours)

1. Upstash console → the database → **Settings → Delete database**.
2. Upstash → Billing: make sure the plan is cancelled / back to free and no card charge is pending.
3. Staff panel → **Subscriptions & dues**: mark Upstash as cancelled / remove it.

---

## Rollback (any time before Step 5)

1. EcommerceAutobacs → Variables → set `REDIS_URL` back to the old Upstash connection string. Copy it
   from the Upstash console → database → **Connect** (the `rediss://…` one), and paste it straight
   into Railway.
2. Deploy. The site is back on Upstash within a few minutes. As above, nobody gets logged out.

Once the Upstash database is deleted, rollback means creating a new empty Upstash database. That's
just as safe, because everything rebuilds itself.

## Cost

| | Before | After |
|---|---|---|
| Upstash | ~$25 / month | $0 |
| Railway `Redis-Cache` | — | ~$1–3 / month (a few tens of MB of RAM, almost no CPU) |
| **Saving** | | **~$22–24 / month** |

## Why a second Railway Redis instead of sharing the existing one

The existing `Redis` runs the order/email queue (BullMQ). BullMQ requires Redis never to throw keys
away (`noeviction`). If the cache shared it and ever filled the memory by mistake, new orders' emails
and background jobs would stop. A separate `Redis-Cache` keeps that failure impossible for about
$1–2 a month. The code already keeps the two apart (`REDIS_URL` vs `QUEUE_REDIS_URL`), so sharing
would also be just a variable change if ever wanted (`tests/unit/services/cacheRedisMove.test.js`
proves the key names can't collide).
