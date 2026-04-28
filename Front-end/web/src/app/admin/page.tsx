import { redirect } from 'next/navigation';

// Redirect /admin to /admin/dashboard
export default function AdminRootPage() {
  redirect('/admin/dashboard');
}
