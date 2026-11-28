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
 *   window.showroom.focus('bumper')                   – glide the camera to a part
 *   window.showroom.modelChunk(i, n, 'base64…')       – piece i of n of the .glb
 *   window.showroom.modelFailed()                     – the app could not read it
 * The page posts {type:'ready'} once the first frame is drawn, and
 * {type:'error', message} if WebGL is unavailable.
 *
 * Units are metres. +X is the front of the car, +Y is up.
 */
import {
  ACESFilmicToneMapping,
  Box3,
  BoxGeometry,
  CatmullRomCurve3,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  RepeatWrapping,
  Scene,
  Shape,
  Spherical,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
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

// Car paint: a lacquered metallic, so the garage lights glint off a clear coat.
const paint = new MeshPhysicalMaterial({ color: cfg.paint || '#a3151c', metalness: 0.5, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.06 });
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

// ── where parts sit on each car ─────────────────────────────────────────────
// Measured points of the car body (metres, body space: +X front, +Y up, +Z the
// car's right). Parts are built from these, so the same part fits whichever car
// is on stage. HILUX_FIT was measured off the real model by ray-casting.

const HILUX_FIT = {
  front: 2.59, // nose of the front bumper
  bumperY: 0.82, // middle of the front bumper
  bumperLow: 0.6,
  rear: -2.69, // back of the rear bumper
  rearBumperY: 0.8,
  halfW: 0.91, // body side
  axleF: 1.602,
  axleR: -1.482,
  wheelR: 0.382,
  archTop: 1.1, // top of the wheel arch
  sillY: 0.58, // underside of the sill (door bottom)
  sillZ: 0.906,
  bonnetX: 1.75,
  bonnetY: 1.49,
  bonnetSlope: -0.113, // height change per metre forward
  cowlX: 1.2, // bottom of the windscreen
  cowlY: 1.57,
  roof: 2.0,
  roofFront: 0.42,
  roofBack: -0.88,
  roofHalfW: 0.64,
  pillarZ: 0.78, // A-pillar side at mid height
  cabBack: -0.99,
  bedRail: 1.495,
  bedBack: -2.64,
  bedHalfW: 0.8,
  bedFloor: 1.02,
};

/** The same points on the code-drawn fallback car. */
const DRAWN_FIT = {
  front: 2.74,
  bumperY: 0.72,
  bumperLow: 0.5,
  rear: -2.76,
  rearBumperY: 0.62,
  halfW: HALF_W,
  axleF: AXLE_F,
  axleR: AXLE_R,
  wheelR: WHEEL_R,
  archTop: 1.0,
  sillY: 0.47,
  sillZ: HALF_W,
  bonnetX: 1.86,
  bonnetY: 1.2,
  bonnetSlope: -0.067,
  cowlX: 1.3,
  cowlY: 1.25,
  roof: ROOF,
  roofFront: 0.55,
  roofBack: -0.75,
  roofHalfW: CAB_HALF_W - 0.04,
  pillarZ: CAB_HALF_W,
  cabBack: -1.04,
  bedRail: BELT,
  bedBack: -2.66,
  bedHalfW: HALF_W - 0.08,
  bedFloor: 0.85,
};

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
    fit: HILUX_FIT,
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
        // The source paint is a flat-colour texture. Every body panel gets the one
        // shared lacquer instead, which setPaint recolours (canopy included).
        o.material = Array.isArray(o.material) ? o.material.map((x) => (x === m ? paint : x)) : paint;
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
  return { body: holder, wheels, fit: spec.fit };
}

// ── sample parts ────────────────────────────────────────────────────────────
// One builder per fit-on slot (keys match src/garage/slots.ts), each built from
// the car's FIT points. Everything is in the car body's own space, so a lift kit
// raises fitted parts with the body.

const powder = new MeshStandardMaterial({ color: '#141515', metalness: 0.55, roughness: 0.42 });
const ribbed = new MeshStandardMaterial({ color: '#2a2c2c', metalness: 0.7, roughness: 0.35 });
const led = new MeshStandardMaterial({ color: '#fff8e8', emissive: '#ffe9b8', emissiveIntensity: 2.2, roughness: 0.2 });

const side = (fn) => group(fn(1), fn(-1));

/** A smooth bent tube through the given points (snorkels, hoops). */
function bentTube(points, r, mat) {
  const curve = new CatmullRomCurve3(points.map((p) => new Vector3(...p)), false, 'catmullrom', 0.2);
  const m = new Mesh(new TubeGeometry(curve, 48, r, 12, false), mat);
  m.castShadow = true;
  return m;
}

/** A round lamp facing forward (+X). */
function roundLamp(x, y, z, r) {
  const can = new Mesh(new CylinderGeometry(r, r * 0.9, 0.08, 20), powder);
  can.rotation.z = Math.PI / 2;
  can.position.set(x, y, z);
  const lens = new Mesh(new CylinderGeometry(r * 0.82, r * 0.82, 0.01, 20), led);
  lens.rotation.z = Math.PI / 2;
  lens.position.set(x + 0.041, y, z);
  return group(can, lens);
}

/** A flat ring sector (wheel-arch flare) standing in the car's side plane. */
function arch(inner, outer, from, to, depth, mat) {
  const s = new Shape();
  s.absarc(0, 0, outer, from, to, false);
  s.absarc(0, 0, inner, to, from, true);
  s.closePath();
  const geo = new ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 24 });
  geo.translate(0, 0, -depth / 2);
  const m = new Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

const PART_BUILDERS = {
  // Steel bull-bar bumper: a full-width beam over the stock bumper, a centre
  // hoop to the bonnet line, and two LED spot lamps. A matching rear step bumper.
  bumper: (f) => {
    const x = f.front + 0.05;
    const top = f.bonnetY - 0.06 + f.bonnetSlope * (f.front - f.bonnetX);
    const w = f.halfW + 0.03;
    const beam = slab([[0.14, 0.18], [0.1, -0.12], [-0.22, -0.2], [-0.26, 0.18]], w * 2, powder, 0.02);
    beam.position.set(x, f.bumperY, 0);
    const skid = box(0.36, 0.03, 0.9, ribbed, x - 0.12, f.bumperLow - 0.04, 0);
    skid.rotation.z = 0.25;
    return group(
      beam,
      skid,
      // centre hoop
      bentTube([[x - 0.02, f.bumperY + 0.16, 0.42], [x - 0.08, top, 0.38], [x - 0.08, top, -0.38], [x - 0.02, f.bumperY + 0.16, -0.42]], 0.032, powder),
      tube([x - 0.06, top - 0.16, 0.4], [x - 0.06, top - 0.16, -0.4], 0.022, powder),
      // wing tubes round the lamps
      side((s) => bentTube([[x - 0.04, f.bumperY + 0.16, s * 0.42], [x - 0.12, f.bumperY + 0.3, s * (w - 0.12)], [x - 0.3, f.bumperY + 0.16, s * w]], 0.026, powder)),
      roundLamp(x + 0.1, f.bumperY + 0.02, 0.62, 0.075),
      roundLamp(x + 0.1, f.bumperY + 0.02, -0.62, 0.075),
      // rear step bumper
      box(0.2, 0.2, w * 2, powder, f.rear - 0.08, f.rearBumperY - 0.08, 0),
      box(0.18, 0.025, 0.9, ribbed, f.rear - 0.12, f.rearBumperY + 0.03, 0),
    );
  },
  // Winch on a cradle under the grille (it sits inside the bull bar when both are fitted).
  winch: (f) => {
    const x = f.front + 0.16;
    const y = f.bumperY - 0.05;
    const drum = new Mesh(new CylinderGeometry(0.07, 0.07, 0.34, 20), ribbed);
    drum.rotation.x = Math.PI / 2;
    drum.position.set(x, y, 0);
    drum.castShadow = true;
    const motor = new Mesh(new CylinderGeometry(0.075, 0.075, 0.16, 20), powder);
    motor.rotation.x = Math.PI / 2;
    motor.position.set(x, y, 0.25);
    const fairlead = box(0.03, 0.09, 0.26, steel, x + 0.1, y, 0);
    const hook = new Mesh(new TorusGeometry(0.035, 0.01, 8, 16, Math.PI * 1.5), chrome);
    hook.position.set(x + 0.14, y - 0.06, 0);
    return group(drum, motor, box(0.14, 0.15, 0.1, powder, x, y, -0.22), fairlead, hook, box(0.2, 0.03, 0.6, powder, x - 0.02, y - 0.1, 0));
  },
  // Raised air intake: into the left fender ahead of the windscreen, up the A-pillar, ram head at roof height.
  snorkel: (f) => {
    const z = -(f.halfW + 0.035);
    const zp = -(f.pillarZ + 0.11);
    const xTop = f.roofFront + 0.12;
    const yTop = f.roof + 0.08;
    const pipe = bentTube(
      [
        [f.cowlX + 0.42, f.archTop + 0.14, z],
        [f.cowlX + 0.1, f.archTop + 0.2, z],
        [f.cowlX - 0.06, f.cowlY + 0.05, (z + zp) / 2],
        [(f.cowlX + xTop) / 2 - 0.05, (f.cowlY + yTop) / 2 + 0.02, zp],
        [xTop, yTop, zp],
      ],
      0.05,
      powder,
    );
    const head = slab([[0.16, 0.08], [0.18, -0.06], [-0.08, -0.08], [-0.1, 0.06]], 0.17, powder, 0.03);
    head.position.set(xTop + 0.04, yTop + 0.06, zp);
    return group(pipe, head, box(0.18, 0.12, 0.012, powder, f.cowlX + 0.42, f.archTop + 0.12, z - 0.02));
  },
  // Bolt-on flares round all four arches.
  'fender-flare': (f) => {
    const r = f.archTop - f.wheelR;
    const one = (x, s) => {
      const m = arch(r - 0.03, r + 0.09, 0.12, Math.PI - 0.12, 0.12, powder);
      m.position.set(x, f.wheelR, s * (f.sillZ + 0.03));
      return m;
    };
    return group(one(f.axleF, 1), one(f.axleF, -1), one(f.axleR, 1), one(f.axleR, -1));
  },
  // Steel side steps between the arches, with a ribbed tread.
  'side-step': (f) => {
    const x0 = f.axleF - (f.archTop - f.wheelR) - 0.06;
    const x1 = f.axleR + (f.archTop - f.wheelR) + 0.06;
    const len = x0 - x1;
    const mid = (x0 + x1) / 2;
    const y = f.sillY - 0.08;
    return side((s) => {
      const g = group(
        box(len, 0.06, 0.24, powder, mid, y, s * (f.sillZ + 0.06)),
        box(len - 0.12, 0.012, 0.18, ribbed, mid, y + 0.036, s * (f.sillZ + 0.06)),
      );
      [x0 - 0.35, mid, x1 + 0.35].forEach((bx) => g.add(box(0.05, 0.08, 0.16, powder, bx, y + 0.06, s * (f.sillZ - 0.02))));
      return g;
    });
  },
  // Bonnet scoop lying on the bonnet's slope.
  'bonnet-hood': (f) => {
    const scoop = slab([[0.4, -0.02], [0.33, 0.11], [-0.34, 0.05], [-0.4, -0.02]], 0.7, gloss, 0.03);
    const mouth = box(0.02, 0.07, 0.56, rubber, 0.36, 0.05, 0);
    const g = group(scoop, mouth);
    g.position.set(f.bonnetX - 0.05, f.bonnetY + f.bonnetSlope * -0.05, 0);
    g.rotation.z = Math.atan(f.bonnetSlope);
    return g;
  },
  // Sports bar in the bed: hoop behind the cab, braces back to the rails, LED bar on top.
  'roll-bar': (f) => {
    const x = f.cabBack - 0.22;
    const z = f.bedHalfW - 0.03;
    const h = Math.min(f.roof - 0.04, f.bedRail + 0.48);
    const g = group(
      bentTube([[x, f.bedRail, z], [x, h - 0.08, z - 0.04], [x, h, z - 0.16], [x, h, -(z - 0.16)], [x, h - 0.08, -(z - 0.04)], [x, f.bedRail, -z]], 0.04, powder),
      side((s) => tube([x - 0.02, h - 0.12, s * (z - 0.05)], [x - 0.85, f.bedRail + 0.02, s * z], 0.032, powder)),
      side((s) => box(0.14, 0.02, 0.12, powder, x, f.bedRail + 0.01, s * z)),
    );
    const bar = box(0.07, 0.07, 0.9, powder, x + 0.02, h + 0.06, 0);
    const glow = box(0.01, 0.04, 0.86, led, x + 0.06, h + 0.06, 0);
    g.add(bar, glow);
    return g;
  },
  // Roller shutter over the bed: canister at the front, slatted cover to the tailgate.
  'roller-shutter': (f) => {
    const x0 = f.cabBack - 0.05;
    const len = x0 - (f.bedBack + 0.02);
    const w = (f.bedHalfW + 0.04) * 2;
    const lid = group(
      box(len, 0.03, w, ribbed, x0 - len / 2, f.bedRail + 0.02, 0),
      box(0.22, 0.12, w, powder, x0 - 0.11, f.bedRail + 0.06, 0),
      side((s) => box(len, 0.04, 0.03, powder, x0 - len / 2, f.bedRail + 0.03, s * (w / 2))),
    );
    for (let i = 0; i < Math.floor((len - 0.3) / 0.09); i += 1) lid.add(box(0.012, 0.006, w - 0.04, steel, x0 - 0.3 - i * 0.09, f.bedRail + 0.038, 0));
    return lid;
  },
  // Body-colour canopy over the bed, with tinted side and rear windows.
  canopy: (f) => {
    const x0 = f.cabBack - 0.04;
    const x1 = f.bedBack + 0.02;
    const len = x0 - x1;
    const top = f.roof - 0.02;
    const shell = slab([[0, 0], [0, top - f.bedRail], [-len + 0.12, top - f.bedRail - 0.02], [-len, top - f.bedRail - 0.12], [-len, 0]], (f.bedHalfW + 0.06) * 2, paint, 0.04);
    shell.position.set(x0, f.bedRail, 0);
    const winY = f.bedRail + (top - f.bedRail) * 0.58;
    const winH = (top - f.bedRail) * 0.42;
    return group(
      shell,
      side((s) => box(len - 0.4, winH, 0.01, glass, (x0 + x1) / 2 + 0.05, winY, s * (f.bedHalfW + 0.065))),
      box(0.01, winH, (f.bedHalfW - 0.1) * 2, glass, x1 - 0.005, winY - 0.03, 0),
      box(len, 0.03, (f.bedHalfW + 0.06) * 2, trim, (x0 + x1) / 2, f.bedRail + 0.01, 0),
    );
  },
  // Flat platform rack on the roof with a wind deflector at the front.
  'roof-rack': (f) => {
    const y = f.roof + 0.09;
    const z = f.roofHalfW - 0.02;
    const xf = f.roofFront - 0.02;
    const xb = f.roofBack + 0.04;
    const rack = group(
      box(xf - xb, 0.04, 0.05, powder, (xf + xb) / 2, y, z),
      box(xf - xb, 0.04, 0.05, powder, (xf + xb) / 2, y, -z),
      box(0.05, 0.04, z * 2, powder, xf, y, 0),
      box(0.05, 0.04, z * 2, powder, xb, y, 0),
    );
    for (let x = xf - 0.15; x > xb + 0.05; x -= 0.16) rack.add(box(0.06, 0.02, z * 2 - 0.04, ribbed, x, y + 0.005, 0));
    const deflector = box(0.02, 0.09, z * 2, powder, xf + 0.03, y + 0.02, 0);
    deflector.rotation.z = -0.5;
    rack.add(deflector);
    [xf - 0.12, (xf + xb) / 2, xb + 0.12].forEach((x) => {
      rack.add(box(0.05, y - f.roof + 0.04, 0.05, powder, x, f.roof - 0.02 + (y - f.roof) / 2, z));
      rack.add(box(0.05, y - f.roof + 0.04, 0.05, powder, x, f.roof - 0.02 + (y - f.roof) / 2, -z));
    });
    return rack;
  },
};

/** Not a bolt-on: a lift kit raises the body and fits taller tyres. */
const LIFT_KEY = 'lift-kit';
const LIFT_BODY = 0.13;
const LIFT_WHEEL = 1.1;
/** How far above its place a newly fitted part starts. */
const PART_DROP = 0.35;

/**
 * Where the camera goes when a slot is chosen, so the part is in view (as in
 * motorbike configurators). [turn around the car (0 = straight at the front,
 * + towards its right side), height angle from straight down, distance].
 */
const FOCUS = {
  paint: [0.78, 1.3, 1],
  bumper: [0.35, 1.38, 0.78],
  winch: [0.2, 1.4, 0.72],
  'bonnet-hood': [0.45, 1.02, 0.82],
  snorkel: [-0.75, 1.3, 0.85],
  'fender-flare': [1.25, 1.42, 0.98],
  'side-step': [1.45, 1.42, 1],
  'lift-kit': [1.35, 1.45, 1],
  'roll-bar': [2.35, 1.12, 0.9],
  'roller-shutter': [2.5, 0.95, 0.9],
  canopy: [2.3, 1.2, 0.95],
  'roof-rack': [0.95, 0.85, 0.95],
};

// ── the garage ──────────────────────────────────────────────────────────────
// An underground workshop: raw concrete with tags on it, neon on the walls,
// strip lights and ducts overhead, a wet floor, tyres and tools lying about.

const ROOM_X = 8.5; // half the room's width (along the car)
const ROOM_Z = 8.5; // half its depth
const ROOM_H = 5.0;
const PLINTH_H = 0; // the car stands on the floor, like in a real workshop

/** A picture drawn in code, so the garage needs no image files. */
function canvasTexture(w, h, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Deterministic noise, so the garage looks the same every time it opens. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function grime(g, w, h, rand, base, spots) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < spots; i += 1) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 4 + rand() * 60;
    const dark = rand() < 0.6;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, dark ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.06)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

const TAG_COLOURS = ['#e2336b', '#2ec4d6', '#8b5cf6', '#f2c14e', '#e85d2a', '#ffffff', '#46d37d'];
const TAG_WORDS = ['4X4', 'OFF ROAD', 'TRAIL', 'MUD', 'LIFTED', 'TORQUE', 'DIESEL', 'SEND IT'];

function concreteWall(g, w, h) {
  const rand = rng(7);
  grime(g, w, h, rand, '#4a4846', 900);
  // Formwork panel seams and tie holes.
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 3;
  for (let x = 0; x <= w; x += w / 4) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, h);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(0, h * 0.5);
  g.lineTo(w, h * 0.5);
  g.stroke();
  g.fillStyle = 'rgba(0,0,0,0.45)';
  for (let x = w / 8; x < w; x += w / 4) {
    for (const y of [h * 0.25, h * 0.75]) {
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Water stains running down from the top.
  for (let i = 0; i < 40; i += 1) {
    const x = rand() * w;
    const len = h * (0.15 + rand() * 0.5);
    const grad = g.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, 'rgba(20,16,12,0.45)');
    grad.addColorStop(1, 'rgba(20,16,12,0)');
    g.fillStyle = grad;
    g.fillRect(x, 0, 3 + rand() * 14, len);
  }
  // Graffiti tags along the lower half.
  for (let i = 0; i < 14; i += 1) {
    const x = (i + rand() * 0.4) * (w / 14);
    const y = h * (0.45 + rand() * 0.45);
    const colour = TAG_COLOURS[Math.floor(rand() * TAG_COLOURS.length)];
    g.save();
    g.translate(x, y);
    g.rotate((rand() - 0.5) * 0.3);
    if (rand() < 0.55) {
      const word = TAG_WORDS[Math.floor(rand() * TAG_WORDS.length)];
      g.font = `900 ${Math.round(h * (0.1 + rand() * 0.09))}px Impact, 'Arial Black', sans-serif`;
      g.lineJoin = 'round';
      g.lineWidth = 14;
      g.strokeStyle = 'rgba(10,10,10,0.85)';
      g.strokeText(word, 0, 0);
      g.fillStyle = colour;
      g.globalAlpha = 0.85;
      g.fillText(word, 0, 0);
    } else {
      g.strokeStyle = colour;
      g.globalAlpha = 0.8;
      g.lineWidth = 3 + rand() * 4;
      g.beginPath();
      g.moveTo(0, 0);
      for (let k = 0; k < 7; k += 1) g.bezierCurveTo(rand() * 90 - 20, -rand() * 70, rand() * 110, rand() * 40, 20 + k * 22, (rand() - 0.5) * 40);
      g.stroke();
    }
    g.restore();
  }
}

function concreteFloor(g, w, h) {
  const rand = rng(11);
  grime(g, w, h, rand, '#2e2f30', 700);
  // Oil patches.
  for (let i = 0; i < 10; i += 1) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 20 + rand() * 70;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(5,5,8,0.55)');
    grad.addColorStop(1, 'rgba(5,5,8,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(x, y, r, r * (0.5 + rand() * 0.5), rand() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // Saw-cut joints.
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, 1);
  g.lineTo(w, 1);
  g.moveTo(1, 0);
  g.lineTo(1, h);
  g.stroke();
}

function ceilingConcrete(g, w, h) {
  grime(g, w, h, rng(3), '#242424', 300);
}

/** Bay lines painted on the floor round the car. */
function bayLines(g, w, h) {
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(230,230,220,0.75)';
  g.lineWidth = 14;
  g.strokeRect(20, 20, w - 40, h - 40);
  g.globalAlpha = 0.85;
  g.strokeStyle = ACCENT;
  g.lineWidth = 10;
  for (let x = 60; x < w - 60; x += 70) {
    g.beginPath();
    g.moveTo(x, h - 20);
    g.lineTo(x + 40, h - 60);
    g.stroke();
  }
}

/** A glowing neon sign: the tube itself (text or a path) on a transparent board. */
function neonTexture(draw, colour, w = 512, h = 256) {
  return canvasTexture(w, h, (g) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = colour;
    g.fillStyle = colour;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const [blur, alpha, width] of [[40, 0.5, 18], [18, 0.8, 10], [0, 1, 5]]) {
      g.shadowColor = colour;
      g.shadowBlur = blur;
      g.globalAlpha = alpha;
      g.lineWidth = width;
      draw(g, w, h);
    }
    // The bright core of the tube.
    g.shadowBlur = 0;
    g.globalAlpha = 0.9;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    draw(g, w, h);
  });
}

function neonSign(tex, width, height) {
  const m = new Mesh(new PlaneGeometry(width, height), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  return m;
}

function tyre(r, wdt) {
  const t = new Mesh(new TorusGeometry(r - wdt * 0.45, wdt * 0.5, 10, 28), rubber);
  t.scale.z = 1.4;
  t.castShadow = true;
  t.receiveShadow = true;
  const rim = new Mesh(new CylinderGeometry(r * 0.55, r * 0.55, wdt * 0.8, 20), powder);
  rim.rotation.x = Math.PI / 2;
  return group(t, rim);
}

function buildGarage(scene, lights) {
  const wallTex = canvasTexture(2048, 512, concreteWall, 2, 1);
  const wallMat = new MeshStandardMaterial({ map: wallTex, roughness: 0.92, metalness: 0 });
  // Four walls as separate planes, so each gets the tags the right way up.
  const walls = [
    [ROOM_X * 2, [0, ROOM_H / 2, -ROOM_Z], 0],
    [ROOM_X * 2, [0, ROOM_H / 2, ROOM_Z], Math.PI],
    [ROOM_Z * 2, [-ROOM_X, ROOM_H / 2, 0], Math.PI / 2],
    [ROOM_Z * 2, [ROOM_X, ROOM_H / 2, 0], -Math.PI / 2],
  ];
  walls.forEach(([len, pos, ry]) => {
    const m = new Mesh(new PlaneGeometry(len, ROOM_H), wallMat);
    m.position.set(...pos);
    m.rotation.y = ry;
    m.receiveShadow = true;
    scene.add(m);
  });

  const floorMat = new MeshStandardMaterial({ map: canvasTexture(512, 512, concreteFloor, ROOM_X / 2, ROOM_Z / 2), roughness: 0.5, metalness: 0.12, envMapIntensity: 0.35 });
  const floor = new Mesh(new PlaneGeometry(ROOM_X * 2, ROOM_Z * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const bay = new Mesh(new PlaneGeometry(7.2, 3.8), new MeshStandardMaterial({ map: canvasTexture(1024, 540, bayLines), transparent: true, roughness: 0.5, depthWrite: false }));
  bay.rotation.x = -Math.PI / 2;
  bay.position.y = 0.004;
  bay.receiveShadow = true;
  scene.add(bay);

  const ceiling = new Mesh(new PlaneGeometry(ROOM_X * 2, ROOM_Z * 2), new MeshStandardMaterial({ map: canvasTexture(256, 256, ceilingConcrete, 4, 4), roughness: 1 }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ROOM_H;
  scene.add(ceiling);

  // Ducts and pipes overhead.
  const duct = new MeshStandardMaterial({ color: '#3b3d3f', metalness: 0.7, roughness: 0.45 });
  const pipeRed = new MeshStandardMaterial({ color: '#6d1a1a', metalness: 0.3, roughness: 0.6 });
  const pipeGrey = new MeshStandardMaterial({ color: '#555a5c', metalness: 0.5, roughness: 0.5 });
  scene.add(box(ROOM_X * 2, 0.45, 0.7, duct, 0, ROOM_H - 0.32, -ROOM_Z + 1.6));
  scene.add(box(0.6, 0.4, ROOM_Z * 2, duct, -ROOM_X + 1.8, ROOM_H - 0.3, 0));
  for (let x = -ROOM_X + 1; x < ROOM_X; x += 2.2) scene.add(box(0.05, 0.47, 0.72, pipeGrey, x, ROOM_H - 0.32, -ROOM_Z + 1.6));
  scene.add(tube([-ROOM_X, ROOM_H - 0.15, -ROOM_Z + 0.4], [ROOM_X, ROOM_H - 0.15, -ROOM_Z + 0.4], 0.06, pipeRed));
  scene.add(tube([-ROOM_X, ROOM_H - 0.25, ROOM_Z - 2.5], [ROOM_X, ROOM_H - 0.25, ROOM_Z - 2.5], 0.05, pipeGrey));
  scene.add(tube([-ROOM_X + 0.15, 0, -ROOM_Z + 0.4], [-ROOM_X + 0.15, ROOM_H, -ROOM_Z + 0.4], 0.05, pipeRed));
  scene.add(tube([ROOM_X - 0.15, 0, -ROOM_Z + 2.6], [ROOM_X - 0.15, ROOM_H, -ROOM_Z + 2.6], 0.04, pipeGrey));

  // Fluorescent strip lights.
  const stripLit = new MeshBasicMaterial({ color: '#f4f8ff', toneMapped: false });
  const housing = new MeshStandardMaterial({ color: '#1b1c1d', metalness: 0.6, roughness: 0.5 });
  [[-2.4, -1.6], [2.4, -1.6], [-2.4, 1.6], [2.4, 1.6], [0, 4.6], [-6, -4], [6, -4]].forEach(([x, z]) => {
    scene.add(box(2.6, 0.08, 0.2, housing, x, ROOM_H - 0.08, z));
    scene.add(box(2.4, 0.04, 0.07, stripLit, x, ROOM_H - 0.14, z));
  });

  // Neon: a pink tube on the left wall, signs on the back wall.
  const pink = new MeshBasicMaterial({ color: '#ff4f8b', toneMapped: false });
  const tubePink = box(4.5, 0.05, 0.05, pink, 4.5, 3.5, -ROOM_Z + 0.06);
  scene.add(tubePink);
  const word = neonSign(
    neonTexture((g, w, h) => {
      g.font = `900 ${Math.round(h * 0.55)}px 'Arial Black', Impact, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.strokeText('GARAGE', w / 2, h / 2);
    }, '#ff3d7f', 1024, 256),
    3.4,
    0.85,
  );
  word.position.set(-ROOM_X + 0.05, 3.1, 0.6);
  word.rotation.y = Math.PI / 2;
  scene.add(word);
  const wrench = neonSign(
    neonTexture((g, w, h) => {
      // A spanner: two open jaws joined by a handle.
      g.beginPath();
      g.arc(w * 0.22, h * 0.5, h * 0.26, 0.6, Math.PI * 2 - 0.6);
      g.moveTo(w * 0.22 + h * 0.2, h * 0.42);
      g.lineTo(w * 0.78 - h * 0.2, h * 0.42);
      g.moveTo(w * 0.22 + h * 0.2, h * 0.58);
      g.lineTo(w * 0.78 - h * 0.2, h * 0.58);
      g.moveTo(w * 0.78 + h * 0.1, h * 0.28);
      g.arc(w * 0.78, h * 0.5, h * 0.26, Math.PI + 0.6, Math.PI - 0.6);
      g.stroke();
    }, '#2ee6f0'),
    1.7,
    0.85,
  );
  wrench.position.set(-3.6, 2.6, -ROOM_Z + 0.05);
  scene.add(wrench);
  const gear = neonSign(
    neonTexture((g, w, h) => {
      const cx = w / 2;
      const cy = h / 2;
      const R = h * 0.36;
      g.beginPath();
      for (let i = 0; i <= 24; i += 1) {
        const a = (i / 24) * Math.PI * 2;
        const r = i % 2 ? R : R * 0.8;
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.moveTo(cx + R * 0.35, cy);
      g.arc(cx, cy, R * 0.35, 0, Math.PI * 2);
      g.stroke();
    }, '#9b6bff', 256, 256),
    1.1,
    1.1,
  );
  gear.position.set(0.4, 2.7, -ROOM_Z + 0.05);
  scene.add(gear);
  const red = new MeshBasicMaterial({ color: '#ff2a3d', toneMapped: false });
  const tubeRed = box(0.05, 0.05, 3.2, red, -ROOM_X + 0.06, 3.9, -4.5);
  scene.add(tubeRed);
  // The neon actually lights the room (and the car's paint).
  lights.push([new PointLight('#ff3d7f', 9, 9, 1.6), [-2.5, 3.2, -ROOM_Z + 0.8]]);
  lights.push([new PointLight('#7d5cff', 7, 8, 1.6), [0.4, 2.6, -ROOM_Z + 0.8]]);
  lights.push([new PointLight('#25d9e6', 6, 8, 1.6), [-3.6, 2.5, -ROOM_Z + 0.8]]);
  lights.push([new PointLight('#ff3d7f', 8, 9, 1.6), [-ROOM_X + 0.8, 3, 0.6]]);

  // Metal stairs up the back-left corner.
  const stairMat = new MeshStandardMaterial({ color: '#2c2f31', metalness: 0.7, roughness: 0.5 });
  for (let i = 0; i < 14; i += 1) scene.add(box(0.28, 0.04, 1.1, stairMat, -ROOM_X + 0.6 + i * 0.27, 0.3 + i * 0.3, -ROOM_Z + 3.4));
  scene.add(tube([-ROOM_X + 0.5, 1.2, -ROOM_Z + 2.85], [-ROOM_X + 4.3, 4.5, -ROOM_Z + 2.85], 0.03, stairMat));
  scene.add(tube([-ROOM_X + 0.5, 1.2, -ROOM_Z + 3.95], [-ROOM_X + 4.3, 4.5, -ROOM_Z + 3.95], 0.03, stairMat));

  // Shelving with boxes and cans against the right wall.
  const shelfMat = new MeshStandardMaterial({ color: '#5a1d1d', metalness: 0.5, roughness: 0.55 });
  const sx = ROOM_X - 0.45;
  const sz = -ROOM_Z + 3;
  [-1.1, 1.1].forEach((dz) => [-0.3, 0.3].forEach((dx) => scene.add(box(0.05, 2.6, 0.05, shelfMat, sx + dx, 1.3, sz + dz))));
  const stock = ['#c23b22', '#2b6cb0', '#d69e2e', '#2f855a', '#e2e8f0', '#1a202c', '#9b2c2c'];
  const rand = rng(5);
  [0.4, 1.1, 1.8, 2.5].forEach((y) => {
    scene.add(box(0.65, 0.04, 2.3, shelfMat, sx, y, sz));
    for (let z = sz - 1; z < sz + 1; z += 0.22 + rand() * 0.18) {
      const hgt = 0.12 + rand() * 0.3;
      const mat = new MeshStandardMaterial({ color: stock[Math.floor(rand() * stock.length)], roughness: 0.6, metalness: rand() * 0.4 });
      scene.add(rand() < 0.5 ? box(0.3 + rand() * 0.2, hgt, 0.16, mat, sx, y + 0.02 + hgt / 2, z) : new Mesh(new CylinderGeometry(0.06, 0.06, hgt, 12), mat).translateX(sx).translateY(y + 0.02 + hgt / 2).translateZ(z));
    }
  });

  // Red tool chest.
  const chestMat = new MeshStandardMaterial({ color: '#8f1d1d', metalness: 0.45, roughness: 0.4 });
  const cx = ROOM_X - 0.6;
  const cz = -1.2;
  scene.add(box(0.7, 1.0, 1.4, chestMat, cx, 0.55, cz));
  for (let i = 0; i < 5; i += 1) scene.add(box(0.02, 0.02, 1.1, chrome, cx - 0.36, 0.25 + i * 0.17, cz));
  scene.add(box(0.75, 0.04, 1.45, rubber, cx, 1.07, cz));

  // Spare tyres: one stack and a few lying about.
  [[-ROOM_X + 0.7, 4.6], [-ROOM_X + 0.7, 4.6], [-ROOM_X + 0.7, 4.6]].forEach(([x, z], i) => {
    const t = tyre(0.42, 0.28);
    t.rotation.x = Math.PI / 2;
    t.position.set(x, 0.15 + i * 0.29, z);
    scene.add(t);
  });
  [[-ROOM_X + 1.6, 3.6, 0.4], [3.2, -ROOM_Z + 1.1, -0.6]].forEach(([x, z, ry]) => {
    const t = tyre(0.42, 0.28);
    t.rotation.set(Math.PI / 2, 0, ry);
    t.position.set(x, 0.15, z);
    scene.add(t);
  });
  const lean = tyre(0.42, 0.28);
  lean.rotation.set(0, 0.4, 0.2);
  lean.position.set(2.2, 0.42, -ROOM_Z + 0.5);
  scene.add(lean);

  // Tools on the floor.
  const toolMat = new MeshStandardMaterial({ color: '#9aa0a3', metalness: 0.9, roughness: 0.3 });
  [[1.2, -3.2, 0.3], [2.1, -3.9, -0.8], [-4.1, 2.6, 1.2], [3.4, -3.1, 0.5], [-3.8, -3.2, -0.3]].forEach(([x, z, ry]) => {
    const spanner = box(0.32, 0.015, 0.035, toolMat, x, 0.01, z);
    spanner.rotation.y = ry;
    scene.add(spanner);
  });
  const jack = group(box(0.6, 0.08, 0.28, chestMat, 0, 0.06, 0), tube([0.2, 0.1, 0], [0.9, 0.5, 0], 0.02, toolMat));
  jack.position.set(-4.4, 0, -3.4);
  jack.rotation.y = 0.6;
  scene.add(jack);
}

// ── scene ───────────────────────────────────────────────────────────────────

const TARGET_Y = PLINTH_H + 0.95;
/** Camera distance of the opening view; FOCUS distances are shares of it. Inside the room on every side. */
const START_DISTANCE = 7.6;
/** Half the car's width on screen in the three-quarter view it opens in. */
const CAR_HALF_SPAN = 3.0;

/** Camera position for a FOCUS entry: turn from the car's front (+X) towards its right (+Z). */
function focusPosition([turn, polar, share]) {
  const sph = new Spherical(START_DISTANCE * share, polar, Math.PI / 2 - turn);
  return new Vector3().setFromSpherical(sph).add(new Vector3(0, TARGET_Y, 0));
}

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
  scene.background = new Color('#0d0d0f');
  scene.fog = new Fog('#0d0d0f', 13, 26);

  const camera = new PerspectiveCamera(40, 1, 0.1, 80);
  camera.position.copy(focusPosition(FOCUS.paint));

  // The room environment is what the paint and chrome reflect.
  scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  scene.add(new HemisphereLight('#d8e2ff', '#1a1412', 0.35));
  // The strip lights overhead: one shadow-casting key straight down on the car,
  // two soft points for the bodywork, and a cool rim from behind.
  const key = new DirectionalLight('#f3f6ff', 2.0);
  key.position.set(1.5, 9, 2.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -5;
  key.shadow.radius = 6;
  key.shadow.bias = -0.0005;
  scene.add(key);
  const stripA = new PointLight('#eef3ff', 12, 9, 1.8);
  stripA.position.set(-2.4, 3.6, 1.6);
  stripA.position.y = ROOM_H - 0.4;
  const stripB = new PointLight('#eef3ff', 12, 9, 1.8);
  stripB.position.set(2.4, 3.6, -1.6);
  stripB.position.y = ROOM_H - 0.4;
  const rim = new DirectionalLight('#9fb8ff', 0.8);
  rim.position.set(-6, 3, -6);
  scene.add(stripA, stripB, rim);
  const neon = [];
  buildGarage(scene, neon);
  neon.forEach(([light, pos]) => {
    light.position.set(...pos);
    scene.add(light);
  });

  // A soft dark patch under the car, so it sits on the floor rather than floating.
  const contact = new Mesh(
    new PlaneGeometry(6.4, 3),
    new MeshBasicMaterial({
      map: canvasTexture(256, 128, (g, w, h) => {
        const grad = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
        grad.addColorStop(0, 'rgba(0,0,0,0.85)');
        grad.addColorStop(0.55, 'rgba(0,0,0,0.5)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.setTransform(1, 0, 0, h / w, 0, 0);
        g.fillStyle = grad;
        g.fillRect(0, 0, w, w);
      }),
      transparent: true,
      depthWrite: false,
    }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.008;
  scene.add(contact);

  // The car, standing on the plinth. Its body and wheels arrive in showCar():
  // the real model when the app sends one, else the code-drawn sample.
  const car = new Group();
  car.position.y = PLINTH_H;
  scene.add(car);
  let body = new Group();
  let wheels = [];
  let fit = DRAWN_FIT;
  let carShown = false;

  function showCar(next) {
    body = next.body;
    wheels = next.wheels;
    fit = next.fit;
    car.add(body);
    // Wheels hang off the car, not the body, so the lift kit can raise the body over them.
    wheels.forEach((w) => car.attach(w));
    paint.color.set(currentPaint);
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
    showCar({ body: buildBody(), wheels: drawn, fit: DRAWN_FIT });
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
  controls.minDistance = 4.2;
  controls.maxDistance = START_DISTANCE + 0.3; // never through a wall
  // Highest the camera may go: just under the ducts and strip lights.
  controls.minPolarAngle = Math.acos((ROOM_H - 0.8 - TARGET_Y) / controls.maxDistance);
  controls.maxPolarAngle = Math.PI / 2 - 0.06;
  controls.autoRotate = !cfg.still;
  controls.autoRotateSpeed = 0.7;
  // The moment the customer takes hold of the car, it is theirs to turn.
  controls.addEventListener('start', () => {
    controls.autoRotate = false;
    glide = null;
  });

  // Camera glide to the chosen part (see FOCUS). Cancelled the moment the customer drags.
  let glide = null;
  function focus(key) {
    const preset = FOCUS[key];
    if (!preset) return;
    const to = [preset[0], Math.max(preset[1], controls.minPolarAngle), preset[2]];
    controls.autoRotate = false;
    const end = focusPosition(to);
    if (cfg.still) {
      camera.position.copy(end);
      controls.update();
      redraw();
      return;
    }
    const from = new Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    const goal = new Spherical().setFromVector3(end.sub(controls.target));
    // Turn the short way round.
    let dTheta = goal.theta - from.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    glide = { from, dTheta, goal, t: 0 };
    redraw();
  }

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
      // Wrapped, so the drop-in below moves the wrapper and never the part's own placement.
      const node = group(build(fit));
      // A new part drops into place from just above.
      node.position.y = cfg.still ? 0 : PART_DROP;
      body.add(node);
      fitted.set(k, { node, fit: cfg.still ? 1 : 0 });
    });
    redraw();
  }

  function setPaint(hex) {
    try {
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
      currentPaint = hex;
      paint.color.set(hex);
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

    if (glide) {
      glide.t = Math.min(1, glide.t + dt / 0.9);
      const e = glide.t < 0.5 ? 4 * glide.t ** 3 : 1 - (-2 * glide.t + 2) ** 3 / 2;
      const sph = new Spherical(
        glide.from.radius + (glide.goal.radius - glide.from.radius) * e,
        glide.from.phi + (glide.goal.phi - glide.from.phi) * e,
        glide.from.theta + glide.dTheta * e,
      );
      camera.position.setFromSpherical(sph).add(controls.target);
      if (glide.t >= 1) glide = null;
    }
    let moving = controls.update() || glide !== null;
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
        entry.node.position.y = PART_DROP * (1 - e);
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
  window.showroom = { setParts, setPaint, setInsets, focus, modelChunk, modelFailed: () => modelFailed('app-could-not-read') };
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
    if (msg.type === 'focus' && typeof msg.key === 'string') focus(msg.key);
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
