import Link from 'next/link';
import { Lock } from 'lucide-react';

/** Shown instead of the panel to a signed-in person who is not HR or admin. */
export default function HrNoAccess() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <Lock className="mx-auto mb-3 h-8 w-8 text-gray-400" aria-hidden="true" />
        <h1 className="text-xl font-bold text-gray-900">The HR panel is for the HR team</h1>
        <p className="mt-2 text-sm text-gray-600">
          Your attendance, leave and payslips are in the Autobacs Team app. If you work in HR and see this, ask an admin to add you to the HR team.
        </p>
        <Link href="/team" className="mt-5 inline-block rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
          Go to the team panel
        </Link>
      </div>
    </main>
  );
}
