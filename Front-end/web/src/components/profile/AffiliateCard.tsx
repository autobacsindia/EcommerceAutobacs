'use client';

import Link from 'next/link';
import { Handshake, ChevronRight, MailWarning } from 'lucide-react';
import { useMyAffiliate } from '@/hooks/queries/useAffiliate';

/**
 * The affiliate's way back into their own dashboard.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * /account/affiliate shipped with NOTHING in the app linking to it — not the nav, not
 * the footer, not this page. The single door was one line in the approval email, so an
 * affiliate who lost that mail could never reach their earnings again.
 *
 * It lives on /profile rather than in the nav because affiliate-ness is DATA, not a
 * role (there is no `affiliate` value in User.role — see ADR-006 in models/Affiliate.js),
 * so knowing whether to show a link costs a request. /profile is already authenticated
 * and already fetching, and the response is cached under `affiliateKeys.me()` — the
 * exact key the dashboard reads — so following the link costs no second round trip.
 *
 * Renders for every one of the four states, including "you are not one". For most
 * customers that is the only version they will ever see, so it is an invitation at the
 * bottom of the page, not a prompt.
 */
export default function AffiliateCard() {
  const { data } = useMyAffiliate();

  // First load: render nothing rather than a skeleton. This card is supplementary and
  // a placeholder that resolves to "become an affiliate" reads as a broken promise.
  // On revisits the cached answer renders immediately. Matches RecentOrdersCard.
  if (data === undefined) return null;

  const affiliate = data.affiliate;

  const shell = 'bg-obsidian border border-hairline rounded-lg p-6 mb-6';
  const heading = 'text-xs font-display font-bold text-ink-muted uppercase tracking-widest';

  /*
    ── Applied, but we cannot prove this inbox is theirs ────────────────────────
    They applied from the public form while signed out, so the application was never
    linked to an account. It may already be APPROVED and earning. We will not open the
    ledger on an unverified address — that would hand an affiliate's earnings to whoever
    registered the email first, since signing in proves nothing here.

    This must come BEFORE the "not an affiliate" branch, which would otherwise tell them
    something flatly untrue and send them to re-apply, where the duplicate guard refuses
    them with no explanation. Verifying links it automatically.

    No code, no rates, no earnings — the server sends a boolean and nothing else.
  */
  if (!affiliate && data.needsEmailVerification) {
    return (
      <div className={shell}>
        <div className="flex items-start gap-3">
          <MailWarning className="h-4 w-4 text-gold mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <h2 className={heading}>Affiliate Dashboard</h2>
            <p className="mt-2 text-sm text-ink-muted font-display">
              We found an affiliate application under this email.{' '}
              <strong className="text-ink">Verify your email address</strong> and your
              dashboard, earnings and referred orders will unlock automatically.
            </p>
            <p className="mt-2 text-xs text-ink-muted font-display">
              Use the <strong className="text-ink">Resend Verification Email</strong>{' '}
              button above if you no longer have the link.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Not an affiliate: the ordinary case for almost everyone ──────────────────
  if (!affiliate) {
    return (
      <div className={shell}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Handshake className="h-4 w-4 text-gold" aria-hidden />
              <h2 className={heading}>Affiliate Programme</h2>
            </div>
            <p className="mt-2 text-sm text-ink-muted font-display">
              Earn commission on every order you send our way.
            </p>
          </div>
          <Link
            href="/affiliates"
            className="shrink-0 inline-flex items-center gap-1 text-xs font-display font-bold uppercase tracking-widest text-gold hover:text-gold/80 transition"
          >
            Learn more <ChevronRight className="h-3 w-3" aria-hidden />
          </Link>
        </div>
      </div>
    );
  }

  /*
    Applied but not approved. No link to the dashboard: it would show the same sentence
    behind an extra click. `rejected` reads the same way on purpose — a decline is
    final and re-applying creates a new record, so there is nothing to send them to.
  */
  if (affiliate.status === 'pending' || affiliate.status === 'rejected') {
    return (
      <div className={shell}>
        <div className="flex items-center gap-2">
          <Handshake className="h-4 w-4 text-gold" aria-hidden />
          <h2 className={heading}>Affiliate Programme</h2>
        </div>
        <p className="mt-2 text-sm text-ink-muted font-display">
          {affiliate.status === 'pending'
            ? 'Your application is under review. We will email you once a decision is made.'
            : 'Your application was not accepted this time.'}
        </p>
      </div>
    );
  }

  // ── active / suspended: both get the link, because both have a ledger ────────
  const suspended = affiliate.status === 'suspended';

  return (
    <div className={shell}>
      <Link
        href="/account/affiliate"
        className="flex flex-wrap items-center justify-between gap-4 -m-2 p-2 rounded hover:bg-obsidian-raised/40 transition"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Handshake className="h-4 w-4 text-gold" aria-hidden />
            <h2 className={heading}>Affiliate Dashboard</h2>
          </div>
          <p className="mt-2 text-sm text-ink-muted font-display">
            {suspended ? (
              // Say it plainly here. The dashboard repeats it with the support link;
              // discovering a pause only after clicking through is worse.
              'Your affiliate account is paused. Your earnings so far are still listed.'
            ) : (
              <>
                Your link, your earnings and every order you referred.
                {affiliate.code && (
                  <>
                    {' '}Code <span className="font-mono text-ink">{affiliate.code}</span>.
                  </>
                )}
              </>
            )}
          </p>
        </div>
        <span className="shrink-0 inline-flex items-center gap-1 text-xs font-display font-bold uppercase tracking-widest text-gold">
          Open <ChevronRight className="h-3 w-3" aria-hidden />
        </span>
      </Link>
    </div>
  );
}
