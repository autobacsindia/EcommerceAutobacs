/**
 * The Lesson Library: what heads and admins post so anyone can learn the work.
 *
 * Who may do what:
 *   see      admin: everything. Staff: 'company' lessons and their own team's.
 *   post     admin: anywhere. A head: their own team or 'company'.
 *   manage   (move, change owner, archive) admin; the head of the lesson's team;
 *            for a 'company' lesson, the head who posted it.
 *   edit     (text, files, "checked") anyone who manages it, or its named owner.
 *
 * A lesson someone may not see answers 404, not 403, so its existence does not leak.
 *
 * Files go browser → private bucket by presigned PUT (services/storage/
 * privateDirectUpload.js), because a training video is far too big to hold in the
 * API's memory. Size and format are re-derived from the store when the file is
 * attached: R2 enforces neither.
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import staffLessonRepository from '../repositories/staffLessonRepository.js';
import userRepository from '../repositories/userRepository.js';
import { LESSON_AUDIENCES } from '../models/StaffLesson.js';
import { STAFF_TEAM_LABELS } from '../config/staff.js';
import { storageProvider } from '../config/storage.js';
import { cleanRichText, richTextLength, RICH_TEXT_MARKUP_FACTOR } from '../utils/richText.js';
import { buildTargets, slotFromKey } from './storage/privateDirectUpload.js';
import { detectKind, KIND, SNIFF_BYTES } from './storage/contentSniff.js';
import { headObject, getObjectHead } from './storage/r2Provider.js';
import { r2PrivateUrl } from './storage/privateAssetUrl.js';
import { deletePrivateAsset } from './storage/privateUploads.js';
import { safeName } from './chatAttachmentService.js';

export const LESSON_PREFIX = 'autobacs/lessons';
export const LESSON_STALE_DAYS = 90;
export const LESSON_FILES_MAX = 30;
export const LESSON_VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const LESSON_FILE_MAX_BYTES = 100 * 1024 * 1024;
const BODY_MAX = 50000;
const TITLE_MAX = 140;
const TOPIC_MAX = 60;
const PAGE_SIZE = 24;
const SLOT = 'file';
// A presigned URL is a bearer credential: short by default. A video gets longer
// because the player keeps asking for ranges while someone watches.
const VIDEO_URL_TTL_SECONDS = 2 * 60 * 60;

const PK_ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0];
const startsWith = (buf, bytes) => buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);
const isKind = (kind) => (buf) => detectKind(buf) === kind;
const isZip = (buf) => startsWith(buf, PK_ZIP);
const isOle = (buf) => startsWith(buf, OLE);

/**
 * Everything a lesson may hold, by MIME type. `ext` shapes the key and is the only
 * thing read back from it; `inline` is what a browser may show rather than save.
 */
const FILE_TYPES = Object.freeze({
  'video/mp4': { ext: 'mp4', kind: 'video', inline: true, real: isKind(KIND.VIDEO) },
  'video/webm': { ext: 'webm', kind: 'video', inline: true, real: isKind(KIND.VIDEO) },
  'video/quicktime': { ext: 'mov', kind: 'video', inline: true, real: isKind(KIND.VIDEO) },
  'video/x-m4v': { ext: 'm4v', kind: 'video', inline: true, real: isKind(KIND.VIDEO) },
  'application/pdf': { ext: 'pdf', kind: 'pdf', inline: true, real: isKind(KIND.PDF) },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { ext: 'pptx', kind: 'slides', real: isZip },
  'application/vnd.ms-powerpoint': { ext: 'ppt', kind: 'slides', real: isOle },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', kind: 'document', real: isZip },
  'application/msword': { ext: 'doc', kind: 'document', real: isOle },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: 'xlsx', kind: 'document', real: isZip },
  'image/jpeg': { ext: 'jpg', kind: 'image', inline: true, real: isKind(KIND.IMAGE) },
  'image/png': { ext: 'png', kind: 'image', inline: true, real: isKind(KIND.IMAGE) },
  'image/webp': { ext: 'webp', kind: 'image', inline: true, real: isKind(KIND.IMAGE) },
});
const BY_EXT = new Map(Object.entries(FILE_TYPES).map(([mime, t]) => [t.ext, { ...t, mime }]));
const maxBytesFor = (type) => (type.kind === 'video' ? LESSON_VIDEO_MAX_BYTES : LESSON_FILE_MAX_BYTES);
const capLabel = (type) => (type.kind === 'video' ? '2 GB' : '100 MB');

const fail = (message, status) => new AppError(message, status, { expose: true });
const same = (a, b) => !!a && !!b && String(a) === String(b);
const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const isHead = (u) => isActiveStaff(u) && u.staff.isHead === true;
const teamOf = (u) => (isActiveStaff(u) ? u.staff.team : null);
const inPanel = (u) => isAdmin(u) || isActiveStaff(u);

export const canView = (u, l) => isAdmin(u) || (inPanel(u) && (l.audience === 'company' || l.audience === teamOf(u)));
export const canPostTo = (u, audience) => isAdmin(u) || (isHead(u) && (audience === 'company' || audience === teamOf(u)));
export const canManage = (u, l) => isAdmin(u)
  || (isHead(u) && (l.audience === teamOf(u) || (l.audience === 'company' && same(u._id, l.createdBy))));
export const canEdit = (u, l) => canManage(u, l) || (canView(u, l) && same(u?._id, l.owner));

const audienceLabel = (a) => (a === 'company' ? 'Whole company' : STAFF_TEAM_LABELS[a] || a);
const isStale = (l, now) => now - new Date(l.lastCheckedAt).getTime() > LESSON_STALE_DAYS * 24 * 60 * 60 * 1000;
const basenameOf = (publicId) => String(publicId).split('/').pop();

function shapeFile(f) {
  return { name: f.name, kind: f.kind, size: f.size, mime: f.mime, fileName: basenameOf(f.publicId), byName: f.byName, at: f.at };
}

function shape(l, viewer, { full = false, doneAt = null, now = Date.now() } = {}) {
  return {
    id: String(l._id),
    title: l.title,
    topic: l.topic || '',
    audience: l.audience,
    audienceLabel: audienceLabel(l.audience),
    owner: { id: String(l.owner), name: l.ownerName },
    createdByName: l.createdByName,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
    lastCheckedAt: l.lastCheckedAt,
    lastCheckedByName: l.lastCheckedByName,
    stale: isStale(l, now),
    rev: l.rev,
    fileKinds: [...new Set((l.files || []).map((f) => f.kind))],
    fileCount: (l.files || []).length,
    doneAt,
    can: { edit: canEdit(viewer, l), manage: canManage(viewer, l) },
    ...(full ? { body: l.body || '', files: (l.files || []).map(shapeFile) } : {}),
  };
}

function cleanTitle(raw) {
  const title = String(raw ?? '').trim();
  if (!title) throw fail('Give the lesson a title.', 400);
  if (title.length > TITLE_MAX) throw fail(`Keep the title under ${TITLE_MAX} characters.`, 400);
  return title;
}

function cleanBody(raw) {
  const tooLong = `Keep the lesson under ${BODY_MAX} characters.`;
  const s = String(raw ?? '');
  if (s.length > BODY_MAX * RICH_TEXT_MARKUP_FACTOR) throw fail(tooLong, 400);
  const text = cleanRichText(s);
  if (richTextLength(text) > BODY_MAX) throw fail(tooLong, 400);
  return text;
}

function cleanTopic(raw) {
  const topic = String(raw ?? '').trim();
  if (topic.length > TOPIC_MAX) throw fail(`Keep the job or topic under ${TOPIC_MAX} characters.`, 400);
  return topic;
}

function cleanAudience(raw) {
  if (!LESSON_AUDIENCES.includes(raw)) throw fail('Choose who the lesson is for.', 400);
  return raw;
}

/** The owner must be able to read the lesson they keep up to date. */
async function loadOwner(ownerId, audience) {
  const user = mongoose.isValidObjectId(ownerId) ? await userRepository.findById(ownerId) : null;
  if (!user || !canView(user, { audience })) throw fail('The owner must be someone who can see this lesson.', 400);
  return user;
}

async function loadVisible(actor, id) {
  const lesson = await staffLessonRepository.findLive(id);
  if (!lesson || !canView(actor, lesson)) throw fail('Lesson not found.', 404);
  return lesson;
}

async function loadEditable(actor, id) {
  const lesson = await loadVisible(actor, id);
  if (!canEdit(actor, lesson)) throw fail('Only the lesson’s owner, the team head or an admin can change it.', 403);
  return lesson;
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  const raw = Buffer.from(String(cursor), 'base64url').toString('utf8');
  if (!mongoose.isValidObjectId(raw)) throw fail('Invalid page cursor.', 400);
  return new mongoose.Types.ObjectId(raw);
}
const encodeCursor = (id) => Buffer.from(String(id)).toString('base64url');
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The sections this person sees, where they may post, and who can own a lesson. */
export async function lessonMeta(actor) {
  const sections = LESSON_AUDIENCES.filter((a) => canView(actor, { audience: a }));
  const postTo = LESSON_AUDIENCES.filter((a) => canPostTo(actor, a));
  const toOption = (key) => ({ key, label: audienceLabel(key) });
  const people = postTo.length || isHead(actor)
    ? (await userRepository.findChatUsers()).map((u) => ({
      id: String(u._id), name: u.name, team: isActiveStaff(u) ? u.staff.team : null, isAdmin: isAdmin(u),
    }))
    : [];
  return { sections: sections.map(toOption), postTo: postTo.map(toOption), people, staleDays: LESSON_STALE_DAYS };
}

/** One page of lessons, newest first, with whether the viewer has finished each. */
export async function listLessons(actor, { section, q, cursor } = {}) {
  const visible = LESSON_AUDIENCES.filter((a) => canView(actor, { audience: a }));
  if (section && !visible.includes(section)) throw fail('You can’t see that section.', 403);
  const filter = {};
  if (section) filter.audience = section;
  else if (!isAdmin(actor)) filter.audience = { $in: visible };
  const term = String(q ?? '').trim();
  if (term) filter.title = { $regex: escapeRegex(term), $options: 'i' };

  const rows = await staffLessonRepository.page(filter, { before: decodeCursor(cursor), limit: PAGE_SIZE + 1 });
  const more = rows.length > PAGE_SIZE;
  const page = more ? rows.slice(0, PAGE_SIZE) : rows;
  const done = await staffLessonRepository.doneByUser(actor._id, page.map((l) => l._id));
  const doneAt = new Map(done.map((d) => [String(d.lesson), d.completedAt]));
  return {
    lessons: page.map((l) => shape(l, actor, { doneAt: doneAt.get(String(l._id)) ?? null })),
    nextCursor: more ? encodeCursor(page[page.length - 1]._id) : null,
  };
}

async function shapeOne(actor, lesson) {
  const [mine] = await staffLessonRepository.doneByUser(actor._id, [lesson._id]);
  return shape(lesson, actor, { full: true, doneAt: mine?.completedAt ?? null });
}

export async function getLesson(actor, id) {
  return shapeOne(actor, await loadVisible(actor, id));
}

export async function createLesson(actor, input = {}, req) {
  const audience = cleanAudience(input.audience);
  if (!canPostTo(actor, audience)) throw fail('Heads can post to their own team or the whole company.', 403);
  const owner = input.ownerId ? await loadOwner(input.ownerId, audience) : actor;
  const now = new Date();
  const doc = await staffLessonRepository.create({
    title: cleanTitle(input.title),
    body: cleanBody(input.body),
    topic: cleanTopic(input.topic),
    audience,
    owner: owner._id,
    ownerName: owner.name || '',
    createdBy: actor._id,
    createdByName: actor.name || '',
    lastCheckedAt: now,
    lastCheckedByName: actor.name || '',
  });
  auditLogger.logAction(req, 'CREATE', 'StaffLesson', doc._id, { audience });
  return shapeOne(actor, doc);
}

export async function updateLesson(actor, id, input = {}, req) {
  const lesson = await loadEditable(actor, id);
  const set = {};
  if (input.title !== undefined) set.title = cleanTitle(input.title);
  if (input.body !== undefined) set.body = cleanBody(input.body);
  if (input.topic !== undefined) set.topic = cleanTopic(input.topic);

  const moving = input.audience !== undefined && input.audience !== lesson.audience;
  const newOwner = !!input.ownerId && !same(input.ownerId, lesson.owner);
  if ((moving || newOwner) && !canManage(actor, lesson)) throw fail('Only the team head or an admin can move a lesson or change its owner.', 403);
  const audience = moving ? cleanAudience(input.audience) : lesson.audience;
  if (moving) {
    if (!canPostTo(actor, audience)) throw fail('Heads can post to their own team or the whole company.', 403);
    set.audience = audience;
  }
  if (moving || newOwner) {
    const owner = await loadOwner(newOwner ? input.ownerId : lesson.owner, audience);
    set.owner = owner._id;
    set.ownerName = owner.name || '';
  }
  if (!Object.keys(set).length) return shapeOne(actor, lesson);

  const updated = await staffLessonRepository.updateIfRev(lesson._id, Number(input.rev), set);
  if (!updated) throw fail('Someone else changed this lesson. Reload and try again.', 409);
  auditLogger.logAction(req, 'UPDATE', 'StaffLesson', lesson._id, { fields: Object.keys(set) });
  return shapeOne(actor, updated);
}

export async function markLessonChecked(actor, id, req) {
  const lesson = await loadEditable(actor, id);
  const updated = await staffLessonRepository.setChecked(lesson._id, new Date(), actor.name || '');
  if (!updated) throw fail('Lesson not found.', 404);
  auditLogger.logAction(req, 'UPDATE', 'StaffLesson', lesson._id, { change: 'checked' });
  return shapeOne(actor, updated);
}

export async function archiveLesson(actor, id, req) {
  const lesson = await loadVisible(actor, id);
  if (!canManage(actor, lesson)) throw fail('Only the team head or an admin can remove a lesson.', 403);
  if (!await staffLessonRepository.archive(lesson._id, new Date())) throw fail('Lesson not found.', 404);
  auditLogger.logAction(req, 'DELETE', 'StaffLesson', lesson._id, { title: lesson.title });
  return { archived: true };
}

/** Finishing is recorded once; doing it again keeps the first date. */
export async function setLessonDone(actor, id, done) {
  const lesson = await loadVisible(actor, id);
  if (done) await staffLessonRepository.markDone(lesson._id, actor._id, new Date());
  else await staffLessonRepository.unmarkDone(lesson._id, actor._id);
  return shapeOne(actor, lesson);
}

/** Who a lesson is for and who has finished it. Bounded by the size of the staff list. */
export async function lessonProgress(actor, id) {
  const lesson = await loadVisible(actor, id);
  if (!canEdit(actor, lesson)) throw fail('Only the lesson’s owner, the team head or an admin can see this.', 403);
  const people = await userRepository.findActiveStaff(lesson.audience === 'company' ? null : lesson.audience);
  const rows = await staffLessonRepository.progressFor(lesson._id, people.map((p) => p._id));
  const doneAt = new Map(rows.map((r) => [String(r.user), r.completedAt]));
  return {
    people: people.map((p) => ({
      id: String(p._id),
      name: p.name,
      teamLabel: STAFF_TEAM_LABELS[p.staff.team] || p.staff.team,
      doneAt: doneAt.get(String(p._id)) ?? null,
    })),
  };
}

function assertStorage() {
  if (storageProvider() !== 'r2') throw fail('File storage is not set up here, so files can’t be added.', 503);
}

const lessonFolder = (id) => `${LESSON_PREFIX}/${id}`;

/** A one-file presigned PUT, into this lesson's own folder. */
export async function lessonUploadTarget(actor, id, { contentType, size } = {}) {
  const lesson = await loadEditable(actor, id);
  assertStorage();
  if ((lesson.files || []).length >= LESSON_FILES_MAX) throw fail(`A lesson can hold at most ${LESSON_FILES_MAX} files.`, 400);
  const normalised = String(contentType ?? '').trim().toLowerCase();
  const type = FILE_TYPES[normalised];
  const notAllowed = 'Add a video (MP4, MOV, WebM), PDF, PowerPoint, Word, Excel or photo.';
  if (!type) throw fail(notAllowed, 400);
  if (Number(size) > maxBytesFor(type)) throw fail(`That file is over the ${capLabel(type)} limit.`, 400);
  const [target] = await buildTargets({
    folder: lessonFolder(lesson._id),
    files: [{ slot: SLOT, contentType: normalised }],
    maxFiles: 1,
    resolveSlot: (name) => (name === SLOT ? { key: SLOT, label: 'File', extFor: () => type.ext } : null),
  });
  return { uploadUrl: target.uploadUrl, key: target.key, contentType: target.contentType };
}

const typeOfKey = (key) => BY_EXT.get(String(key).split('.').pop());

/**
 * Attach a file the browser has just uploaded. Everything is read back from the
 * store: the key must be one minted for THIS lesson, its size and its first bytes
 * decide whether it stays. A retry of the same key changes nothing.
 */
export async function attachLessonFile(actor, id, { key, name } = {}) {
  const lesson = await loadEditable(actor, id);
  assertStorage();
  const type = typeOfKey(key);
  if (slotFromKey(LESSON_PREFIX, key) !== SLOT || !String(key).startsWith(`${lessonFolder(lesson._id)}/`) || !type) {
    throw fail('That upload could not be verified. Please add the file again.', 400);
  }
  if ((lesson.files || []).some((f) => f.publicId === key)) return shapeOne(actor, lesson);
  const discard = () => deletePrivateAsset({ publicId: key, provider: 'r2' });

  const head = await headObject({ key, scope: 'private' });
  if (!head || head.bytes <= 0) throw fail('That upload could not be verified. Please add the file again.', 400);
  if (head.bytes > maxBytesFor(type)) {
    await discard();
    throw fail(`That file is over the ${capLabel(type)} limit.`, 400);
  }
  const bytes = await getObjectHead({ key, scope: 'private', bytes: SNIFF_BYTES });
  if (!type.real(bytes)) {
    await discard();
    throw fail(`That does not look like a real ${type.ext.toUpperCase()} file, so it was not added.`, 400);
  }

  const updated = await staffLessonRepository.pushFile(lesson._id, {
    publicId: key,
    provider: 'r2',
    kind: type.kind,
    name: safeName(name, type.ext),
    mime: type.mime,
    size: head.bytes,
    by: actor._id,
    byName: actor.name || '',
    at: new Date(),
  }, LESSON_FILES_MAX);
  if (updated) return shapeOne(actor, updated);

  // Not added: either a retry that raced us (keep the file) or the lesson filled up.
  const now = await staffLessonRepository.findLive(lesson._id);
  if (now && now.files.some((f) => f.publicId === key)) return shapeOne(actor, now);
  await discard();
  throw fail(`A lesson can hold at most ${LESSON_FILES_MAX} files.`, 400);
}

const findFile = (lesson, fileName) => {
  const file = (lesson.files || []).find((f) => basenameOf(f.publicId) === fileName);
  if (!file) throw fail('File not found.', 404);
  return file;
};

export async function removeLessonFile(actor, id, fileName, req) {
  const lesson = await loadEditable(actor, id);
  const file = findFile(lesson, fileName);
  const updated = await staffLessonRepository.pullFile(lesson._id, file.publicId);
  if (!updated) throw fail('File not found.', 404);
  await deletePrivateAsset({ publicId: file.publicId, provider: 'r2' });
  auditLogger.logAction(req, 'UPDATE', 'StaffLesson', lesson._id, { change: 'file_removed', file: file.name });
  return shapeOne(actor, updated);
}

/** A short-lived read link, minted only for someone who can see the lesson. */
export async function lessonFileUrl(actor, id, fileName, { download = false } = {}) {
  const lesson = await loadVisible(actor, id);
  const file = findFile(lesson, fileName);
  const type = BY_EXT.get(String(file.publicId).split('.').pop());
  const attach = download || !type?.inline;
  const url = await r2PrivateUrl({
    key: file.publicId,
    ttlSeconds: file.kind === 'video' ? VIDEO_URL_TTL_SECONDS : undefined,
    downloadAs: attach ? file.name : undefined,
    // Ours, from the checked type: R2 stores whatever Content-Type the uploader sent.
    contentType: file.mime,
  });
  if (!url) throw fail('File not found.', 404);
  return { url, name: file.name, kind: file.kind, mime: file.mime };
}
