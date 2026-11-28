/**
 * Build tiny but structurally real MP4 / MOV files for tests.
 *
 * Only the boxes the server reads are filled in (ftyp, mvhd, trak/mdia/hdlr,
 * minf/stbl/stsd); `mdat` is zero padding standing in for the media. Enough to
 * exercise services/storage/mp4Probe.js exactly as a phone recording would.
 */

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };

export const box = (type, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([u32(8 + body.length), Buffer.from(type, 'latin1'), body]);
};

/** A box with a 64-bit size header (size field = 1), as large `mdat`s use. */
export const largeBox = (type, body) =>
  Buffer.concat([u32(1), Buffer.from(type, 'latin1'), u64(16 + body.length), body]);

const ftyp = (brand) => box('ftyp', Buffer.from(brand, 'latin1'), u32(0x200), Buffer.from(`${brand}isommp41`, 'latin1'));

export const mvhd = ({ timescale = 1000, duration = 20000, version = 0 } = {}) => (version === 1
  ? box('mvhd', Buffer.from([1, 0, 0, 0]), u64(0), u64(0), u32(timescale), u64(duration), Buffer.alloc(80))
  : box('mvhd', Buffer.from([0, 0, 0, 0]), u32(0), u32(0), u32(timescale), u32(duration), Buffer.alloc(80)));

const trak = (handler, codec) => box('trak',
  box('tkhd', Buffer.alloc(84)),
  box('mdia',
    box('mdhd', Buffer.alloc(24)),
    box('hdlr', Buffer.alloc(8), Buffer.from(handler, 'latin1'), Buffer.alloc(13)),
    box('minf',
      box('stbl',
        box('stsd', Buffer.alloc(4), u32(1), box(codec, Buffer.alloc(78)))))));

/**
 * @param {object} [o]
 * @param {number} [o.durationSec=20]
 * @param {string} [o.codec='avc1']        video sample entry (`hvc1` = HEVC)
 * @param {boolean} [o.moovAtEnd=true]     phone recordings put `moov` last
 * @param {'mp4'|'mov'|'3gp'} [o.container='mp4']
 * @param {string|string[]} [o.audioCodec='mp4a'] sound sample entry/entries (`samr` = AMR)
 * @param {number} [o.mvhdVersion=0]
 * @param {number} [o.mdatBytes=4096]
 * @param {boolean} [o.audio=true]
 * @param {boolean} [o.video=true]
 * @param {number} [o.rawDuration]         override the mvhd duration field (e.g. 0)
 * @param {boolean} [o.largeMdat=false]    64-bit `mdat` size header
 */
export function makeMp4({
  durationSec = 20, codec = 'avc1', moovAtEnd = true, container = 'mp4', mvhdVersion = 0,
  mdatBytes = 4096, audio = true, video = true, rawDuration, largeMdat = false, audioCodec = 'mp4a',
} = {}) {
  const timescale = 600;
  const moov = box('moov',
    mvhd({ timescale, duration: rawDuration ?? Math.round(durationSec * timescale), version: mvhdVersion }),
    ...(video ? [trak('vide', codec)] : []),
    ...(audio ? [audioCodec].flat().map((c) => trak('soun', c)) : []));
  const mdat = largeMdat ? largeBox('mdat', Buffer.alloc(mdatBytes)) : box('mdat', Buffer.alloc(mdatBytes));
  const brand = { mov: 'qt  ', '3gp': '3gp4' }[container] ?? 'isom';
  const head = [ftyp(brand), box('wide')];
  return Buffer.concat(moovAtEnd ? [...head, mdat, moov] : [...head, moov, mdat]);
}

/** A range reader over a Buffer, counting calls — the shape probeIsoMedia expects. */
export function bufferReader(buf) {
  const reader = async (start, length) => buf.subarray(start, Math.min(buf.length, start + length));
  const counted = async (start, length) => { counted.calls += 1; return reader(start, length); };
  counted.calls = 0;
  return counted;
}
