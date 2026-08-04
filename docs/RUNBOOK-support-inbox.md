# Runbook — Support inbox (email → tickets)

Turning on the support ticketing system. Every customer conversation — inbound
email, the contact form, product questions, low-rated reviews, returns — lands in
one place at `/admin/support`.

**Architecture in one line:** `support@autobacsindia.com` stays on Google
Workspace exactly as it is; a routing rule forwards a copy to a Postmark inbound
address, which POSTs to our webhook, which creates or threads a ticket.

Mail therefore lands in **two** places: the normal Google inbox (untouched — your
archive and break-glass path) and the ticket system (where work happens). If
ticketing ever breaks, the team opens Gmail as before and nothing is lost. That
redundancy is deliberate; don't "clean it up" by moving MX to Postmark.

---

## 1. Postmark — outbound stream

Support replies go out on their own message stream so a spam complaint on support
mail can't degrade delivery of order confirmations and invoices.

1. Postmark → **Servers** → your server → **Message Streams** → *New stream*
2. Name `support`, type **Transactional**
3. Set `POSTMARK_SUPPORT_STREAM=support` in Railway

Confirm `support@autobacsindia.com` is a verified sender or sits under a
confirmed domain, or Postmark refuses the send.

## 2. Postmark — inbound stream

1. Postmark → **Servers** → your server → **Message Streams** → the **Inbound** stream
2. Copy the inbound address — `<hash>@inbound.postmarkapp.com`
3. Set the **Inbound webhook URL** to, with a generated secret:

   ```
   https://any:<POSTMARK_INBOUND_SECRET>@api.autobacsindia.com/api/v1/support/inbound
   ```

   The username is ignored; the password is compared in constant time. Generate
   the secret with `openssl rand -hex 32`.

4. Enable **Include raw email content** — not required, but it makes a
   misthreaded message diagnosable after the fact.

> The webhook is mounted in `app.js` **ahead of the CSRF middleware**, like the
> Razorpay one. A server-to-server POST carries no cookie or CSRF token, so
> behind CSRF every delivery would 403 and Postmark would eventually disable the
> hook — silently cutting off customer email.

## 3. Google Workspace — forward a copy

Admin console → **Apps → Google Workspace → Gmail → Routing** → *Configure*.

- **Messages to affect:** Inbound
- **Envelope filter:** Only affect specific envelope recipients →
  `support@autobacsindia.com`
- **Also deliver to:** *Add more recipients* → the Postmark inbound address
- Leave the original delivery in place — the Google inbox must keep receiving.

Save, then send a test message to `support@` and confirm it appears in **both**
Gmail and `/admin/support`.

> Using a Google **Group** (Collaborative Inbox) for support@ instead of a
> mailbox? Set the group's posting permissions to allow external senders, or
> outside mail is rejected before any routing rule runs.

## 4. Environment variables (Railway)

| Variable | Required | Notes |
|---|---|---|
| `SUPPORT_EMAIL` | yes | Public support address; must accept plus-addressing |
| `SUPPORT_FROM_NAME` | no | Sender display name |
| `POSTMARK_SUPPORT_STREAM` | yes | From step 1 |
| `SUPPORT_REPLY_SECRET` | **yes** | `openssl rand -hex 32`. Not JWT_SECRET — see below |
| `POSTMARK_INBOUND_SECRET` | **yes** | From step 2. Handler **fails closed** without it |
| `POSTMARK_INBOUND_IPS` | no | Unset = built-in list. Empty string = disable the check |
| `SUPPORT_HOLIDAYS` | no | IST `YYYY-MM-DD`, comma-separated |
| `SUPPORT_SILENCE_ALERT_HOURS` | no | Default 4 |
| `SUPPORT_HEALTH_CRON` | no | Default `*/15 * * * *` |

`SUPPORT_REPLY_SECRET` is separate from `JWT_SECRET` on purpose: it is embedded
in plaintext in every outbound email and passes through third-party mail servers,
so it must be rotatable without invalidating every user session.

**Rotating it** invalidates reply tokens in already-sent mail. Those replies fall
back to RFC `References` matching (which still works) or open a new ticket. Rotate
during a quiet window.

## 5. Verify

```bash
# 1. Webhook rejects an unauthenticated call
curl -si https://api.autobacsindia.com/api/v1/support/inbound -X POST \
  -H 'Content-Type: application/json' -d '{}' | head -1      # expect 401

# 2. Real mail creates a ticket
#    Send to support@autobacsindia.com, then check /admin/support
```

Then confirm the full round trip:

1. Email `support@` from an outside address → ticket appears, customer gets an
   acknowledgement with a reference like `ABI-1042`
2. Reply from `/admin/support/<id>` → arrives from `support@autobacsindia.com`
3. Reply to **that** email → lands on the **same** ticket, not a new one
4. Resolve the ticket, then reply again → it **reopens** (within 14 days)

Step 3 is the one that matters. If it opens a new ticket, threading is broken —
see below.

---

## Troubleshooting

**Tickets stopped arriving.** The alert fires after 4 business hours of total
silence. Check in order:
1. Postmark → Inbound stream → is the webhook returning 200?
2. Google routing rule still enabled?
3. Railway logs for `[SupportInbound]` — `401` = bad secret, `403` = IP not allowlisted

Captured-but-unprocessed emails are retried automatically by the 15-minute sweep,
so a Redis outage self-heals. Nothing is lost: raw payloads are persisted before
the webhook acknowledges.

**Replies open new tickets instead of threading.** Threading tries, in order:
signed reply-to token → RFC `References` → `[ABI-nnnn]` in the subject. Check
that `SUPPORT_EMAIL`'s domain delivers plus-addressed mail, and that
`SUPPORT_REPLY_SECRET` has not changed since the original mail was sent.

The subject-line fallback deliberately only matches when the sender is the
ticket's requester — a `From:` header is trivially forged, and without that check
anyone could read or inject into any ticket by guessing `ABI-1042`.

**A ticket went quiet / loop guard tripped.** If one ticket sends more than 10
emails in an hour, outbound is suppressed and `loopGuardTrippedAt` is stamped.
That almost always means an autoresponder ping-pong. Inspect the thread, then
clear `outboundInWindow` and `loopGuardTrippedAt` to resume.

**Attachments missing.** Non-allowlisted types are rejected and recorded on the
message as `rejectedAttachments` with a reason, visible in the thread — so an
agent can ask for a resend rather than the evidence silently vanishing. Limits
live in `config/supportPolicy.js`.

---

## Operational notes

- **Raw inbound payloads self-delete 30 days after processing** (TTL on
  `InboundEmail.processedAt`). The sanitised copy on `SupportMessage` is the
  long-lived record. Unprocessed emails are never expired, so a replay is always
  possible.
- **Attachments are private Cloudinary assets** under `autobacs/support/<ref>`,
  served only via short-lived signed URLs minted behind admin auth.
- **Inbound HTML is hostile by definition.** It is sanitised server-side and
  rendered in a sandboxed iframe with neither `allow-scripts` nor
  `allow-same-origin`. Both layers are required — do not simplify either.
- **SLA clocks are business-hours aware** (Mon–Sat 10:00–18:00 IST, holidays
  excluded), so out-of-hours mail is not born breached. BullMQ delayed jobs are
  the fast path; the 15-minute sweep is the net under them, because those jobs
  live in Redis and vanish on a flush.
- **Returns keep their own workflow.** A return's ticket carries only the
  conversation; `ReturnRequest` remains the system of record for refund maths,
  evidence and the 4-day policy window.
