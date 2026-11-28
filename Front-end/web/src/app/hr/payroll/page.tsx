import { fetchMe } from '@/app/team/staffSession';
import PayrollMonth from '@/components/hr/PayrollMonth';

/** fetchMe is React cache()d, so this reuses the layout's session check — no second call. */
export default async function HrPayrollPage() {
  const me = await fetchMe();
  return <PayrollMonth isAdmin={me?.user?.role === 'admin'} />;
}
