# Autobacs Team (employee app)

Expo SDK 58 app for Autobacs staff: clock in/out with a face check, attendance
history, "ask HR to fix a day", leave, payslips (PDF), marks and overtime,
documents, holidays, profile, phone notifications, and an Approvals tab for
team heads and HR. Replaces Jibble. Contract:
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
| Session | `src/auth/session.tsx`, `src/api/http.ts` | Staff login with `X-Client: autobacs-team` → the server returns the Bearer pair in the body (no cookies). Pair in SecureStore; requests go `credentials: 'omit'`. Sign-out revokes the refresh token on the server |
| Approvals | `app/(tabs)/approvals.tsx`, `src/auth/capabilities.ts` | Tab shown only when `GET /hr/me/app` allows it (heads: leave + overtime; HR/admin: all three). Never optimistic: a card goes only after the server accepted and the list reloaded; 409 = "someone else decided" |
| Push | `src/push/*`, server `services/hr/notify` | Expo token per install (`PUT /hr/me/push-token`), removed on sign-out. Taps open only allow-listed screens. Fails soft |
| Updates | `src/updates/useOtaUpdate.ts`, `app.json` `updates` + `runtimeVersion: appVersion` | JS fixes ship over the air (EAS Update), no reinstall. See below |
| Dates | `src/ui/DateField.tsx` | Native date/time picker everywhere; never typed |
| Punch | `app/face/check.tsx` | Phone reports location, accuracy, mock flag and 2 frames; the **server** decides fence, liveness and match. Frames go only to our backend |
| Offline | `src/punch/queue.ts`, `PunchProvider.tsx` | `clientPunchId` fixed at capture, reused on every retry; oldest first; stops on a transient error; only the signed-in employee's punches; expires with the offline challenge |
| Face images | `src/punch/storage.ts` | Deleted right after the server answers, on refusal, expiry, cancel and sign-out; orphan sweep on start |
| Leave | `src/lib/leaveForm.ts` | Phone checks obvious mistakes only; server counts days, balance and notice |

## Builds and updates (owner's Expo account: @vyznav/autobacs-team)

| Profile | API | Use |
|---|---|---|
| `production` | `https://api.autobacsindia.com/api/v1` (https only — the build refuses http) | The APK staff install once from WhatsApp. EAS Update channel `production` |
| `preview` | `extra.apiUrl` | Internal test APK, channel `preview` |
| `lan` | office Wi-Fi backend over http | Test APK only, never for staff |

```bash
eas build -p android --profile production         # once; share the APK link on WhatsApp
eas update --channel production -m "what changed"  # every later JS fix — phones pick it up on next launch
```

`runtimeVersion` follows the app version (`1.0.0`). A JS/screen change → `eas
update`. A **native** change (a new Expo module, a permission, app.json plugins)
→ bump `version` in `app.json` and build a new APK; old installs keep getting
updates made for their own version only, so nothing breaks.

Push on Android needs the Firebase (FCM v1) key uploaded once: `eas credentials`
→ Android → Push Notifications, plus `android.googleServicesFile` in app.json.
Until then the app works, it just gets no notifications.

## Checks

```bash
npm run typecheck && npm run lint && npm test && npx expo-doctor
```

Brand assets come from one SVG: `npm run brand` (needs Google Chrome).
