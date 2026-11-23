# Autobacs Team (employee app)

Expo SDK 58 app for Autobacs staff: clock in/out with a face check, attendance
history, "ask HR to fix a day", leave and payslips. Replaces Jibble. Contract:
[`docs/ADR-hr-system.md`](../../docs/ADR-hr-system.md). Design: owner-approved
mockup (2026-11-22), light, logo A, brand green `#0a5c33`, DM Sans + Montserrat.

## Run

```bash
npm install
npm run web:mock        # demo data in a browser (no backend, no camera; DEMO DATA ribbon)
EXPO_PUBLIC_API_URL=http://<your-mac-ip>:5001/api/v1 npm start   # against a dev backend
```

The camera, location and secure storage need a **development build** (EAS
`development` profile, `expo-dev-client`), not Expo Go, for the real flow.
Don't start a cloud/paid EAS build without the owner's OK (Apple developer
account is still an open owner input).

`expo.extra.apiUrl` in `app.json` is the production API. For anything except a
release, set `EXPO_PUBLIC_API_URL` to a dev/staging backend — never test with
real employees' faces or data.

## How it works

| Concern | Where | Rule |
|---|---|---|
| API | `src/api/http.ts` (core, no Expo imports), `client.ts` (wiring), `hr.ts` (typed endpoints), `mock.ts` (demo) | 401 → one refresh → Login; "Route not found" = "Coming soon" state, not an error |
| Session | `src/auth/session.tsx` | Staff login (`/auth/login`). Bearer pair in SecureStore if the server returns one; otherwise the native cookie session, with "signed in" in SecureStore |
| Punch | `app/face/check.tsx` | Phone reports location, accuracy, mock flag and 2 frames; the **server** decides fence, liveness and match. Frames go only to our backend |
| Offline | `src/punch/queue.ts`, `PunchProvider.tsx` | `clientPunchId` fixed at capture, reused on every retry; oldest first; stops on a transient error; only the signed-in employee's punches; expires with the offline challenge |
| Face images | `src/punch/storage.ts` | Deleted right after the server answers, on refusal, expiry, cancel and sign-out; orphan sweep on start |
| Leave | `src/lib/leaveForm.ts` | Phone checks obvious mistakes only; server counts days, balance and notice |

## Checks

```bash
npm run typecheck && npm run lint && npm test
```

Brand assets come from one SVG: `npm run brand` (needs Google Chrome).
