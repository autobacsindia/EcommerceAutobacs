# How to release (2 PM and 10 PM)

The live website now changes **twice a day**, not every time something is merged.

## The idea in one picture

```
Claude sessions ──"merge it"──▶  develop  (test site only, customers see nothing)
                                     │
             1:30 PM / 9:30 PM IST   ▼  a "Release" PR appears automatically
                                     │
             you click Merge at 2 / 10 PM
                                     ▼
                                   main  ──▶  live site (Railway + Vercel), ~5 min
```

Example: during the morning you say "merge it" on three PRs (a checkout fix, a new coupon, a panel tweak).
They go into `develop`. Nothing changes for customers. At 1:30 PM a PR called
**"Release — 28 Nov, 2 PM IST (3 change(s))"** appears listing those three. At 2 PM you merge it once → one deploy.

## Your steps at each slot (2 minutes)

1. Open GitHub → **Pull requests** → the one titled **Release — …**.
2. Read the list under "What goes live". Anything you don't want today? Tell a Claude session to revert it from `develop` first.
3. Wait until the checks at the bottom are all **green** ✓.
4. Click the arrow next to the green button → choose **Create a merge commit** → **Merge**.
   (Not "Squash" — squash makes the two branches drift apart.)
5. Wait ~5 minutes, open the website, click around: home → a product → cart.

No Release PR at 1:30? Then nothing was waiting — there's nothing to do.
Need one right now? GitHub → **Actions** → **Release slots** → **Run workflow**.

## Urgent fix (can't wait for the slot)

Tell the Claude session: *"hotfix — PR straight to main"*. You say "merge it" as before; it goes live in ~5 min.
It is copied back into `develop` automatically.

## Something broke after a release — roll back (1 click each)

Roll back **both** if unsure. Each takes about a minute. Database changes are **not** undone by a rollback.

**Backend (Railway)**
1. railway.com → project **Autobacs India** → environment **production** → the backend service.
2. Tab **Deployments**. The top one is the new release.
3. On the one **below** it (the previous good one) click **⋯** → **Rollback**. Confirm.

**Website (Vercel)**
1. vercel.com → the storefront project → **Deployments**.
2. Find the previous one marked **Production** (just below "Current").
3. Click **⋯** → **Instant Rollback**. Confirm.
4. ⚠ After an Instant Rollback, Vercel **stops putting new releases live** until you undo it.
   Once the fix is released: open the project's top page and click **Undo Rollback**
   (or on the new deployment: **⋯ → Promote to Production**).

Then tell a Claude session what broke, so it's fixed on `develop` for the next slot.

## One-time setup (owner, once)

1. GitHub → repository **Settings** → **Actions** → **General** → scroll to **Workflow permissions** →
   tick **Allow GitHub Actions to create and approve pull requests** → **Save**.
   (Without this tick the Release PR can't be opened.)
2. Merge the PR that adds this guide. From then on Claude sessions open their PRs into `develop`.

## Why this helps

- **Fewer risky moments:** ~2 deploys a day instead of ~10. If something breaks, you know which release did it.
- **A rehearsal first:** everything in `develop` runs on the test site before customers see it.
- **Same safety checks:** the Release PR needs the same green checks as every other PR.
