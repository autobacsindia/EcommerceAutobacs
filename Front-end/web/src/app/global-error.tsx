'use client';

/**
 * Last-resort error page for anything that escapes app/error.tsx — i.e. a crash
 * in the ROOT layout or its providers, which app/error.tsx cannot catch because
 * it renders inside that layout.
 *
 * Without this file Next shows its bare "Application error: a client-side
 * exception has occurred" text on a blank screen, with no way forward. That is
 * exactly what job applicants saw in the 2026-11 careers outage. Here we:
 *   - reload once, automatically, when the cause is a failed script download
 *     (the usual one on phones: flaky data, a blocker, a tab that outlived a
 *     deploy) — a fresh load almost always fixes it;
 *   - otherwise show a plain message with a Reload button and a way home.
 *
 * It replaces the root layout, so it must render its own <html>/<body> and
 * cannot rely on globals.css — styles are inline.
 */

import { useEffect, useState } from 'react';
import { isChunkLoadError, reloadPage, shouldAutoReload } from '@/lib/chunkErrorRecovery';
import { reportClientError } from '@/lib/reportClientError';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    console.error('[global-error]', error);
    const chunk = isChunkLoadError(error);
    // Sent before any reload: keepalive lets the report outlive the page.
    reportClientError({ feature: 'page-crash', step: chunk ? 'root-chunk-load' : 'root-crash', error, context: { digest: error.digest, chunkLoad: chunk } });
    if (chunk && shouldAutoReload()) {
      setReloading(true);
      reloadPage();
    }
  }, [error]);

  const retry = () => {
    // reset() re-renders the tree; a reload also refetches any missing script.
    try { reset(); } catch { /* fall through to a full reload */ }
    reloadPage();
  };

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', background: '#f7f9f8', color: '#0f1111' }}>
        <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', boxSizing: 'border-box' }}>
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <h1 style={{ fontSize: 22, margin: '0 0 12px' }}>
              {reloading ? 'Reloading…' : 'Something went wrong loading this page'}
            </h1>
            {!reloading && (
              <>
                <p style={{ fontSize: 15, lineHeight: 1.6, color: '#5f6363', margin: '0 0 24px' }}>
                  This is usually a brief connection problem. Please try again.
                </p>
                <button
                  type="button"
                  onClick={retry}
                  style={{ background: '#0a5c33', color: '#fff', border: 0, borderRadius: 10, padding: '12px 24px', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
                >
                  Reload page
                </button>
                <p style={{ marginTop: 16 }}>
                  {/* A plain <a>, not <Link>: the client router is what just crashed, so leave with a full page load. */}
                  {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                  <a href="/" style={{ color: '#0a5c33', fontSize: 14 }}>Go to the home page</a>
                </p>
              </>
            )}
          </div>
        </main>
      </body>
    </html>
  );
}
