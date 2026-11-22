# Autobacs Partner (supplier app)

The phone app for suppliers who sell parts through Autobacs India. Suppliers sign up, send their
company / GST / bank details for approval, then list products with their **cost price**, keep stock
up to date, and see what procurement said about each product.

Suppliers **never see the selling price or the margin**. The app only knows cost + GST ("you get
₹X + GST"). The API does not send those fields, and the app has no type for them.

Built with Expo SDK 58, expo-router, TanStack Query, TypeScript (strict). Same versions as
`Mobile/roavion`.

## Open it on your phone (Expo Go)

1. Install **Expo Go** from the App Store / Play Store.
2. On the Mac, in a terminal:

   ```bash
   cd Mobile/autobacs-partner
   npm install
   npm run start:mock
   ```

3. Phone and Mac on the **same WiFi**. Scan the QR code (iPhone: Camera app; Android: inside Expo Go).

`start:mock` runs against **demo data on the phone** (nothing leaves the phone, a "DEMO DATA" pill
shows at the top). Sign in with:

| | |
|---|---|
| Email | `demo@partner.test` |
| Password | `demo1234` |
| Email code (sign-up / reset) | `123456` |

On the "waiting for approval" screen the demo shows buttons to approve / ask for a fix / reject, so
you can walk through every state.

To use the **real API** instead: `npm start`. It talks to `extra.apiUrl` in `app.json`
(`https://api.autobacsindia.com/api/v1`). To point at another server (a staging or a local backend):

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:5000/api/v1 npm start
```

(Use your Mac's LAN IP, not `localhost` — the phone is a different machine.) The supplier API lives
at `/api/v1/partner/*`; it must be deployed on that server.

The demo mode only works in development builds (`__DEV__`). A release build always uses the real API.

## Scripts

| Command | What it does |
|---|---|
| `npm start` / `npm run start:mock` | Expo dev server (real API / demo data) |
| `npm run web` / `ios` / `android` | Open in a browser / iOS simulator / Android emulator |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint (expo config) |
| `npm test` | Unit tests for money maths and form checks (`node --test`) |
| `npm run brand` | Re-draw icon, adaptive icon, splash, favicon and header badge from `scripts/render-brand.mjs` (needs Google Chrome) |

## How it behaves

- **Status comes from the server.** Which screens you can reach (sign-up, email code, onboarding,
  waiting, products) is decided only by the account status from `GET /partner/me`. The app never
  guesses the next status.
- **Money is whole paise.** Rupees typed into a box are turned into paise by their digits
  (`"1,234.5"` → `123450`), never by multiplying a float. GST is worked out in paise and rounded
  half-up. See `src/lib/money.ts` and `tests/lib.test.ts`.
- **Stock is not optimistic.** Tapping In / Low / Out shows a spinner on that option and only moves
  once the server answers. On failure it stays as it was and says why.
- **Edits are guarded.** Each product has a `rev`; saving an out-of-date copy is refused with "This product was
  changed somewhere else…" instead of overwriting.
- **Plain errors.** No internet, server errors and form problems are shown as one sentence.
- **Signed out on a dead session.** A 401 (expired, or "sign out everywhere" on another phone)
  clears the token and all cached data.
- The sign-in token is kept in the phone's secure storage (SecureStore). No secrets are in the app.

## Folder layout

```
app/                 screens (expo-router; the URL is the file path)
  _layout.tsx        fonts, query client, session, and the status-based screen guards
  welcome, sign-up, verify, sign-in, forgot, onboarding
  (app)/products     product list (tab)        (app)/profile   profile (tab)
  listing/new        add product               listing/[id]    detail  ·  listing/[id]/edit
src/api/             client.ts (HTTP, token, CSRF, errors) · partner.ts (every endpoint) ·
                     mock.ts (demo data) · types.ts (the contract)
src/auth/session.tsx who is signed in
src/features/        product editor, stock toggle, status chips, cache helpers
src/lib/             money, form checks, photo picker, alerts
src/ui/              shared building blocks (Button, Field, Card, Logo…)
assets/              icon, splash, fonts, brand badge
```
