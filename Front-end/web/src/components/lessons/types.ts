/** The Lesson Library, as the API sends it (routes/staffLessons.js). */
export type LessonFileKind = 'video' | 'pdf' | 'slides' | 'document' | 'image';

export interface LessonFile {
  name: string;
  kind: LessonFileKind;
  size: number;
  mime: string;
  fileName: string;
  byName: string;
  at: string | null;
}

export interface Lesson {
  id: string;
  title: string;
  topic: string;
  audience: string;
  audienceLabel: string;
  owner: { id: string; name: string };
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string;
  lastCheckedByName: string;
  stale: boolean;
  rev: number;
  fileKinds: LessonFileKind[];
  fileCount: number;
  doneAt: string | null;
  can: { edit: boolean; manage: boolean };
  body?: string;
  files?: LessonFile[];
}

export interface LessonPage { lessons: Lesson[]; nextCursor: string | null }
export interface LessonOption { key: string; label: string }
export interface LessonPerson { id: string; name: string; team: string | null; isAdmin: boolean }
export interface LessonMeta { sections: LessonOption[]; postTo: LessonOption[]; people: LessonPerson[]; staleDays: number }
export interface LessonProgressPerson { id: string; name: string; teamLabel: string; doneAt: string | null }
export interface LessonDraft { title: string; body: string; topic: string; audience: string; ownerId: string }

export const KIND_LABEL: Record<LessonFileKind, string> = {
  video: 'Video', pdf: 'PDF', slides: 'PowerPoint', document: 'Document', image: 'Photo',
};

/** Limits mirrored from services/staffLessonService.js; the server decides. */
const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
const TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
export const LESSON_FILE_ACCEPT = Object.keys(TYPES).map((e) => `.${e}`).join(',');

/** The type to upload as, from the extension: Windows often labels a PowerPoint with nothing useful. */
export const lessonFileType = (name: string) => TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? '';

/** Why this file can't be added, or null when it can. */
export function lessonFileProblem(file: File): string | null {
  const type = lessonFileType(file.name);
  if (!type) return `"${file.name}" can't be added. Use a video (MP4, MOV, WebM), PDF, PowerPoint, Word, Excel or photo.`;
  const video = type.startsWith('video/');
  if (file.size > (video ? 2 * GB : 100 * MB)) return `"${file.name}" is over the ${video ? '2 GB' : '100 MB'} limit.`;
  return null;
}

export function formatSize(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
