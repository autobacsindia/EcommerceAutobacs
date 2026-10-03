'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Users, LogOut } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

const NAV = [
  { href: '/team', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/team/members', label: 'My team', icon: Users },
];

/** Staff panel shell: sidebar on desktop, top bar on phones. */
export default function TeamLayoutClient({
  userName,
  teamLabel,
  isHead,
  children,
}: {
  userName: string;
  teamLabel: string;
  isHead: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuth();

  const signOut = async () => {
    await logout();
    router.push('/login');
  };

  const links = NAV.map(({ href, label, icon: Icon }) => {
    const active = pathname === href;
    return (
      <Link
        key={href}
        href={href}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" /> {label}
      </Link>
    );
  });

  return (
    <div className="admin-panel min-h-screen bg-gray-50 md:flex">
      <aside className="bg-gray-900 text-white md:fixed md:inset-y-0 md:flex md:w-60 md:flex-col">
        <div className="flex items-center justify-between border-b border-gray-800 p-4 md:block">
          <div>
            <p className="text-lg font-bold">{teamLabel} Team</p>
            <p className="text-xs text-gray-400">{isHead ? 'Team head' : 'Team member'}</p>
          </div>
          <button onClick={signOut} className="rounded-lg bg-red-600 p-2 text-sm md:hidden" aria-label="Log out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        <nav className="flex gap-2 overflow-x-auto p-3 md:flex-1 md:flex-col">{links}</nav>
        <div className="hidden border-t border-gray-800 p-4 md:block">
          <p className="text-xs text-gray-400">Logged in as</p>
          <p className="truncate text-sm font-medium">{userName}</p>
          <button
            onClick={signOut}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 p-2 text-sm hover:bg-red-700"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:ml-60 md:p-8">{children}</main>
    </div>
  );
}
