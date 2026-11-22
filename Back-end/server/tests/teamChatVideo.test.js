/**
 * Team chat — sharing videos.
 *
 *   - MP4, MOV (iPhone) and WebM are accepted, recognised by their BYTES, and
 *     stored as kind 'video'; a file that only claims to be a video is refused
 *   - a video may be up to 40 MB; other files keep their 10 MB cap even though
 *     the uploader now buffers up to 40 MB (the cap is per kind)
 *   - on R2 (production) a video is never streamed through the API: the reader's
 *     access is checked and they are redirected to a short-lived private link
 *     (R2 answers the Range requests a player — Safari above all — needs)
 *   - on Cloudinary it is uploaded as a `video` asset, not `raw`
 *   - task files share the uploader but do not take videos
 */
import bcrypt from 'bcryptjs';
import { jest } from '@jest/globals';

const stored = new Map();
const cloudinaryCalls = [];
const signed = [];
const storageMock = {
  resourceTypeFor: (t) => (String(t).startsWith('image/') ? 'image' : 'raw'),
  putPrivateAsset: async ({ buffer, folder, basename }) => {
    const publicId = `${folder}/${basename}`;
    stored.set(publicId, buffer);
    return { publicId, provider: 'r2', bytes: buffer.length, resourceType: 'video', url: '' };
  },
  deletePrivateAsset: async ({ publicId }) => { stored.delete(publicId); return true; },
  readPrivateAsset: async (ref) => {
    if (!stored.has(ref.publicId)) throw new Error('NoSuchKey');
    return stored.get(ref.publicId);
  },
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));
const urlMock = {
  providerOf: () => 'r2',
  r2PrivateUrl: async (opts) => {
    signed.push(opts);
    return `https://acct.r2.cloudflarestorage.com/private/${opts.key}?X-Amz-Signature=test`;
  },
};
jest.unstable_mockModule('../services/storage/privateAssetUrl.js', () => ({ ...urlMock, default: urlMock }));
jest.unstable_mockModule('../utils/cloudinaryHelpers.js', () => {
  const record = (kind) => (buffer, { folder } = {}) => {
    cloudinaryCalls.push({ kind, folder });
    const id = `${folder}/mock-${cloudinaryCalls.length}`;
    return Promise.resolve({ secure_url: `https://res.cloudinary.com/x/${kind}/upload/${id}`, public_id: id });
  };
  return {
    uploadToCloudinary: record('image'),
    uploadRawToCloudinary: record('raw'),
    uploadVideoToCloudinary: record('video'),
    uploadManyToCloudinary: jest.fn(),
    deleteFromCloudinary: () => Promise.resolve(),
    deleteManyFromCloudinary: () => Promise.resolve(),
    buildOptimizedUrl: (id) => id,
    generateUploadSignature: () => ({}),
  };
});

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const User = (await import('../models/User.js')).default;
const { storeTaskFiles } = await import('../services/taskFileService.js');
const { CHAT_VIDEO_URL_TTL_SECONDS } = await import('../services/chatService.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const MB = 1024 * 1024;

// Just enough of each container for the byte check.
const MP4 = Buffer.concat([Buffer.from('000000186674797069736f6d0000020069736f6d', 'hex'), Buffer.alloc(64)]);
const MOV = Buffer.concat([Buffer.from('0000001466747970717420200000000071742020', 'hex'), Buffer.alloc(64)]);
const OLD_MOV = Buffer.concat([Buffer.from('0000000877696465', 'hex'), Buffer.alloc(64)]); // 'wide' atom first
const WEBM = Buffer.concat([Buffer.from('1a45dfa39f4286810142f7810142f2810442f381', 'hex'), Buffer.alloc(64)]);
const PDF = Buffer.from('%PDF-1.4\nbody');
const padTo = (head, bytes) => Buffer.concat([head, Buffer.alloc(bytes - head.length)]);

const csrfFrom = (res) => {
  const x = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return x ? x.split(';')[0].split('=')[1] : '';
};
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  return {
    get: (url) => agent.get(`${BASE}${url}`),
    raw: (url) => agent.get(url).redirects(0),
    upload: (url, fields, files) => {
      let r = agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf);
      for (const [k, v] of Object.entries(fields)) r = r.field(k, String(v));
      for (const f of files) r = r.attach('files', f.buffer, { filename: f.name, contentType: f.type });
      return r;
    },
  };
}
let n = 0;
const person = async (name, team) => {
  n += 1;
  const email = `${name.toLowerCase()}${n}@example.com`;
  await User.create({
    name, email, role: 'staff', staff: { team, isHead: false, active: true }, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4),
  });
  return signIn(email);
};
const teamSpace = async (s, team) => (await s.get('/chat/channels')).body.channels.find((c) => c.key === `team:${team}`);
const send = (s, channel, files) => s.upload(`/chat/channels/${channel.id}/messages`, { text: '' }, files);

describe('Team chat — videos', () => {
  let buyer, mate, sales, team;

  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    delete process.env.STORAGE_PROVIDER;
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  beforeEach(async () => {
    process.env.STORAGE_PROVIDER = 'r2';
    stored.clear();
    cloudinaryCalls.length = 0;
    signed.length = 0;
    buyer = await person('Priya', 'procurement');
    mate = await person('Pavan', 'procurement');
    sales = await person('Sana', 'sales');
    team = await teamSpace(buyer, 'procurement');
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  describe('accepting', () => {
    it.each([
      ['clip.mp4', 'video/mp4', MP4, 'mp4'],
      ['IMG_0042.MOV', 'video/quicktime', MOV, 'mov'],
      ['old-camera.mov', 'video/quicktime', OLD_MOV, 'mov'],
      ['screen.webm', 'video/webm', WEBM, 'webm'],
    ])('shares %s as a video', async (name, type, buffer, ext) => {
      const res = await send(buyer, team, [{ buffer, name, type }]);
      expect(res.status).toBe(201);
      const [a] = res.body.message.attachments;
      expect(a).toMatchObject({ kind: 'video', mime: type });
      expect(a.name.endsWith(`.${ext}`)).toBe(true);
      expect(stored.size).toBe(1);
    });

    it('a video the browser sent with no type is recognised from its name and bytes', async () => {
      const res = await send(buyer, team, [{ buffer: MOV, name: 'from-phone.mov', type: 'application/octet-stream' }]);
      expect(res.status).toBe(201);
      expect(res.body.message.attachments[0]).toMatchObject({ kind: 'video', mime: 'video/quicktime' });
    });

    it('a video and a photo can go in one message, and the video shows in the Files tab', async () => {
      const png = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');
      const res = await send(buyer, team, [
        { buffer: MP4, name: 'clip.mp4', type: 'video/mp4' },
        { buffer: png, name: 'photo.png', type: 'image/png' },
      ]);
      expect(res.status).toBe(201);
      expect(res.body.message.attachments.map((a) => a.kind)).toEqual(['video', 'image']);
      const files = (await mate.get(`/chat/channels/${team.id}/files`)).body.files;
      expect(files.map((f) => f.kind).sort()).toEqual(['image', 'video']);
    });

    it('takes a video right up to 40 MB', async () => {
      const res = await send(buyer, team, [{ buffer: padTo(MP4, 40 * MB), name: 'long.mp4', type: 'video/mp4' }]);
      expect(res.status).toBe(201);
    });
  });

  describe('refusing', () => {
    it('a file that claims to be a video but is not is refused, and nothing is stored', async () => {
      const res = await send(buyer, team, [{ buffer: Buffer.from('MZ this is an exe really'), name: 'clip.mp4', type: 'video/mp4' }]);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/does not look like a real MP4/i);
      expect(stored.size).toBe(0);
    });

    it('a photo pretending to be an MP4 (HEIC brand) is refused', async () => {
      const heic = Buffer.concat([Buffer.from('000000186674797068656963', 'hex'), Buffer.alloc(32)]);
      expect((await send(buyer, team, [{ buffer: heic, name: 'x.mp4', type: 'video/mp4' }])).status).toBe(400);
    });

    it('an unsupported video format is refused with the list of what works', async () => {
      const res = await send(buyer, team, [{ buffer: Buffer.from('RIFF....AVI LIST'), name: 'old.avi', type: 'video/x-msvideo' }]);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/video \(MP4, MOV, WebM\)/);
    });

    it('a video over 40 MB is refused with the limit in words', async () => {
      const res = await send(buyer, team, [{ buffer: padTo(MP4, 40 * MB + 1), name: 'huge.mp4', type: 'video/mp4' }]);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('That file is too big. Videos can be up to 40 MB; other files up to 10 MB.');
      expect(stored.size).toBe(0);
    });

    it('a PDF still may not be over 10 MB, though videos may', async () => {
      const res = await send(buyer, team, [{ buffer: padTo(PDF, 11 * MB), name: 'scan.pdf', type: 'application/pdf' }]);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/"scan.pdf" is too big\. Videos can be up to 40 MB; other files up to 10 MB\./);
      expect(stored.size).toBe(0);
    });
  });

  describe('watching (R2)', () => {
    it('sends people in the channel to a short-lived private link; others get 404, strangers 401', async () => {
      const [a] = (await send(buyer, team, [{ buffer: MP4, name: 'clip.mp4', type: 'video/mp4' }])).body.message.attachments;

      const seen = await mate.raw(a.url);
      expect(seen.status).toBe(302);
      expect(seen.headers.location).toMatch(/^https:\/\/acct\.r2\.cloudflarestorage\.com\/private\/chat\//);
      expect(seen.headers['cache-control']).toBe('no-store');
      expect(signed[0]).toMatchObject({ ttlSeconds: CHAT_VIDEO_URL_TTL_SECONDS, contentType: 'video/mp4', downloadAs: undefined });
      expect(signed[0].key).toMatch(new RegExp(`^chat/${team.id}/\\d{13}-[a-f0-9]{8}-clip\\.mp4$`));

      expect((await sales.raw(a.url)).status).toBe(404); // not in procurement's space
      expect((await request(app).get(a.url)).status).toBe(401);
      expect(signed).toHaveLength(1); // no link minted for either of them
    });

    it('?download=1 asks for a download with the original name', async () => {
      const [a] = (await send(buyer, team, [{ buffer: MP4, name: 'clip.mp4', type: 'video/mp4' }])).body.message.attachments;
      expect((await mate.raw(`${a.url}?download=1`)).status).toBe(302);
      expect(signed[0].downloadAs).toBe('clip.mp4');
    });

    it('a photo is still served directly, not redirected', async () => {
      const png = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');
      const [a] = (await send(buyer, team, [{ buffer: png, name: 'p.png', type: 'image/png' }])).body.message.attachments;
      expect((await mate.raw(a.url)).status).toBe(200);
      expect(signed).toHaveLength(0);
    });
  });

  describe('Cloudinary (fallback storage)', () => {
    it('uploads a video as a video asset, not a raw download', async () => {
      process.env.STORAGE_PROVIDER = 'cloudinary';
      const res = await send(buyer, team, [{ buffer: MP4, name: 'clip.mp4', type: 'video/mp4' }]);
      expect(res.status).toBe(201);
      expect(cloudinaryCalls).toEqual([{ kind: 'video', folder: `autobacs/chat/${team.id}` }]);
      expect(res.body.message.attachments[0]).toMatchObject({ kind: 'video', url: expect.stringContaining('/video/upload/') });
    });
  });

  describe('task files (same uploader)', () => {
    const file = (over) => ({ originalname: 'x', size: 100, buffer: MP4, mimetype: 'video/mp4', ...over });

    it('take a video (tasks show it with a player), under the task’s private folder', async () => {
      const [ref] = await storeTaskFiles([file({ originalname: 'clip.mp4' })], 'task1');
      expect(ref).toMatchObject({ kind: 'video', mime: 'video/mp4', provider: 'r2' });
      expect(ref.publicId).toMatch(/^tasks\/task1\/\d{13}-[a-f0-9]{8}-clip\.mp4$/);
    });

    it('keep the 40 MB video cap', async () => {
      await expect(storeTaskFiles([file({ originalname: 'long.mp4', size: 40 * MB + 1 })], 'task1')).rejects.toThrow(/too big/);
      expect(stored.size).toBe(0);
    });

    it('keep the 10 MB cap', async () => {
      await expect(storeTaskFiles([file({ originalname: 'big.pdf', mimetype: 'application/pdf', buffer: PDF, size: 11 * MB })], 'task1'))
        .rejects.toThrow(/too big/);
    });
  });
});
