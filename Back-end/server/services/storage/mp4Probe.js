/**
 * Read the length and video codec of an MP4 / MOV file that sits in object storage,
 * without downloading it.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Cloudinary decoded every reel and told us its duration. R2 stores bytes and has
 * no metadata API, so the 60-second cap would otherwise be a claim the client
 * makes. MP4 and MOV (ISO base media) record the movie length in the `mvhd` box
 * inside `moov`, and each track's codec in its `stsd` sample description, so both
 * facts can be read with a few small ranged GETs.
 *
 * ── Where `moov` lives ──────────────────────────────────────────────────────
 * A "fast-start" file puts `moov` at the front; most phone recordings put it at
 * the END, after the media data. So this walks the top-level boxes by reading only
 * each box header (16 bytes) and skipping the payload, which finds `moov` in a
 * handful of reads wherever it is, and then reads `moov` itself (bounded).
 *
 * ── Fail closed ─────────────────────────────────────────────────────────────
 * Anything this cannot parse returns `{ ok: false }`. The caller rejects on that:
 * a clip whose length we cannot read is not proven to be under the cap.
 *
 * Fragmented MP4 (no movie-level duration) is deliberately reported as unreadable
 * — phones do not record it, and accepting it would mean trusting a zero.
 */

/** A box we will read fully. A 60-second clip's `moov` is a few hundred KB. */
export const MAX_MOOV_BYTES = 8 * 1024 * 1024;

/** Top-level boxes to step over before giving up (ftyp, wide, free, mdat, moov…). */
const MAX_TOP_LEVEL_BOXES = 64;

const HEADER_BYTES = 16;

/** H.264 sample entries. Plays on every phone and every browser. */
export const H264_CODECS = Object.freeze(['avc1', 'avc3']);

const fourcc = (buf, at) => buf.toString('latin1', at, at + 4);

/**
 * Parse one box header at `at` in `buf`.
 * @returns {{ type: string, size: number, headerSize: number } | null}
 *   `size` 0 means "extends to the end of the enclosing space".
 */
export function readBoxHeader(buf, at = 0) {
  if (!Buffer.isBuffer(buf) || buf.length < at + 8) return null;
  let size = buf.readUInt32BE(at);
  const type = fourcc(buf, at + 4);
  let headerSize = 8;
  if (size === 1) {
    if (buf.length < at + 16) return null;
    const big = buf.readBigUInt64BE(at + 8);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(big);
    headerSize = 16;
  }
  if (size !== 0 && size < headerSize) return null; // corrupt: would loop forever
  return { type, size, headerSize };
}

/** Child boxes of a container payload. Stops (rather than throws) on a corrupt child. */
export function childBoxes(buf, start = 0, end = buf.length) {
  const out = [];
  let at = start;
  while (at + 8 <= end) {
    const h = readBoxHeader(buf, at);
    if (!h) break;
    const size = h.size === 0 ? end - at : h.size;
    if (at + size > end) break;
    out.push({ type: h.type, start: at + h.headerSize, end: at + size });
    at += size;
  }
  return out;
}

const child = (buf, box, type) => childBoxes(buf, box.start, box.end).find((b) => b.type === type);

/**
 * Movie duration in seconds from an `mvhd` payload, or null.
 * v0: flags(4) ctime(4) mtime(4) timescale(4) duration(4)
 * v1: flags(4) ctime(8) mtime(8) timescale(4) duration(8)
 */
export function mvhdDurationSec(buf, box) {
  const version = buf[box.start];
  let timescale; let duration;
  if (version === 1) {
    if (box.end - box.start < 32) return null;
    timescale = buf.readUInt32BE(box.start + 20);
    const d = buf.readBigUInt64BE(box.start + 24);
    if (d === 0xFFFFFFFFFFFFFFFFn) return null; // "unknown"
    duration = Number(d);
  } else if (version === 0) {
    if (box.end - box.start < 20) return null;
    timescale = buf.readUInt32BE(box.start + 12);
    duration = buf.readUInt32BE(box.start + 16);
    if (duration === 0xFFFFFFFF) return null; // "unknown"
  } else {
    return null;
  }
  if (!timescale || !duration) return null;
  const sec = duration / timescale;
  return Number.isFinite(sec) && sec > 0 ? sec : null;
}

/** Sample-entry codecs of every VIDEO track in a `moov` payload. */
export function videoCodecs(buf, moov) {
  const codecs = [];
  for (const trak of childBoxes(buf, moov.start, moov.end).filter((b) => b.type === 'trak')) {
    const mdia = child(buf, trak, 'mdia');
    if (!mdia) continue;
    const hdlr = child(buf, mdia, 'hdlr');
    // hdlr payload: version/flags(4) pre_defined(4) handler_type(4)
    if (!hdlr || hdlr.end - hdlr.start < 12 || fourcc(buf, hdlr.start + 8) !== 'vide') continue;
    const minf = child(buf, mdia, 'minf');
    const stbl = minf && child(buf, minf, 'stbl');
    const stsd = stbl && child(buf, stbl, 'stsd');
    // stsd payload: version/flags(4) entry_count(4) then sample entries (size(4) type(4)…)
    if (!stsd || stsd.end - stsd.start < 16) {
      codecs.push('');
      continue;
    }
    codecs.push(fourcc(buf, stsd.start + 12));
  }
  return codecs;
}

/** Everything we need from a `moov` buffer (the box INCLUDING its header). */
export function parseMoov(buf) {
  const h = readBoxHeader(buf, 0);
  if (!h || h.type !== 'moov') return { ok: false, reason: 'no-moov' };
  const moov = { start: h.headerSize, end: h.size === 0 ? buf.length : Math.min(h.size, buf.length) };
  const mvhd = child(buf, moov, 'mvhd');
  const durationSec = mvhd ? mvhdDurationSec(buf, mvhd) : null;
  if (durationSec === null) return { ok: false, reason: 'no-duration' };
  const codecs = videoCodecs(buf, moov);
  if (!codecs.length) return { ok: false, reason: 'no-video-track' };
  return { ok: true, durationSec, videoCodecs: codecs };
}

/**
 * Find and parse `moov` in an object of `size` bytes.
 *
 * @param {(start: number, length: number) => Promise<Buffer>} readRange
 *        reads `length` bytes from `start` (shorter at end of object)
 * @param {object} opts
 * @param {number} opts.size        object size in bytes (from HEAD)
 * @param {number} [opts.maxMoovBytes]
 * @returns {Promise<{ ok: true, durationSec: number, videoCodecs: string[] } | { ok: false, reason: string }>}
 *          Storage errors propagate — "could not read" is not "not a video".
 */
export async function probeIsoMedia(readRange, { size, maxMoovBytes = MAX_MOOV_BYTES }) {
  if (!Number.isSafeInteger(size) || size < 8) return { ok: false, reason: 'too-small' };
  let at = 0;
  for (let i = 0; i < MAX_TOP_LEVEL_BOXES && at + 8 <= size; i += 1) {
    const head = await readRange(at, Math.min(HEADER_BYTES, size - at));
    const h = readBoxHeader(head, 0);
    if (!h) return { ok: false, reason: 'bad-box' };
    const boxSize = h.size === 0 ? size - at : h.size;
    if (at + boxSize > size) return { ok: false, reason: 'truncated' };
    if (h.type === 'moov') {
      if (boxSize > maxMoovBytes) return { ok: false, reason: 'moov-too-large' };
      return parseMoov(await readRange(at, boxSize));
    }
    at += boxSize;
  }
  return { ok: false, reason: 'no-moov' };
}

export default { probeIsoMedia, parseMoov, readBoxHeader, childBoxes, mvhdDurationSec, videoCodecs, MAX_MOOV_BYTES, H264_CODECS };
