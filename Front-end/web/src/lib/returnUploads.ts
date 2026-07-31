/**
 * Direct browser → Cloudinary upload for return-request evidence (unboxing video
 * + proof of purchase). The backend signs a short-lived params set scoped to a
 * private (authenticated) per-request folder; we POST the file straight to
 * Cloudinary and hand the resulting { publicId } back to our API, which
 * re-validates it server-side. The raw file never passes through our server.
 *
 * Requires api.cloudinary.com in the frontend CSP connect-src (already allowed
 * for the careers flow).
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

export type ReturnResourceType = 'video' | 'image' | 'raw';

/** Fetch a signed params set for this submission's uploads (one per submission). */
export async function getReturnUploadSignature(): Promise<ReturnUploadSig> {
  const res = (await apiClient.post(API_ENDPOINTS.RETURN_UPLOAD_SIGNATURE, {})) as {
    success: boolean;
  } & ReturnUploadSig;
  return res;
}

/**
 * Upload one file to Cloudinary with the signed params. `resourceType` picks the
 * Cloudinary endpoint: 'video' for the unboxing video, 'image' for photo proof,
 * 'raw' for a PDF invoice. Resolves to the server-trusted publicId (+ url for a
 * local preview). `onProgress` reports 0–100.
 */
export function uploadReturnFile(
  file: File,
  sig: ReturnUploadSig,
  resourceType: ReturnResourceType,
  onProgress?: (pct: number) => void,
): Promise<{ publicId: string; url: string; resourceType: ReturnResourceType }> {
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
        resolve({ publicId: resp.public_id, url: resp.secure_url || '', resourceType });
      } else {
        reject(new Error(`Upload failed: HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.send(fd);
  });
}
