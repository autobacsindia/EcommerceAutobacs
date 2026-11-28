/**
 * The 3D garage scene — runs INSIDE the WebView, not in React Native.
 *
 * This file is bundled together with three.js by `npm run build:showroom` into
 * `sceneBundle.generated.ts` (one self-contained script string). Edit here, then
 * re-run the build; a test fails if the bundle is stale.
 *
 * The car is a real 3D model (.glb) when the app has one for it (MODELS below):
 * the page asks for it with {type:'want-model'} and the app sends the file in
 * (base64 chunks on a phone, an ArrayBuffer on web). Until it arrives the stage
 * stays behind the app's loading cover; if it never arrives or cannot be read,
 * the code-drawn sample car is shown instead, so the garage always opens.
 * The garage and every part are drawn in code. Each part is a named group on the
 * car, so swapping a sample part for a real model later only changes how that
 * one group is built.
 *
 * Page API (called from the app with injectJavaScript):
 *   window.showroom.setParts(['bumper', 'snorkel'])   – what is fitted
 *   window.showroom.setPaint('#a3151c')               – body colour
 *   window.showroom.setInsets(0.1, 0.4)               – share of the screen the
 *                                                       app covers, top / bottom
 *   window.showroom.modelChunk(i, n, 'base64…')       – piece i of n of the .glb
 *   window.showroom.modelFailed()                     – the app could not read it
 * The page posts {type:'ready'} once the first frame is drawn, and
 * {type:'error', message} if WebGL is unavailable.
 *
 * Units are metres. +X is the front of the car, +Y is up.
 */
import {
  ACESFilmicToneMapping,
  BackSide,
  Box3,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  RepeatWrapping,
  Scene,
  Shape,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const cfg = window.__SHOWROOM__ || {};
const ACCENT = cfg.accent || '#0a5c33';

function post(msg) {
  const text = JSON.stringify(msg);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(text);
  else if (window.parent && window.parent !== window) window.parent.postMessage(text, '*');
}

// ── materials ───────────────────────────────────────────────────────────────

const paint = new MeshStandardMaterial({ color: cfg.paint || '#a3151c', metalness: 0.6, roughness: 0.26 });
const glass = new MeshStandardMaterial({ color: '#0d1413', metalness: 0.85, roughness: 0.08 });
const trim = new MeshStandardMaterial({ color: '#151717', metalness: 0.25, roughness: 0.7 });
const gloss = new MeshStandardMaterial({ color: '#0c0d0d', metalness: 0.7, roughness: 0.22 });
const steel = new MeshStandardMaterial({ color: '#111313', metalness: 0.6, roughness: 0.45 });
const chrome = new MeshStandardMaterial({ color: '#c9cdcc', metalness: 0.9, roughness: 0.22 });
const rubber = new MeshStandardMaterial({ color: '#101010', metalness: 0, roughness: 0.92 });
const lamp = new MeshStandardMaterial({ color: '#ffffff', emissive: '#f4f8ff', emissiveIntensity: 1.6, roughness: 0.3 });
const tail = new MeshStandardMaterial({ color: '#c4122c', emissive: '#a00c20', emissiveIntensity: 1.1, roughness: 0.4 });
const bedLiner = new MeshStandardMaterial({ color: '#1c1e1e', metalness: 0.1, roughness: 0.9 });

// ── small builders ──────────────────────────────────────────────────────────

function box(w, h, d, mat, x, y, z) {
  const m = new Mesh(new BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** A round bar between two points — roll bars, racks, bull-bar hoops. */
function tube(from, to, r, mat) {
  const a = new Vector3(...from);
  const b = new Vector3(...to);
  const len = a.distanceTo(b);
  const m = new Mesh(new CylinderGeometry(r, r, len, 14), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  return m;
}

function group(...children) {
  const g = new Group();
  children.forEach((c) => g.add(c));
  return g;
}

/** A flat outline pushed out sideways, centred on the car's middle. */
function slab(points, width, mat, bevel) {
  const s = new Shape();
  points.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
  s.closePath();
  const b = bevel || 0;
  const geo = new ExtrudeGeometry(s, {
    depth: width - b * 2,
    bevelEnabled: b > 0,
    bevelSize: b,
    bevelOffset: -b,
    bevelThickness: b,
    bevelSegments: 3,
  });
  geo.translate(0, 0, -(width / 2 - b));
  const m = new Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

/** A pane lying on a sloped face that runs from `low` up to `high` (side-view points). */
function pane(low, high, width, mat, lift) {
  const dx = high[0] - low[0];
  const dy = high[1] - low[1];
  const len = Math.hypot(dx, dy);
  const facingFront = dx < 0;
  const m = new Mesh(new PlaneGeometry(width, len * 0.9), mat);
  m.rotation.y = facingFront ? Math.PI / 2 : -Math.PI / 2;
  const g = group(m);
  const tilt = Math.atan2(-dx, dy);
  g.rotation.z = tilt;
  const nx = (facingFront ? 1 : -1) * Math.cos(tilt);
  const ny = (facingFront ? 1 : -1) * Math.sin(tilt);
  g.position.set((low[0] + high[0]) / 2 + nx * lift, (low[1] + high[1]) / 2 + ny * lift, 0);
  return g;
}

// ── the sample pickup ───────────────────────────────────────────────────────

const HALF_W = 0.91; // half the body width
const CAB_HALF_W = 0.8; // the cabin is narrower than the body below it
const AXLE_F = 1.62;
const AXLE_R = -1.5;
const WHEEL_R = 0.42;
const WHEEL_Z = 0.8;
const BELT = 1.22; // top of the doors / bed rail
const ROOF = 1.84;

function buildBody() {
  // Lower body: one side outline from tailgate to nose, with both wheel arches cut in.
  const s = new Shape();
  const ARCH_R = 0.53;
  const SILL = 0.52;
  const arch = (cx) => {
    const a = Math.asin((SILL - WHEEL_R) / ARCH_R);
    s.lineTo(cx - ARCH_R * Math.cos(a), SILL);
    s.absarc(cx, WHEEL_R, ARCH_R, Math.PI - a, a, true);
  };
  s.moveTo(-2.72, 0.68);
  s.lineTo(-2.64, SILL);
  arch(AXLE_R);
  arch(AXLE_F);
  s.lineTo(2.5, SILL);
  s.lineTo(2.7, 0.64); // chin
  s.lineTo(2.73, 0.98); // nose
  s.lineTo(2.66, 1.09);
  s.lineTo(2.34, 1.15); // front edge of the bonnet
  s.lineTo(1.3, BELT); // base of the windscreen
  s.lineTo(-2.72, BELT); // doors, then the bed rail
  s.closePath();
  const geo = new ExtrudeGeometry(s, { depth: HALF_W * 2 - 0.12, bevelEnabled: true, bevelSize: 0.06, bevelOffset: -0.06, bevelThickness: 0.06, bevelSegments: 4, curveSegments: 24 });
  geo.translate(0, 0, -(HALF_W - 0.06));
  const lower = new Mesh(geo, paint);
  lower.castShadow = true;

  // Cabin: narrower than the body, so the doors have a shoulder like a real truck.
  const A_LOW = [1.32, BELT - 0.02];
  const A_HIGH = [0.6, ROOF - 0.02];
  const C_HIGH = [-0.74, ROOF];
  const C_LOW = [-0.92, BELT - 0.02];
  const cabin = slab([A_LOW, A_HIGH, C_HIGH, C_LOW], CAB_HALF_W * 2, paint, 0.05);
  const sideGlass = slab([[1.1, BELT + 0.05], [0.58, ROOF - 0.1], [-0.68, ROOF - 0.08], [-0.82, BELT + 0.05]], CAB_HALF_W * 2 + 0.012, glass);
  const pillars = group(
    box(0.07, 0.6, CAB_HALF_W * 2 + 0.02, gloss, 0.16, 1.5, 0), // B pillar
    box(0.03, 0.035, CAB_HALF_W * 2 + 0.03, gloss, 0.22, BELT + 0.03, 0),
  );
  const screen = pane(A_LOW, A_HIGH, CAB_HALF_W * 2 - 0.16, glass, 0.008);
  const rear = pane(C_LOW, C_HIGH, CAB_HALF_W * 2 - 0.3, glass, 0.008);

  // Bed: a dark tub set into the top of the rear body.
  const bed = box(1.64, 0.02, HALF_W * 2 - 0.32, bedLiner, -1.8, BELT + 0.006, 0);

  // Panel gaps and cladding: thin dark lines are what make a slab read as doors.
  const seams = group();
  [1.14, 0.2, -0.78].forEach((x) => {
    seams.add(box(0.012, 0.6, 0.006, trim, x, 0.9, HALF_W + 0.001));
    seams.add(box(0.012, 0.6, 0.006, trim, x, 0.9, -(HALF_W + 0.001)));
  });
  const cladding = group(
    box(2.0, 0.09, 0.02, trim, 0.06, 0.57, HALF_W),
    box(2.0, 0.09, 0.02, trim, 0.06, 0.57, -HALF_W),
  );
  const archTrim = (x, sgn) => {
    const m = new Mesh(new TorusGeometry(0.545, 0.028, 8, 28, Math.PI), trim);
    m.position.set(x, WHEEL_R, sgn * (HALF_W - 0.005));
    return m;
  };

  const face = group(
    // Big dark grille with slats, slim lamps either side, black lower bumper.
    box(0.05, 0.4, 1.16, gloss, 2.725, 0.86, 0),
    box(0.02, 0.03, 1.0, trim, 2.752, 0.95, 0),
    box(0.02, 0.03, 1.0, trim, 2.752, 0.86, 0),
    box(0.02, 0.03, 1.0, trim, 2.752, 0.77, 0),
    box(0.06, 0.1, 0.38, lamp, 2.7, 1.02, 0.7),
    box(0.06, 0.1, 0.38, lamp, 2.7, 1.02, -0.7),
    box(0.2, 0.2, HALF_W * 2 + 0.02, trim, 2.64, 0.6, 0),
    box(0.04, 0.14, 0.2, gloss, 2.735, 0.74, 0.74),
    box(0.04, 0.14, 0.2, gloss, 2.735, 0.74, -0.74),
    // Tall tail lamps, black handle, black step bumper.
    box(0.05, 0.42, 0.13, tail, -2.725, 0.98, HALF_W - 0.09),
    box(0.05, 0.42, 0.13, tail, -2.725, 0.98, -(HALF_W - 0.09)),
    box(0.02, 0.07, 0.36, gloss, -2.73, 1.02, 0),
    box(0.012, 0.012, HALF_W * 2 - 0.4, trim, -2.724, 0.8, 0),
    box(0.16, 0.16, HALF_W * 2 + 0.02, trim, -2.76, 0.6, 0),
  );
  const mirrors = group(
    box(0.12, 0.14, 0.22, gloss, 1.0, 1.34, CAB_HALF_W + 0.17),
    box(0.12, 0.14, 0.22, gloss, 1.0, 1.34, -(CAB_HALF_W + 0.17)),
    box(0.06, 0.04, 0.14, gloss, 1.02, 1.28, CAB_HALF_W + 0.05),
    box(0.06, 0.04, 0.14, gloss, 1.02, 1.28, -(CAB_HALF_W + 0.05)),
  );
  const handles = group();
  [0.36, -0.56].forEach((x) => {
    handles.add(box(0.16, 0.035, 0.03, gloss, x, 1.1, HALF_W + 0.005));
    handles.add(box(0.16, 0.035, 0.03, gloss, x, 1.1, -(HALF_W + 0.005)));
  });

  return group(
    lower, cabin, sideGlass, pillars, screen, rear, bed, seams, cladding, face, mirrors, handles,
    archTrim(AXLE_F, 1), archTrim(AXLE_F, -1), archTrim(AXLE_R, 1), archTrim(AXLE_R, -1),
  );
}

function buildWheel(x, z) {
  // A torus reads as a tyre (round shoulders); a plain cylinder reads as a drum.
  const tyre = new Mesh(new TorusGeometry(WHEEL_R - 0.13, 0.13, 14, 36), rubber);
  tyre.scale.z = 1.22;
  tyre.castShadow = true;
  const barrel = new Mesh(new CylinderGeometry(WHEEL_R - 0.14, WHEEL_R - 0.14, 0.24, 28), rubber);
  barrel.rotation.x = Math.PI / 2;
  const rim = new Mesh(new CylinderGeometry(WHEEL_R - 0.17, WHEEL_R - 0.17, 0.26, 28), gloss);
  rim.rotation.x = Math.PI / 2;
  const w = group(tyre, barrel, rim);
  const outer = Math.sign(z) * 0.135;
  for (let i = 0; i < 6; i += 1) {
    const spoke = box(0.42, 0.045, 0.02, steel, 0, 0, outer);
    spoke.rotation.z = (i * Math.PI) / 6;
    w.add(spoke);
  }
  const hub = new Mesh(new CylinderGeometry(0.055, 0.055, 0.3, 12), chrome);
  hub.rotation.x = Math.PI / 2;
  w.add(hub);
  w.position.set(x, WHEEL_R, z);
  return w;
}

// ── real car models ─────────────────────────────────────────────────────────
// How to stand each car's .glb in the garage. Keys are car slugs (slots.ts).
//   paint  – material names that carry the body colour (recoloured by setPaint)
//   glass  – material names of the windows (tinted: the source files are clear)
//   wheels – matches the pieces of each wheel; group 1 names which wheel it
//            belongs to (four wheels; they grow with the lift kit)
//   yaw    – turn (radians) so the car's front faces +X like the drawn car

const MODELS = {
  'toyota-hilux': {
    paint: ['primary', 'hilux_mb01.7'],
    glass: ['glass', 'glass.001'],
    // three.js strips the dots from node names (wheel_rf.001 → wheel_rf001); both spellings match.
    wheels: /^(wheel_rf(?:\.?\d{3})?)_wheel_rf\.?\d/,
    yaw: -Math.PI / 2,
  },
};

/** Waiting longer than this for the app to send the model shows the drawn car. */
const MODEL_WAIT_MS = 30000;

function base64Bytes(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Parse a .glb and stand it in the garage: front to +X, wheels on y = 0, axles centred like the drawn car. */
function placeModel(gltf, spec) {
  const root = gltf.scene;
  root.rotation.y = spec.yaw;
  const holder = new Group();
  holder.add(root);
  holder.updateMatrixWorld(true);

  const paintMats = [];
  // Wheel pieces, grouped per wheel (compressing a model flattens its node tree,
  // so the pieces are matched by name rather than by a parent "wheel" node).
  const wheelParts = new Map();
  root.traverse((o) => {
    const wheel = (o.name || '').match(spec.wheels);
    if (wheel) {
      const key = wheel[1].replace('.', '');
      if (!wheelParts.has(key)) wheelParts.set(key, []);
      wheelParts.get(key).push(o);
    }
    if (!o.isMesh) return;
    o.castShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      if (!m) return;
      if (spec.paint.includes(m.name)) {
        // The source paint is a flat-colour texture; a plain colour is what setPaint can change.
        m.map = null;
        m.metalness = 0.55;
        m.roughness = 0.28;
        m.needsUpdate = true;
        if (!paintMats.includes(m)) paintMats.push(m);
      } else if (spec.glass.includes(m.name)) {
        m.color.set('#0b1112');
        m.opacity = 0.72;
        m.metalness = 0.6;
        m.roughness = 0.05;
        m.transparent = true;
      }
    });
  });

  const box = new Box3().setFromObject(holder);
  // Stand it on the floor and centre it across.
  root.position.y -= box.min.y;
  root.position.z -= (box.min.z + box.max.z) / 2;
  // Centre the wheelbase where the drawn car's is, so the sample parts land in the same places.
  holder.updateMatrixWorld(true);
  const boxOf = (meshes) => meshes.reduce((b, m) => b.expandByObject(m), new Box3());
  const wheelGroups = [...wheelParts.values()];
  const centres = wheelGroups.map((meshes) => boxOf(meshes).getCenter(new Vector3()));
  if (centres.length >= 2) {
    const xs = centres.map((c) => c.x);
    root.position.x += (AXLE_F + AXLE_R) / 2 - (Math.min(...xs) + Math.max(...xs)) / 2;
  } else {
    root.position.x -= (box.min.x + box.max.x) / 2;
  }
  holder.updateMatrixWorld(true);

  // Each wheel moves to a pivot at its own centre, so the lift kit can grow it in place.
  const wheels = wheelGroups.map((meshes) => {
    const c = boxOf(meshes).getCenter(new Vector3());
    const pivot = new Group();
    pivot.position.copy(c);
    pivot.userData.r = c.y;
    holder.add(pivot);
    pivot.updateMatrixWorld(true);
    meshes.forEach((m) => pivot.attach(m));
    return pivot;
  });
  return { body: holder, wheels, paintMats };
}

// ── sample parts ────────────────────────────────────────────────────────────
// One builder per fit-on slot (keys match src/garage/slots.ts). Everything is in
// the car body's own space, so a lift kit raises fitted parts with the body.

const side = (fn) => group(fn(1), fn(-1));

const PART_BUILDERS = {
  bumper: () => {
    const z = HALF_W + 0.02;
    return group(
      box(0.2, 0.34, z * 2, steel, 2.8, 0.72, 0),
      box(0.22, 0.1, z * 2 - 0.5, steel, 2.82, 0.5, 0),
      tube([2.88, 0.86, 0.5], [2.92, 1.3, 0.42], 0.035, steel),
      tube([2.88, 0.86, -0.5], [2.92, 1.3, -0.42], 0.035, steel),
      tube([2.92, 1.3, 0.42], [2.92, 1.3, -0.42], 0.035, steel),
      tube([2.9, 1.08, 0.46], [2.9, 1.08, -0.46], 0.025, steel),
      box(0.03, 0.09, 0.2, lamp, 2.91, 0.7, 0.66),
      box(0.03, 0.09, 0.2, lamp, 2.91, 0.7, -0.66),
      // matching rear step bumper
      box(0.2, 0.2, z * 2, steel, -2.84, 0.6, 0),
      box(0.26, 0.03, 0.9, steel, -2.9, 0.71, 0),
    );
  },
  winch: () => {
    const drum = new Mesh(new CylinderGeometry(0.075, 0.075, 0.42, 18), chrome);
    drum.rotation.x = Math.PI / 2;
    drum.position.set(2.94, 0.72, 0);
    drum.castShadow = true;
    return group(
      drum,
      box(0.14, 0.17, 0.12, steel, 2.94, 0.72, 0.27),
      box(0.14, 0.17, 0.12, steel, 2.94, 0.72, -0.27),
      box(0.03, 0.08, 0.3, chrome, 3.03, 0.72, 0),
    );
  },
  snorkel: () => {
    const zLow = -(HALF_W + 0.05);
    const zHigh = -(CAB_HALF_W + 0.07);
    return group(
      tube([1.95, 1.1, zLow], [1.34, 1.2, zLow], 0.055, trim),
      tube([1.34, 1.2, zLow], [0.64, ROOF - 0.02, zHigh], 0.05, trim),
      tube([0.64, ROOF - 0.02, zHigh], [0.64, ROOF + 0.14, zHigh], 0.05, trim),
      box(0.2, 0.15, 0.14, trim, 0.7, ROOF + 0.2, zHigh),
    );
  },
  'fender-flare': () => {
    const flare = (x, sgn) => {
      const m = new Mesh(new TorusGeometry(0.565, 0.07, 10, 28, Math.PI), trim);
      m.position.set(x, WHEEL_R, sgn * (HALF_W + 0.01));
      m.scale.z = 1.8;
      m.castShadow = true;
      return m;
    };
    return group(flare(AXLE_F, 1), flare(AXLE_F, -1), flare(AXLE_R, 1), flare(AXLE_R, -1));
  },
  'side-step': () =>
    side((sgn) =>
      group(
        box(1.9, 0.05, 0.2, steel, 0.06, 0.44, sgn * (HALF_W + 0.1)),
        box(1.6, 0.012, 0.13, chrome, 0.06, 0.472, sgn * (HALF_W + 0.1)),
        box(0.06, 0.1, 0.12, steel, 0.8, 0.49, sgn * (HALF_W - 0.02)),
        box(0.06, 0.1, 0.12, steel, -0.7, 0.49, sgn * (HALF_W - 0.02)),
      ),
    ),
  'bonnet-hood': () => {
    const scoop = box(0.6, 0.09, 0.6, gloss, 1.86, 1.215, 0);
    scoop.rotation.z = -0.067;
    const mouth = box(0.02, 0.05, 0.5, glass, 2.165, 1.195, 0);
    return group(scoop, mouth);
  },
  'roll-bar': () => {
    const z = HALF_W - 0.14;
    return group(
      side((sgn) =>
        group(
          tube([-1.06, BELT, sgn * z], [-1.04, ROOF - 0.02, sgn * (z - 0.06)], 0.045, steel),
          tube([-1.04, ROOF - 0.02, sgn * (z - 0.06)], [-1.8, BELT + 0.02, sgn * z], 0.04, steel),
          tube([-1.3, BELT, sgn * z], [-1.25, 1.66, sgn * (z - 0.04)], 0.035, steel),
        ),
      ),
      tube([-1.04, ROOF - 0.02, z - 0.06], [-1.04, ROOF - 0.02, -(z - 0.06)], 0.045, steel),
      box(0.05, 0.08, 0.5, lamp, -1.02, ROOF + 0.06, 0),
    );
  },
  'roller-shutter': () => {
    const lid = group(box(1.72, 0.035, HALF_W * 2 - 0.1, steel, -1.8, BELT + 0.025, 0), box(0.2, 0.09, HALF_W * 2 - 0.12, trim, -1.02, BELT + 0.05, 0));
    for (let i = 0; i < 12; i += 1) lid.add(box(0.012, 0.004, HALF_W * 2 - 0.16, chrome, -1.24 - i * 0.12, BELT + 0.045, 0));
    return lid;
  },
  canopy: () =>
    group(
      box(1.78, ROOF - BELT, CAB_HALF_W * 2 + 0.06, paint, -1.8, (ROOF + BELT) / 2, 0),
      box(1.3, 0.34, CAB_HALF_W * 2 + 0.08, glass, -1.8, 1.56, 0),
      box(0.02, 0.4, 1.2, glass, -2.695, 1.54, 0),
      box(1.8, 0.03, HALF_W * 2 - 0.04, trim, -1.8, BELT + 0.015, 0),
    ),
  'roof-rack': () => {
    const y = ROOF + 0.12;
    const z = CAB_HALF_W - 0.12;
    const rack = group(
      tube([0.5, y, z], [-0.7, y, z], 0.022, steel),
      tube([0.5, y, -z], [-0.7, y, -z], 0.022, steel),
      tube([0.5, y, z], [0.5, y, -z], 0.022, steel),
      tube([-0.7, y, z], [-0.7, y, -z], 0.022, steel),
    );
    for (let i = 1; i < 6; i += 1) rack.add(tube([0.5 - i * 0.2, y, z], [0.5 - i * 0.2, y, -z], 0.014, steel));
    [0.35, -0.55].forEach((x) => {
      rack.add(tube([x, ROOF - 0.03, z], [x, y, z], 0.02, steel));
      rack.add(tube([x, ROOF - 0.03, -z], [x, y, -z], 0.02, steel));
    });
    return rack;
  },
};

/** Not a bolt-on: a lift kit raises the body and fits taller tyres. */
const LIFT_KEY = 'lift-kit';
const LIFT_BODY = 0.13;
const LIFT_WHEEL = 1.1;

// ── the garage ──────────────────────────────────────────────────────────────

const ROOM = 13; // half the room's width and depth
const ROOM_H = 6.2;
const PLINTH_H = 0.22;

/** A small repeating picture drawn in code, so the garage needs no image files. */
function texture(size, draw, repeatX, repeatY) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  draw(c.getContext('2d'), size);
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function bricks(g, n) {
  g.fillStyle = '#3a3835';
  g.fillRect(0, 0, n, n);
  const rows = 8;
  const h = n / rows;
  const w = n / 4;
  const shades = ['#6d665f', '#746c64', '#655f59', '#7a7169', '#6a635c'];
  for (let r = 0; r < rows; r += 1) {
    for (let c = -1; c < 5; c += 1) {
      g.fillStyle = shades[(r * 3 + c * 7 + 20) % shades.length];
      g.fillRect(c * w + (r % 2 ? w / 2 : 0) + 2, r * h + 2, w - 4, h - 4);
    }
  }
}

function tiles(g, n) {
  g.fillStyle = '#2b2d2d';
  g.fillRect(0, 0, n, n);
  const shades = ['#3b3e3e', '#404343', '#373a3a', '#3e4141'];
  const t = n / 2;
  for (let r = 0; r < 2; r += 1) {
    for (let c = 0; c < 2; c += 1) {
      g.fillStyle = shades[r * 2 + c];
      g.fillRect(c * t + 2, r * t + 2, t - 4, t - 4);
    }
  }
}

function planks(g, n) {
  const shades = ['#6b4a2f', '#74512f', '#63432a', '#7a5634'];
  const w = n / 4;
  for (let c = 0; c < 4; c += 1) {
    g.fillStyle = shades[c];
    g.fillRect(c * w, 0, w, n);
    g.fillStyle = '#3d2a1a';
    g.fillRect(c * w, 0, 2, n);
  }
}

function buildGarage(scene) {
  const walls = new Mesh(
    new BoxGeometry(ROOM * 2, ROOM_H, ROOM * 2),
    new MeshStandardMaterial({ map: texture(256, bricks, 14, 4), roughness: 0.95, metalness: 0, side: BackSide }),
  );
  walls.position.y = ROOM_H / 2;
  scene.add(walls);

  const floor = new Mesh(new PlaneGeometry(ROOM * 2, ROOM * 2), new MeshStandardMaterial({ map: texture(256, tiles, 13, 13), roughness: 0.45, metalness: 0.15 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.005;
  floor.receiveShadow = true;
  scene.add(floor);

  const ceiling = new Mesh(new PlaneGeometry(ROOM * 2, ROOM * 2), new MeshStandardMaterial({ color: '#1a1b1b', roughness: 1 }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ROOM_H - 0.01;
  scene.add(ceiling);

  // The low wooden stage the car stands on, edged in the brand colour.
  const plinth = new Mesh(new BoxGeometry(7.4, PLINTH_H, 3.6), new MeshStandardMaterial({ map: texture(128, planks, 6, 1), roughness: 0.7, metalness: 0.05 }));
  plinth.position.y = PLINTH_H / 2;
  plinth.receiveShadow = true;
  plinth.castShadow = true;
  scene.add(plinth);
  const edge = new Mesh(new BoxGeometry(7.44, 0.03, 3.64), new MeshBasicMaterial({ color: ACCENT }));
  edge.position.y = 0.02;
  scene.add(edge);

  // Hanging workshop lamps over the car.
  const shade = new MeshStandardMaterial({ color: '#0e0f0f', roughness: 0.5, metalness: 0.4 });
  const bulb = new MeshBasicMaterial({ color: '#fff3d6' });
  const cord = new MeshBasicMaterial({ color: '#0a0a0a' });
  for (let ix = -2; ix <= 2; ix += 1) {
    for (let iz = -1; iz <= 1; iz += 1) {
      const x = ix * 1.9;
      const z = iz * 1.9;
      const y = 4.3 + ((ix + iz + 4) % 2) * 0.25;
      const cone = new Mesh(new CylinderGeometry(0.05, 0.3, 0.2, 16, 1, true), shade);
      cone.position.set(x, y, z);
      const glow = new Mesh(new CylinderGeometry(0.26, 0.26, 0.02, 16), bulb);
      glow.position.set(x, y - 0.09, z);
      const wire = new Mesh(new CylinderGeometry(0.008, 0.008, ROOM_H - y, 4), cord);
      wire.position.set(x, (ROOM_H + y) / 2, z);
      scene.add(cone, glow, wire);
    }
  }
}

// ── scene ───────────────────────────────────────────────────────────────────

const CAMERA_START = [7.4, 2.7, 7.7];
const TARGET_Y = PLINTH_H + 0.95;
const START_DISTANCE = Math.hypot(CAMERA_START[0], CAMERA_START[1] - TARGET_Y, CAMERA_START[2]);
/** Half the car's width on screen in the three-quarter view it opens in. */
const CAR_HALF_SPAN = 3.45;

function start() {
  const canvas = document.getElementById('c');
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch {
    post({ type: 'error', message: 'webgl-unavailable' });
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const scene = new Scene();
  scene.background = new Color('#1a1b1b');

  const camera = new PerspectiveCamera(40, 1, 0.1, 80);
  camera.position.set(...CAMERA_START);

  // The room environment is what the paint and chrome reflect.
  scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  scene.add(new HemisphereLight('#fff4e0', '#3a3a3a', 0.7));
  // One shadow-casting key light from the lamps; a warm glow and a cool fill for shape.
  const key = new DirectionalLight('#fff1dc', 2.2);
  key.position.set(2.5, 9, 3.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -5;
  key.shadow.radius = 5;
  scene.add(key);
  const warm = new PointLight('#ffd9a0', 60, 22, 2);
  warm.position.set(0, 4.1, 0);
  scene.add(warm);
  const fill = new DirectionalLight('#cfe0ff', 0.5);
  fill.position.set(-6, 4, -5);
  scene.add(fill);

  buildGarage(scene);

  // The car, standing on the plinth. Its body and wheels arrive in showCar():
  // the real model when the app sends one, else the code-drawn sample.
  const car = new Group();
  car.position.y = PLINTH_H;
  scene.add(car);
  let body = new Group();
  let wheels = [];
  let paintMats = [paint];
  let carShown = false;

  function showCar(next) {
    body = next.body;
    wheels = next.wheels;
    paintMats = next.paintMats;
    car.add(body);
    // Wheels hang off the car, not the body, so the lift kit can raise the body over them.
    wheels.forEach((w) => car.attach(w));
    paintMats.forEach((m) => m.color.set(currentPaint));
    carShown = true;
    // Parts asked for before the car arrived are fitted now.
    const keys = [...fitted.keys()];
    fitted.clear();
    setParts(keys);
    // Drawn at once, not on the next animation frame (which a just-opened view may hold back).
    draw();
  }

  function showDrawnCar() {
    if (carShown) return;
    const drawn = [buildWheel(AXLE_F, WHEEL_Z), buildWheel(AXLE_F, -WHEEL_Z), buildWheel(AXLE_R, WHEEL_Z), buildWheel(AXLE_R, -WHEEL_Z)];
    drawn.forEach((w) => { w.userData.r = WHEEL_R; });
    showCar({ body: buildBody(), wheels: drawn, paintMats: [paint] });
  }

  const spec = cfg.model ? MODELS[cfg.car] : null;
  const chunks = [];
  let modelTimer = 0;

  function loadModel(bytes) {
    if (carShown || !spec) return;
    clearTimeout(modelTimer);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
      (gltf) => {
        try {
          showCar(placeModel(gltf, spec));
        } catch (err) {
          modelFailed(err);
        }
      },
      (err) => modelFailed(err),
    );
  }

  function modelFailed(err) {
    clearTimeout(modelTimer);
    post({ type: 'model-failed', message: String((err && err.message) || err || 'unknown').slice(0, 200) });
    showDrawnCar();
  }

  /** Piece i (0-based) of n of the model, base64. The last piece starts the load. */
  function modelChunk(i, n, text) {
    if (carShown || !spec || typeof text !== 'string' || !(n > 0) || i < 0 || i >= n) return;
    chunks[i] = text;
    if (chunks.filter((c) => typeof c === 'string').length < n) return;
    try {
      loadModel(base64Bytes(chunks.join('')));
    } catch (err) {
      modelFailed(err);
    }
    chunks.length = 0;
  }

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, TARGET_Y, 0);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5.2;
  controls.maxDistance = ROOM - 1.5; // never through a wall
  controls.minPolarAngle = 0.55;
  controls.maxPolarAngle = Math.PI / 2 - 0.06;
  controls.autoRotate = !cfg.still;
  controls.autoRotateSpeed = 0.7;
  // The moment the customer takes hold of the car, it is theirs to turn.
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  // Fitted parts, by slot key. `fit` eases 0 → 1 so a new part grows into place.
  const fitted = new Map();
  let currentPaint = cfg.paint || '#a3151c';
  let lift = 0;
  let liftTarget = 0;
  let insetTop = Number(cfg.insetTop) || 0;
  let insetBottom = Number(cfg.insetBottom) || 0;
  let dirty = true;
  let ready = false;
  let last = performance.now();

  function setParts(keys) {
    const want = new Set(Array.isArray(keys) ? keys : []);
    liftTarget = want.has(LIFT_KEY) ? 1 : 0;
    if (!carShown) {
      // Remembered (not built) until there is a car body to fit them on.
      fitted.clear();
      want.forEach((k) => fitted.set(k, null));
      return;
    }
    fitted.forEach((entry, k) => {
      if (!want.has(k)) {
        body.remove(entry.node);
        fitted.delete(k);
      }
    });
    want.forEach((k) => {
      const build = PART_BUILDERS[k];
      if (!build || fitted.has(k)) return;
      const node = build();
      node.scale.setScalar(cfg.still ? 1 : 0.86);
      body.add(node);
      fitted.set(k, { node, fit: cfg.still ? 1 : 0 });
    });
    redraw();
  }

  function setPaint(hex) {
    try {
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
      currentPaint = hex;
      paintMats.forEach((m) => m.color.set(hex));
      redraw();
    } catch {
      /* an unknown colour string leaves the paint as it was */
    }
  }

  /** Share of the screen (0–0.8) the app's own controls cover at the top and bottom. */
  function setInsets(top, bottom) {
    const clamp = (v) => Math.max(0, Math.min(0.8, Number(v) || 0));
    insetTop = clamp(top);
    insetBottom = clamp(bottom);
    resize();
    if (ready) draw();
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    // The car is framed in the part of the screen the app leaves free, and the
    // picture is slid so its centre sits in the middle of that free part.
    const free = Math.max(0.2, 1 - insetTop - insetBottom);
    camera.aspect = w / Math.max(1, h);
    const halfV = Math.max(Math.tan((34 * Math.PI) / 360), CAR_HALF_SPAN / (START_DISTANCE * camera.aspect), 1.5 / (START_DISTANCE * free));
    camera.fov = Math.min(78, (Math.atan(halfV) * 360) / Math.PI);
    camera.setViewOffset(w, h, 0, Math.round((h * (insetBottom - insetTop)) / 2), w, h);
    camera.updateProjectionMatrix();
    dirty = true;
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    let moving = controls.update();
    if (Math.abs(lift - liftTarget) > 0.001) {
      lift += (liftTarget - lift) * Math.min(1, dt * 6);
      moving = true;
    } else if (lift !== liftTarget) {
      lift = liftTarget;
      moving = true;
    }
    const wheelScale = 1 + (LIFT_WHEEL - 1) * lift;
    let wheelR = WHEEL_R;
    wheels.forEach((w) => {
      wheelR = w.userData.r;
      w.scale.set(wheelScale, wheelScale, 1);
      w.position.y = wheelR * wheelScale;
    });
    body.position.y = LIFT_BODY * lift + wheelR * (wheelScale - 1);

    fitted.forEach((entry) => {
      if (entry && entry.fit < 1) {
        entry.fit = Math.min(1, entry.fit + dt * 4);
        const e = 1 - Math.pow(1 - entry.fit, 3);
        entry.node.scale.setScalar(0.86 + 0.14 * e);
        moving = true;
      }
    });

    // Draw only when something changed: an idle garage costs no battery.
    if (dirty || moving) draw();
    requestAnimationFrame(frame);
  }

  /** Show a change at once (after the first picture), without waiting for a frame. */
  function redraw() {
    dirty = true;
    if (ready) draw();
  }

  function draw() {
    renderer.render(scene, camera);
    dirty = false;
    // "ready" lifts the app's loading cover, so it waits for the car itself.
    if (!ready && carShown) {
      ready = true;
      post({ type: 'ready' });
    }
  }

  window.addEventListener('resize', resize);
  window.showroom = { setParts, setPaint, setInsets, modelChunk, modelFailed: () => modelFailed('app-could-not-read') };
  // The web preview (an iframe) is driven by postMessage instead of injected script.
  window.addEventListener('message', (ev) => {
    let msg = ev.data;
    try {
      if (typeof msg === 'string') msg = JSON.parse(msg);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'parts') setParts(msg.parts);
    if (msg.type === 'paint') setPaint(msg.paint);
    if (msg.type === 'insets') setInsets(msg.top, msg.bottom);
    if (msg.type === 'model' && msg.bytes instanceof ArrayBuffer) loadModel(new Uint8Array(msg.bytes));
    if (msg.type === 'model-failed') modelFailed('app-could-not-read');
  });

  resize();
  setParts(cfg.parts || []);
  if (spec) {
    modelTimer = setTimeout(() => modelFailed('timeout'), MODEL_WAIT_MS);
    post({ type: 'want-model' });
  } else {
    showDrawnCar();
  }
  // The first picture is drawn right away rather than on the next animation
  // frame: a browser may hold animation frames back (a throttled or just-opened
  // view), and the customer should never look at an empty stage meanwhile.
  draw();
  requestAnimationFrame(frame);
}

start();
