import { tokenManager } from '@/lib/http/tokenManager';

/**
 * Multipart POST for the staff panel (the JSON client can't send files), with the same
 * CSRF header the JSON client sends. The browser sets the multipart boundary.
 * Throws an Error carrying the server's message, like the JSON client.
 */
export async function postForm<T>(endpoint: string, form: FormData, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
  await tokenManager.ensureCsrfToken();
  const headers = tokenManager.getHeaders() as Record<string, string>;
  delete headers['Content-Type'];
  const res = await fetch(`/api/v1${endpoint}`, { method, body: form, headers, credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.message || 'Upload failed'), { rawData: body });
  return body as T;
}
