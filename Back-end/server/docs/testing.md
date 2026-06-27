# Backend Testing Notes

Gotchas specific to this stack: Jest 30 + native ESM (`--experimental-vm-modules`) + `resetMocks: true`.

---

## 1. Mock setup goes inside the test body, not `beforeEach`

**Problem:** `jest.config.js` has `resetMocks: true`, which calls `jest.resetAllMocks()` _before_ `beforeEach` callbacks run (not after, as you might expect). Anything you set up in `beforeEach` is wiped before the test body runs.

**Rule:** Set mock return values and implementations at the top of the test body.

```js
it('does something', async () => {
  // Do this — runs after the reset
  mockSomething.mockResolvedValue({ ok: true });

  // NOT this — beforeEach is cleared by resetMocks before the test runs
});
```

This affects every test that uses `jest.fn()` mocks and relies on `mockResolvedValue` / `mockReturnValue` / `mockImplementation`.

---

## 2. Never `.send(Buffer)` with `Content-Type: application/json`

**Problem:** superagent (which supertest wraps) calls `JSON.stringify` on the value passed to `.send()` when `Content-Type` is `application/json`. If you pass a `Buffer`, it gets serialized as `{"type":"Buffer","data":[...]}` instead of the raw bytes. For any test that verifies an HMAC or raw body (e.g. the Razorpay webhook), this corrupts the payload silently and the signature check always fails.

**Rule:** Pass a JSON string to `.send()`, not a `Buffer`.

```js
// Wrong — corrupts the body
const body = Buffer.from(JSON.stringify(payload));
await request(app).post('/webhook').send(body);

// Correct — sends the exact bytes
const body = JSON.stringify(payload);
await request(app).post('/webhook').send(body);
```

---

## 3. `setup.js` errors appear on the wrong test — check the stack before debugging the assertion

**Problem:** `tests/setup.js` runs `afterEach` hooks that apply to every test file. If `setup.js` throws (e.g. a missing import, a broken DB teardown), Jest attributes the failure to whichever test was running at the time — not to `setup.js`. The error message will point at a line in `setup.js`, but the failing test name in the output will be something completely unrelated.

**Symptom:** A test fails but the error trace ends with `at Object.<anonymous> (tests/setup.js:NN)`.

**Fix:** When you see a stack trace rooted in `setup.js`, look at `setup.js` first, not the test. Common causes:
- Using `jest` as a global without `import { jest } from '@jest/globals'` (ESM requires explicit import)
- MongoDB teardown throwing because the connection was never opened (e.g. in a unit test that skips `beforeAll`)

---

## Running a single test file

```bash
npm test -- tests/middleware/razorpayWebhook.test.js --no-coverage
```

The `--` passes flags through npm to Jest. `--no-coverage` skips the coverage pass and makes runs ~3x faster during development.
<!-- ... -->