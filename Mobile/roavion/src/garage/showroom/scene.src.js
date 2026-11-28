/**
 * The 3D showroom scene — runs INSIDE the WebView, not in React Native.
 *
 * This file is bundled together with three.js by `npm run build:showroom` into
 * `sceneBundle.generated.ts` (one self-contained script string). Edit here, then
 * re-run the build; a test fails if the bundle is stale.
 *
 * The car and every part are drawn in code as a SAMPLE (no artist-made 3D files
 * exist yet). Each part is a named group on the car, so swapping a sample part
 * for a real model later only changes how that one group is built.
 *
 * Page API (called from the app with injectJavaScript):
 *   window.showroom.setParts(['bumper', 'snorkel'])   – what is fitted
 *   window.showroom.setPaint('#f4f4f2')               – body colour
 * The page posts {type:'ready'} once the first frame is drawn, and
 * {type:'error', message} if WebGL is unavailable.
 *
 * Units are metres. +X is the front of the car, +Y is up.
 */
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  CircleGeometry,
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
  RingGeometry,
  Scene,
  ShadowMaterial,
  Shape,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const cfg = window.__SHOWROOM__ || {};
const BG = cfg.bg || '#f5f7f6';
const ACCENT = cfg.accent || '#0a5c33';

function post(msg) {
  const text = JSON.stringify(msg);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(text);
  else if (window.parent && window.parent !== window) window.parent.postMessage(text, '*');
}

// ── materials ───────────────────────────────────────────────────────────────

const paint = new MeshStandardMaterial({ color: cfg.paint || '#f4f4f2', metalness: 0.55, roughness: 0.32 });
const glass = new MeshStandardMaterial({ color: '#16201c', metalness: 0.7, roughness: 0.12 });
const trim = new MeshStandardMaterial({ color: '#1b1d1d', metalness: 0.2, roughness: 0.75 });
const steel = new MeshStandardMaterial({ color: '#111313', metalness: 0.6, roughness: 0.45 });
const chrome = new MeshStandardMaterial({ color: '#c9cdcc', metalness: 0.9, roughness: 0.25 });
const rubber = new MeshStandardMaterial({ color: '#141414', metalness: 0, roughness: 0.95 });
const lamp = new MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6d8', emissiveIntensity: 0.9, roughness: 0.3 });
const tail = new MeshStandardMaterial({ color: '#b3122f', emissive: '#7a0a1e', emissiveIntensity: 0.6, roughness: 0.4 });
const bedLiner = new MeshStandardMaterial({ color: '#232626', metalness: 0.1, roughness: 0.9 });

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

// ── the sample pickup ───────────────────────────────────────────────────────

const HALF_W = 0.9; // half the body width
const AXLE_F = 1.62;
const AXLE_R = -1.5;
const WHEEL_R = 0.39;

function buildBody() {
  // Side outline of a double-cab pickup, with the two wheel arches cut in.
  const s = new Shape();
  const arch = (cx) => {
    const a = Math.asin(0.12 / 0.5);
    s.lineTo(cx - 0.485, 0.5);
    s.absarc(cx, 0.38, 0.5, Math.PI - a, a, true);
  };
  s.moveTo(-2.66, 0.5);
  arch(AXLE_R);
  arch(AXLE_F);
  s.lineTo(2.56, 0.5);
  s.lineTo(2.66, 0.62);
  s.lineTo(2.66, 0.98);
  s.lineTo(2.56, 1.1); // bonnet lip
  s.lineTo(1.28, 1.2); // base of the windscreen
  s.lineTo(0.58, 1.8); // roof, front
  s.lineTo(-0.74, 1.82); // roof, rear
  s.lineTo(-0.86, 1.14); // back of the cab
  s.lineTo(-2.66, 1.14); // bed rail
  s.closePath();

  const geo = new ExtrudeGeometry(s, { depth: HALF_W * 2 - 0.08, bevelEnabled: true, bevelSize: 0.04, bevelOffset: -0.04, bevelThickness: 0.04, bevelSegments: 3, curveSegments: 20 });
  geo.translate(0, 0, -(HALF_W - 0.04));
  const shell = new Mesh(geo, paint);
  shell.castShadow = true;

  // Greenhouse: one dark slab a hair wider than the cab shows as the side glass.
  const g = new Shape();
  g.moveTo(-0.72, 1.24);
  g.lineTo(1.12, 1.24);
  g.lineTo(0.56, 1.72);
  g.lineTo(-0.66, 1.74);
  g.closePath();
  const sideGlassGeo = new ExtrudeGeometry(g, { depth: HALF_W * 2 + 0.012, bevelEnabled: false });
  sideGlassGeo.translate(0, 0, -(HALF_W + 0.006));
  const sideGlass = new Mesh(sideGlassGeo, glass);
  // Door pillars, painted, over the glass.
  const pillars = group(
    box(0.07, 0.56, HALF_W * 2 + 0.02, paint, 0.18, 1.48, 0),
    box(0.06, 0.52, HALF_W * 2 + 0.02, paint, -0.7, 1.48, 0),
  );

  // Windscreen and rear window lie on the sloped faces of the cab.
  const SCREEN_TILT = Math.atan2(0.7, 0.6);
  const screenPane = new Mesh(new PlaneGeometry(1.56, 0.84), glass);
  screenPane.rotation.y = Math.PI / 2;
  const screen = group(screenPane);
  screen.rotation.z = SCREEN_TILT;
  screen.position.set(0.93 + 0.012 * Math.cos(SCREEN_TILT), 1.5 + 0.012 * Math.sin(SCREEN_TILT), 0);
  const rearPane = new Mesh(new PlaneGeometry(1.3, 0.4), glass);
  rearPane.rotation.y = -Math.PI / 2;
  const rear = group(rearPane);
  rear.rotation.z = -Math.atan2(0.12, 0.68);
  rear.position.set(-0.812, 1.52, 0);

  const bed = box(1.62, 0.02, HALF_W * 2 - 0.3, bedLiner, -1.74, 1.146, 0);

  const face = group(
    box(0.03, 0.2, 1.0, trim, 2.672, 0.9, 0), // grille
    box(0.04, 0.035, 0.9, chrome, 2.69, 0.9, 0),
    box(0.04, 0.13, 0.34, lamp, 2.655, 0.93, 0.68),
    box(0.04, 0.13, 0.34, lamp, 2.655, 0.93, -0.68),
    box(0.16, 0.2, HALF_W * 2 + 0.02, trim, 2.6, 0.6, 0), // stock front bumper
    box(0.04, 0.3, 0.14, tail, -2.69, 0.98, HALF_W - 0.1),
    box(0.04, 0.3, 0.14, tail, -2.69, 0.98, -(HALF_W - 0.1)),
    box(0.12, 0.14, HALF_W * 2 + 0.02, chrome, -2.68, 0.58, 0), // stock rear bumper
    box(0.02, 0.05, 0.5, trim, -2.705, 0.95, 0), // tailgate handle
  );
  const mirrors = group(
    box(0.1, 0.12, 0.2, trim, 1.02, 1.3, HALF_W + 0.1),
    box(0.1, 0.12, 0.2, trim, 1.02, 1.3, -(HALF_W + 0.1)),
  );
  const handles = group(
    box(0.14, 0.03, 0.02, chrome, 0.32, 1.16, HALF_W + 0.005),
    box(0.14, 0.03, 0.02, chrome, -0.52, 1.16, HALF_W + 0.005),
    box(0.14, 0.03, 0.02, chrome, 0.32, 1.16, -(HALF_W + 0.005)),
    box(0.14, 0.03, 0.02, chrome, -0.52, 1.16, -(HALF_W + 0.005)),
  );
  return group(shell, sideGlass, pillars, screen, rear, bed, face, mirrors, handles);
}

function buildWheel(x, z) {
  const tyre = new Mesh(new CylinderGeometry(WHEEL_R, WHEEL_R, 0.27, 36), rubber);
  tyre.rotation.x = Math.PI / 2;
  tyre.castShadow = true;
  const rim = new Mesh(new CylinderGeometry(WHEEL_R * 0.62, WHEEL_R * 0.62, 0.28, 24), chrome);
  rim.rotation.x = Math.PI / 2;
  const hub = new Mesh(new CylinderGeometry(WHEEL_R * 0.2, WHEEL_R * 0.2, 0.3, 12), steel);
  hub.rotation.x = Math.PI / 2;
  const w = group(tyre, rim, hub);
  w.position.set(x, WHEEL_R, z);
  return w;
}

// ── sample parts ────────────────────────────────────────────────────────────
// One builder per fit-on slot (keys match src/garage/slots.ts). Everything is in
// the car body's own space, so a lift kit raises fitted parts with the body.

const side = (fn) => group(fn(1), fn(-1));

const PART_BUILDERS = {
  bumper: () => {
    const z = HALF_W + 0.02;
    return group(
      box(0.2, 0.34, z * 2, steel, 2.72, 0.72, 0),
      box(0.22, 0.1, z * 2 - 0.5, steel, 2.74, 0.5, 0),
      tube([2.8, 0.86, 0.5], [2.84, 1.28, 0.42], 0.035, steel),
      tube([2.8, 0.86, -0.5], [2.84, 1.28, -0.42], 0.035, steel),
      tube([2.84, 1.28, 0.42], [2.84, 1.28, -0.42], 0.035, steel),
      tube([2.82, 1.06, 0.46], [2.82, 1.06, -0.46], 0.025, steel),
      box(0.03, 0.09, 0.2, lamp, 2.83, 0.7, 0.66),
      box(0.03, 0.09, 0.2, lamp, 2.83, 0.7, -0.66),
      // matching rear step bumper
      box(0.2, 0.2, z * 2, steel, -2.76, 0.58, 0),
      box(0.26, 0.03, 0.9, steel, -2.82, 0.69, 0),
    );
  },
  winch: () => {
    const drum = new Mesh(new CylinderGeometry(0.075, 0.075, 0.42, 18), chrome);
    drum.rotation.x = Math.PI / 2;
    drum.position.set(2.86, 0.72, 0);
    drum.castShadow = true;
    return group(
      drum,
      box(0.14, 0.17, 0.12, steel, 2.86, 0.72, 0.27),
      box(0.14, 0.17, 0.12, steel, 2.86, 0.72, -0.27),
      box(0.03, 0.08, 0.3, chrome, 2.95, 0.72, 0),
    );
  },
  snorkel: () => {
    const z = -(HALF_W + 0.06);
    return group(
      tube([1.9, 1.08, z], [1.3, 1.16, z], 0.055, trim),
      tube([1.3, 1.16, z], [0.62, 1.82, z], 0.05, trim),
      tube([0.62, 1.82, z], [0.62, 1.96, z], 0.05, trim),
      box(0.2, 0.15, 0.14, trim, 0.68, 2.02, z),
    );
  },
  'fender-flare': () => {
    const flare = (x, sgn) => {
      const m = new Mesh(new TorusGeometry(0.535, 0.055, 10, 28, Math.PI), trim);
      m.position.set(x, 0.38, sgn * (HALF_W + 0.015));
      m.scale.z = 1.7;
      m.castShadow = true;
      return m;
    };
    return group(flare(AXLE_F, 1), flare(AXLE_F, -1), flare(AXLE_R, 1), flare(AXLE_R, -1));
  },
  'side-step': () =>
    side((sgn) =>
      group(
        box(1.9, 0.05, 0.2, steel, 0.06, 0.42, sgn * (HALF_W + 0.1)),
        box(1.6, 0.012, 0.13, chrome, 0.06, 0.452, sgn * (HALF_W + 0.1)),
        box(0.06, 0.1, 0.12, steel, 0.8, 0.47, sgn * (HALF_W - 0.02)),
        box(0.06, 0.1, 0.12, steel, -0.7, 0.47, sgn * (HALF_W - 0.02)),
      ),
    ),
  'bonnet-hood': () => {
    const scoop = box(0.62, 0.09, 0.6, trim, 1.9, 1.19, 0);
    scoop.rotation.z = -0.078;
    const mouth = box(0.02, 0.05, 0.5, glass, 2.21, 1.17, 0);
    return group(scoop, mouth);
  },
  'roll-bar': () => {
    const z = HALF_W - 0.12;
    return group(
      side((sgn) =>
        group(
          tube([-1.02, 1.14, sgn * z], [-1.0, 1.78, sgn * (z - 0.06)], 0.045, steel),
          tube([-1.0, 1.78, sgn * (z - 0.06)], [-1.75, 1.16, sgn * z], 0.04, steel),
          tube([-1.25, 1.14, sgn * z], [-1.2, 1.6, sgn * (z - 0.04)], 0.035, steel),
        ),
      ),
      tube([-1.0, 1.78, z - 0.06], [-1.0, 1.78, -(z - 0.06)], 0.045, steel),
      box(0.05, 0.08, 0.5, lamp, -0.98, 1.86, 0),
    );
  },
  'roller-shutter': () => {
    const lid = group(box(1.72, 0.035, HALF_W * 2 - 0.08, steel, -1.76, 1.165, 0), box(0.2, 0.09, HALF_W * 2 - 0.1, trim, -0.99, 1.19, 0));
    for (let i = 0; i < 12; i += 1) lid.add(box(0.012, 0.004, HALF_W * 2 - 0.14, chrome, -1.2 - i * 0.12, 1.185, 0));
    return lid;
  },
  canopy: () => {
    const shell = box(1.76, 0.66, HALF_W * 2 - 0.04, paint, -1.76, 1.47, 0);
    return group(
      shell,
      box(1.3, 0.34, HALF_W * 2 - 0.02, glass, -1.76, 1.52, 0),
      box(0.02, 0.4, 1.3, glass, -2.645, 1.5, 0),
      box(1.78, 0.03, HALF_W * 2 - 0.02, trim, -1.76, 1.155, 0),
    );
  },
  'roof-rack': () => {
    const y = 1.93;
    const z = HALF_W - 0.14;
    const rack = group(
      tube([0.5, y, z], [-0.7, y, z], 0.022, steel),
      tube([0.5, y, -z], [-0.7, y, -z], 0.022, steel),
      tube([0.5, y, z], [0.5, y, -z], 0.022, steel),
      tube([-0.7, y, z], [-0.7, y, -z], 0.022, steel),
    );
    for (let i = 1; i < 6; i += 1) rack.add(tube([0.5 - i * 0.2, y, z], [0.5 - i * 0.2, y, -z], 0.014, steel));
    [0.35, -0.55].forEach((x) => {
      rack.add(tube([x, 1.8, z], [x, y, z], 0.02, steel));
      rack.add(tube([x, 1.8, -z], [x, y, -z], 0.02, steel));
    });
    return rack;
  },
};

/** Not a bolt-on: a lift kit raises the body and fits taller tyres. */
const LIFT_KEY = 'lift-kit';
const LIFT_BODY = 0.13;
const LIFT_WHEEL = 1.1;

const CAMERA_START = [5.6, 2.2, 5.9];
const START_DISTANCE = Math.hypot(CAMERA_START[0], CAMERA_START[1] - 0.95, CAMERA_START[2]);
const CAR_HALF_SPAN = 3.6;

// ── scene ───────────────────────────────────────────────────────────────────

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
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const scene = new Scene();
  scene.background = new Color(BG);

  const camera = new PerspectiveCamera(32, 1, 0.1, 60);
  camera.position.set(...CAMERA_START);

  // A bright studio: soft sky light, one key light for shape and shadow, one fill.
  // The room environment is what the paint and chrome reflect.
  scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;
  scene.add(new HemisphereLight('#ffffff', '#cfd6d2', 0.45));
  const key = new DirectionalLight('#ffffff', 1.7);
  key.position.set(5, 8, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -5;
  key.shadow.radius = 6;
  scene.add(key);
  const fill = new DirectionalLight('#ffffff', 0.35);
  fill.position.set(-6, 4, -5);
  scene.add(fill);

  // The turntable.
  const floor = new Mesh(new CircleGeometry(4.2, 64), new MeshStandardMaterial({ color: '#e6eae8', roughness: 0.85, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const shadowCatcher = new Mesh(new CircleGeometry(4.2, 48), new ShadowMaterial({ opacity: 0.3 }));
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = 0.002;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);
  const ring = new Mesh(new RingGeometry(4.08, 4.2, 96), new MeshBasicMaterial({ color: ACCENT }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.004;
  scene.add(ring);

  // The car.
  const car = new Group();
  const body = buildBody();
  const wheels = [buildWheel(AXLE_F, HALF_W - 0.1), buildWheel(AXLE_F, -(HALF_W - 0.1)), buildWheel(AXLE_R, HALF_W - 0.1), buildWheel(AXLE_R, -(HALF_W - 0.1))];
  car.add(body);
  wheels.forEach((w) => car.add(w));
  scene.add(car);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.95, 0);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 4.6;
  controls.maxDistance = 13;
  controls.minPolarAngle = 0.5;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.autoRotate = !cfg.still;
  controls.autoRotateSpeed = 0.9;
  // The moment the customer takes hold of the car, it is theirs to turn.
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  // Fitted parts, by slot key. `fit` eases 0 → 1 so a new part grows into place.
  const fitted = new Map();
  let lift = 0;
  let liftTarget = 0;

  function setParts(keys) {
    const want = new Set(Array.isArray(keys) ? keys : []);
    liftTarget = want.has(LIFT_KEY) ? 1 : 0;
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
      paint.color.set(hex);
      redraw();
    } catch {
      /* an unknown colour string leaves the paint as it was */
    }
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    // Widen the lens on a narrow stage so the whole car, side-on and with a
    // bull bar fitted, stays in frame at the starting distance, whatever the phone.
    const halfV = Math.max(Math.tan((32 * Math.PI) / 360), CAR_HALF_SPAN / (START_DISTANCE * camera.aspect));
    camera.fov = Math.min(70, (Math.atan(halfV) * 360) / Math.PI);
    camera.updateProjectionMatrix();
    dirty = true;
  }

  let dirty = true;
  let ready = false;
  let last = performance.now();

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
    wheels.forEach((w) => {
      w.scale.set(wheelScale, wheelScale, 1);
      w.position.y = WHEEL_R * wheelScale;
    });
    body.position.y = LIFT_BODY * lift + WHEEL_R * (wheelScale - 1);

    fitted.forEach((entry) => {
      if (entry.fit < 1) {
        entry.fit = Math.min(1, entry.fit + dt * 4);
        const e = 1 - Math.pow(1 - entry.fit, 3);
        entry.node.scale.setScalar(0.86 + 0.14 * e);
        moving = true;
      }
    });

    // Draw only when something changed: an idle showroom costs no battery.
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
    if (!ready) {
      ready = true;
      post({ type: 'ready' });
    }
  }

  window.addEventListener('resize', resize);
  window.showroom = { setParts, setPaint };
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
  });

  resize();
  setParts(cfg.parts || []);
  // The first picture is drawn right away rather than on the next animation
  // frame: a browser may hold animation frames back (a throttled or just-opened
  // view), and the customer should never look at an empty stage meanwhile.
  draw();
  requestAnimationFrame(frame);
}

start();
