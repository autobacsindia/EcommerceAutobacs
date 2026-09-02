/**
 * Direct browser → storage upload for return-request evidence (unboxing video,
 * proof of purchase, extra photos). The file never passes through our server:
 * the backend issues short-lived credentials scoped to a private per-request
 * folder, the browser uploads straight to storage, and only a `{ publicId,
 * provider }` ref goes back to our API — which re-validates it server-side.
 *
 * Two storage backends are live during the Cloudinary → R2 migration and the
 * credential response is a DISCRIMINATED UNION on `provider`:
 *   - cloudinary — ONE signature per folder, reusable for every file, POSTed as
 *     multipart with `authenticated` (private) delivery;
 *   - r2         — ONE presigned PUT per object key, into the PRIVATE bucket.
 * Both origins must be in the page CSP connect-src (see lib/csp.ts).
 *
 * ── Why the R2 path asks for credentials per file ───────────────────────────
 * This form uploads each file the moment it is chosen, so the set is not known
 * up front — and an R2 presigned PUT is bound to one object key, which means it
 * cannot be minted before the file exists. The alternative, letting the client
 * name the folder so a batch could share one, would hand the client the single
 * decision this design keeps on the server. Nothing about returns evidence
 * depends on the files sharing a folder, so a request per file is the cheaper
 * trade.
 *
 * Nothing the browser reports about a file is trusted: the backend re-reads
 * every ref from the store it names and re-derives size and format there — by
 * magic number on the R2 path, since R2 does not decode uploads and does not
 * even enforce the Content-Type its own presigned URL was signed with.
 */

import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

export interface ReturnUploadSig {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  type: string;
  signature: string;
}

export interface R2UploadTarget {
  slot: string;
  uploadUrl: string;
  key: string;
  contentType: string;
}

export type ReturnCredentials =
  | ({ provider?: 'cloudinary' } & ReturnUploadSig)
  | { provider: 'r2'; folder: string; uploads: R2UploadTarget[] };

export type ReturnResourceType = 'video' | 'image' | 'raw';

/** What the API stores: the id, and which store holds it. */
export interface ReturnUploadRef {
  publicId: string;
  provider: 'cloudinary' | 'r2';
  url: string;
  resourceType: ReturnResourceType;
}

/**
 * Ask for upload credentials.
 *
 * `slot` is required on the R2 path so the server can mint a key bound to it:
 * that key is what proves at submit time which field the file was uploaded for,
 * which is how evidence cannot be shuffled between slots to dodge a size cap.
 * Photo slots are indexed (`photo0`…`photo4`).
 */
export async function getReturnUploadSignature(
  slot?: string,
  contentType?: string,
): Promise<ReturnCredentials> {
  const body = slot ? { files: [{ slot, contentType: contentType || 'application/octet-stream' }] } : {};
  return (await apiClient.post(API_ENDPOINTS.RETURN_UPLOAD_SIGNATURE, body)) as ReturnCredentials;
}

/** One presigned PUT. XHR rather than fetch() purely for upload progress. */
function putToR2(
  file: File, target: R2UploadTarget, onProgress?: (pct: number) => void,
): Promise<ReturnUploadRef> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', target.uploadUrl, true);
    // Must match what the URL was signed with or the signature check fails. This
    // is NOT a content control — see the module header.
    xhr.setRequestHeader('Content-Type', target.contentType);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // The key was decided by the server when it signed the URL; we echo it
        // back rather than deriving anything client-side. No `url`: a private
        // object has no permanent address, and the UI previews from the local
        // File, not from storage.
        resolve({
          publicId: target.key,
          provider: 'r2',
          url: '',
          resourceType: resourceTypeOf(target.contentType),
        });
      } else {
        reject(new Error(`Upload failed: HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.send(file);
  });
}

/** The legacy Cloudinary resource kind for a MIME type. */
function resourceTypeOf(contentType: string): ReturnResourceType {
  const t = (contentType || '').toLowerCase();
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('image/')) return 'image';
  return 'raw';
}

function postToCloudinary(
  file: File, sig: ReturnUploadSig, resourceType: ReturnResourceType,
  onProgress?: (pct: number) => void,
): Promise<ReturnUploadRef> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('api_key', sig.apiKey);
    fd.append('timestamp', String(sig.timestamp));
    fd.append('folder', sig.folder);
    fd.append('type', sig.type);
    fd.append('signature', sig.signature);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${sig.cloudName}/${resourceType}/upload`, true);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 201) {
        let resp: { public_id?: string; secure_url?: string };
        try { resp = JSON.parse(xhr.responseText); } catch { reject(new Error('Bad upload response.')); return; }
        if (!resp.public_id) { reject(new Error('Upload did not return a file id.')); return; }
        resolve({
          publicId: resp.public_id, provider: 'cloudinary', url: resp.secure_url || '', resourceType,
        });
      } else {
        reject(new Error(`Upload failed: HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.send(fd);
  });
}

/**
 * Upload one file, whichever store the backend is currently writing to.
 *
 * @param slot  the server-side slot name ('video' | 'proof' | 'photo0'…'photo4')
 */
export async function uploadReturnFile(
  file: File,
  creds: ReturnCredentials,
  resourceType: ReturnResourceType,
  onProgress?: (pct: number) => void,
  slot?: string,
): Promise<ReturnUploadRef> {
  if (creds.provider === 'r2') {
    // Matched by SLOT rather than position: the server returns targets keyed by
    // slot, and relying on order would break the moment either side reorders.
    const target = creds.uploads.find((t) => t.slot === slot) || creds.uploads[0];
    if (!target) throw new Error('Upload could not be prepared. Please try again.');
    return putToR2(file, target, onProgress);
  }
  return postToCloudinary(file, creds as ReturnUploadSig, resourceType, onProgress);
}
