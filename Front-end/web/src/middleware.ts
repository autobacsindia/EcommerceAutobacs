import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  // Remove Origin so the backend treats this as a server-to-server request,
  // bypassing CORS origin checks that require FRONTEND_URL to be configured.
  headers.delete('origin');
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: '/api/v1/:path*'
};
