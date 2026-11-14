'use client';

import { lazy, Suspense, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { enquiryKeys, errorMessage, getEnquiry } from '../enquiry';

/**
 * The procurement tools' screens, shared by the team panel (/team/...) and the
 * admin area (/admin/...). `area` decides the links; the API decides access.
 */
export type Area = 'team' | 'admin';
const baseOf = (area: Area) => `/${area}/supplier-enquiries`;
const calcOf = (area: Area) => `/${area}/price-calculator`;
const shipOf = (area: Area) => `/${area}/shipping-calculator`;

/** Team panel: only procurement sees these (admins use /admin). The API refuses everyone else anyway. */
function Gate({ area, children }: { area: Area; children: ReactNode }) {
  const { user } = useAuth();
  if (area === 'team' && user && user.staff?.team !== 'procurement') {
    return <p className="text-sm text-gray-600">Supplier enquiries, the price calculator and the shipping fee calculator are for the procurement team.</p>;
  }
  return <>{children}</>;
}

// Each page loads only the tool it shows (measured: every route was carrying all four).
// React.lazy, not next/dynamic: next/dynamic adds a <link rel=preload> without the
// CSP nonce, which the strict policy blocks (console error + CSP report) even though
// the chunk itself still loads. lazy() loads through webpack only.
const Skeleton = ({ h }: { h: string }) => <div className={`${h} animate-pulse rounded-xl bg-gray-100`} aria-busy="true" />;
const EnquiryList = lazy(() => import('../EnquiryList'));
const EnquiryForm = lazy(() => import('../EnquiryForm'));
const EnquiryDetail = lazy(() => import('../EnquiryDetail'));
const PriceCalculator = lazy(() => import('../PriceCalculator'));
const ShippingCalculator = lazy(() => import('../ShippingCalculator'));

const wrap = (area: Area) => (area === 'admin' ? 'space-y-6 p-4 md:p-6' : 'space-y-6');

export function EnquiriesScreen({ area }: { area: Area }) {
  return (
    <Gate area={area}>
      <div className={`${wrap(area)} max-w-5xl`}>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Supplier enquiries</h1>
          <p className="text-sm text-gray-500">Ask several suppliers for price and stock in one go: write the enquiry once, then open WhatsApp for each supplier with the message ready. Record their replies to compare.</p>
        </div>
        {/* Search and tab live in the address (useSearchParams). */}
        <Suspense fallback={<Skeleton h="h-64" />}><EnquiryList base={baseOf(area)} calculatorHref={calcOf(area)} /></Suspense>
      </div>
    </Gate>
  );
}

function NewEnquiryInner({ area }: { area: Area }) {
  const sp = useSearchParams();
  return <EnquiryForm base={baseOf(area)} prefill={{ name: sp.get('name')?.slice(0, 200) || '', target: sp.get('target')?.slice(0, 20) || '' }} />;
}

export function NewEnquiryScreen({ area }: { area: Area }) {
  return (
    <Gate area={area}>
      <div className={wrap(area)}>
        <div>
          <Link href={baseOf(area)} className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"><ArrowLeft className="h-4 w-4" /> All enquiries</Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">New supplier enquiry</h1>
        </div>
        <Suspense fallback={<Skeleton h="h-96" />}><NewEnquiryInner area={area} /></Suspense>
      </div>
    </Gate>
  );
}

export function EnquiryScreen({ area }: { area: Area }) {
  const { id } = useParams<{ id: string }>();
  return <Gate area={area}><div className={wrap(area)}><Suspense fallback={<Skeleton h="h-96" />}><EnquiryDetail id={id} base={baseOf(area)} /></Suspense></div></Gate>;
}

export function EditEnquiryScreen({ area }: { area: Area }) {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: enquiryKeys.detail(id), queryFn: () => getEnquiry(id) });
  const e = q.data?.enquiry;
  return (
    <Gate area={area}>
      <div className={wrap(area)}>
        <div>
          <Link href={`${baseOf(area)}/${id}`} className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"><ArrowLeft className="h-4 w-4" /> Back to the enquiry</Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">Edit {e?.ref ?? 'enquiry'}</h1>
        </div>
        {q.isLoading && <div className="h-64 animate-pulse rounded-xl bg-gray-100" aria-busy="true" />}
        {q.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load this enquiry.')}</p>}
        {e && (e.status === 'closed'
          ? <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">This enquiry is closed — reopen it first to make changes.</p>
          // keyed on updatedAt: a fresh copy from the server starts a fresh form.
          : <Suspense fallback={<Skeleton h="h-96" />}><EnquiryForm key={e.updatedAt} base={baseOf(area)} enquiry={e} /></Suspense>)}
      </div>
    </Gate>
  );
}

/** ?freight=… (rupees) from the shipping calculator; anything not a plain amount is ignored. */
function CalculatorInner({ area }: { area: Area }) {
  const router = useRouter();
  const sp = useSearchParams();
  const freight = sp.get('freight') ?? '';
  return (
    <PriceCalculator useLabel="Start an enquiry with target" initialFreight={/^\d{1,7}(\.\d{1,2})?$/.test(freight) ? freight : ''}
      onUse={(target) => router.push(`${baseOf(area)}/new?target=${encodeURIComponent(target)}`)} />
  );
}

export function CalculatorScreen({ area }: { area: Area }) {
  return (
    <Gate area={area}>
      <div className={`${wrap(area)} max-w-5xl`}>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Price calculator</h1>
          <p className="text-sm text-gray-500">Work out landed cost, selling price, GST, discount and profit — or the most we can pay a supplier for a margin. <Link href={shipOf(area)} className="text-blue-700 hover:underline">Shipping fee calculator →</Link></p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
          <Suspense fallback={<Skeleton h="h-80" />}><CalculatorInner area={area} /></Suspense>
        </div>
      </div>
    </Gate>
  );
}

export function ShippingScreen({ area }: { area: Area }) {
  return (
    <Gate area={area}>
      <div className={`${wrap(area)} max-w-5xl`}>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shipping fee calculator</h1>
          <p className="text-sm text-gray-500">Estimated delivery charge to a customer&apos;s pincode, from our delivery zones (base rate + per kg).</p>
        </div>
        <Suspense fallback={<Skeleton h="h-80" />}><ShippingCalculator freightHref={calcOf(area)} /></Suspense>
      </div>
    </Gate>
  );
}
