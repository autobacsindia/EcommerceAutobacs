/**
 * Admin Layout - Server Component
 * 
 * This layout runs on the SERVER before any HTML is sent to the client.
 * It verifies admin role via BACKEND API (signature verified).
 * 
 * Protection Layers:
 * 1. Middleware (middleware.ts) - Fast pre-filter, UX optimization
 * 2. Server Component (this file) - REAL verification via backend ✅
 * 3. Backend API - Final enforcement (RBAC)
 * 4. Client redirect - UX fallback (redundant)
 * 
 * SECURITY: This component calls backend /auth/me to verify:
 * - JWT signature (backend verifies with JWT_SECRET)
 * - Token expiration (backend checks exp)
 * - User role (backend checks database)
 * - Token not revoked (backend checks Redis)
 * 
 * This prevents forged tokens from rendering admin HTML.
 */

import { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import AdminLayoutClient from './AdminLayoutClient';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Get all cookies to forward to backend
  const cookieStore = await cookies();
  const allCookies = cookieStore.toString();
  
  // Verify admin role via backend (signature verified, role from database)
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  
  try {
    const response = await fetch(`${apiUrl}/api/v1/auth/me`, {
      method: 'GET',
      headers: {
        'Cookie': allCookies,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',  // Never cache auth checks
    });
    
    // Token invalid/expired/revoked → redirect to login
    if (!response.ok) {
      console.log(`[Admin Layout] Auth check failed: ${response.status}`);
      redirect('/login?redirect=/admin');
    }
    
    const userData = await response.json();
    
    // Verify admin role (from trusted backend source)
    if (!userData.success || userData.user?.role !== 'admin') {
      console.warn(
        `[Admin Layout] Non-admin access attempt | User: ${userData.user?.id || 'unknown'}`
      );
      redirect('/');
    }
    
    // Admin verified by backend → render admin layout
    return <AdminLayoutClient userId={userData.user.id}>{children}</AdminLayoutClient>;
    
  } catch (error) {
    // Backend unreachable or error → deny access (fail closed)
    console.error(
      `[Admin Layout] Backend auth check failed | Error: ${error instanceof Error ? error.message : 'Unknown'}`
    );
    redirect('/login?redirect=/admin');
  }
}