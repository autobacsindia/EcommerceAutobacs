import Link from 'next/link';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { TEAM_HELP } from '@/lib/help/teamFaq';

/**
 * /team/help — how to use the panel, for every team.
 *
 * Static content from lib/help/teamFaq.ts. A server component inside the team
 * layout, which has already checked the session (app/team/layout.tsx) and marks
 * the whole panel noindex; /team is also disallowed in robots.ts and is never
 * in the sitemap. Questions are plain <details>, so they open with no script.
 */
export default function TeamHelpPage() {
  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Help</h1>
        <p className="text-sm text-gray-500">How to use the panel. Tap a question to see the answer; the buttons take you to the right page.</p>
      </div>

      <nav aria-label="Help sections" className="flex flex-wrap gap-2">
        {TEAM_HELP.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 transition-colors hover:border-blue-600 hover:text-blue-700">
            {s.title}
          </a>
        ))}
      </nav>

      {TEAM_HELP.map((s) => (
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-24">
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <h2 id={`${s.id}-title`} className="text-lg font-semibold text-gray-900">{s.title}</h2>
            <span className="text-xs font-medium text-gray-500">For: {s.forWho}</span>
          </div>
          <div className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
            {s.items.map((item) => (
              <details key={item.question} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-semibold text-gray-900 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <ChevronDown className="h-4 w-4 shrink-0 text-gray-500 transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="px-4 pb-4 text-sm text-gray-700">
                  {Array.isArray(item.answer) ? (
                    <ul className="list-disc space-y-1 pl-5">
                      {item.answer.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                  ) : (
                    <p>{item.answer}</p>
                  )}
                  {!!item.links?.length && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.links.map((l) => (
                        <Link key={l.href} href={l.href} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-100">
                          {l.label} <ArrowRight className="h-3 w-3" aria-hidden="true" />
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}

      <p className="text-sm text-gray-500">
        Still stuck? Ask in <Link href="/team/chat" className="font-medium text-blue-700 hover:underline">Team chat</Link> — your team head or the admin will help.
      </p>
    </div>
  );
}
