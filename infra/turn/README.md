# Call relay (TURN) — one-to-one team-chat calls

Team-chat voice/video calls go **browser to browser** (WebRTC). Our backend only
rings, answers and passes the connection details along; no audio or video passes
through it. On most networks that is all a call needs.

Some networks (strict office firewalls, some mobile carriers) block the direct
path. For those, the two browsers fall back to this relay, which carries the call.
Without it, calls on those networks fail with "the connection was lost".

## Deploy on Railway (one-time, owner action)

1. New service → deploy from this repo, **Root Directory `infra/turn`** (Dockerfile build).
2. Settings → Networking → **TCP Proxy** → target port `3478`. Railway gives an
   address like `xyz.proxy.rlwy.net:12345`.
3. Variables on the relay service:
   - `TURN_SECRET` — a long random string (`openssl rand -hex 32`).
   - `TURN_REALM` — optional, default `autobacsindia.com`.
4. Variables on the **backend** service:
   - `CALL_TURN_URLS=turn:xyz.proxy.rlwy.net:12345?transport=tcp`
   - `CALL_TURN_SECRET=` the same value as `TURN_SECRET`.
   - optional `CALL_TURN_TTL_SECONDS` (default 21600 = 6 h).
5. Redeploy the backend. Each signed-in staff member now gets a personal relay
   password that expires (HMAC of the shared secret); the secret itself never
   leaves the servers.

## Check it works

On https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/ add
`turn:xyz.proxy.rlwy.net:12345?transport=tcp` with the username/password from a
real call: start a call in the panel, and in the browser's developer tools →
Network, open the `calls` request → response → `iceServers`. A `relay` candidate
in the trickle-ICE list means the relay works.

## Limits and notes

- **TCP only, no TLS.** Railway has no inbound UDP. TCP is slightly worse on bad
  networks than UDP. The few networks that allow only TLS on port 443 still
  cannot connect; that needs a relay on a host with a certificate and port 443.
- **Cost:** only relayed calls use it; a relayed 1:1 video call is roughly
  0.5–1 GB per hour through Railway's egress.
- The relay refuses to reach private/internal addresses (SSRF guard), except
  itself, which it needs when both callers are relayed.
- Rotating the secret: change `TURN_SECRET` and `CALL_TURN_SECRET` together;
  calls in progress keep working until their password expires.
