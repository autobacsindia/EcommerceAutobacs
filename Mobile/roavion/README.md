# Roavion — customer mobile app

React Native + TypeScript + Expo. Android first, iOS from the same code later.

**It is a client of the existing API and nothing else.** It calls the same
`/api/v1` backend as the website, so prices, stock, carts and orders are shared.
Nothing in `Front-end/web` or `Back-end/server` was changed to make it work.

## Run it on your phone

1. Install **Expo Go** from the Play Store (a free app, no developer account).
2. On this Mac:
   ```bash
   cd Mobile/roavion
   npm install        # first time only
   npm start
   ```
3. Scan the QR code with Expo Go. The Mac and the phone must be on the same WiFi.

Saving a file reloads the app on the phone within a second or two.

## What is in it

| Area | Screens |
|---|---|
| Home | offers, categories, popular, new arrivals, brands |
| Shop | departments, brands, search with suggestions, sorting |
| Garage | save a car, then shop only parts that fit |
| Cart | server-side cart shared with the website |
| Checkout | address, server-priced summary, Razorpay payment |
| Account | orders, support, policies, sign out, delete account |

## How money is handled

The app **never** calculates or sends a price. It sends product ids and
quantities; the server prices the order, creates the Razorpay order and verifies
the payment signature. Fulfilment is still driven by Razorpay's webhook, exactly
as on the website. A tampered app can change what it asks for, never what it pays.

Payment runs in a WebView loading Razorpay's own checkout. That works in Expo Go,
which is what makes testing possible without a native build. Swapping in the
native Razorpay SDK later needs no backend change.

## How it authenticates

- Login sets httpOnly cookies, which React Native's native networking layer
  persists per install — so the app never handles a token.
- Writes need a CSRF token. A browser reads it from a cookie; the app cannot, so
  it asks `/csrf-token`, which returns the same value the server set. One stale
  token triggers exactly one automatic retry.
- A guest cart is identified by the `x-session-id` header, one id per install,
  regenerated on sign-out so the next person starts empty.

## Layout

```
app/                 screens (expo-router: the file path IS the route)
  (tabs)/            Home, Shop, Garage, Cart, Account
  product/[slug]     product detail
  category/[slug]    one department
  search, login, register, checkout, orders
src/
  theme.ts           colours, fonts, spacing — the SAME values as the website
  api/               client (auth, CSRF, session) + catalogue, cart, account
  components/        shared UI and the product card
  store.tsx          signed-in customer, cart, saved vehicle
```

## Before the Play Store

- A Google Play developer account ($25). A company account also needs a D-U-N-S
  number, which is free but takes 1–2 weeks.
- Replace `assets/icon.png` and the adaptive icon with the real Roavion logo.
- Push notifications for order updates (not built yet).
- Apple requires in-app account deletion; the Account screen already has it.
