// The 3D showroom's pure logic: which parts sit together, what is saved on the
// phone, what "Add to cart" does, and that the WebView page cannot be injected.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SHOWROOM_CAR as car, findSlot, showroomCarBySlug, showroomCarFor, slotsInGroup, SLOT_GROUPS } from '../slots.ts';
import {
  displacedBy, emptyBuild, fitPart, fittedSlotKeys, paintHex, parseBuild, partCount, planCart, removePart, serializeBuild, setPaint,
} from '../build.ts';
import {
  MODEL_FAILED_SCRIPT, modelChunkScripts, setInsetsScript, setPaintScript, setPartsScript, showroomConfig, showroomHtml,
} from '../showroom/showroomHtml.ts';
import { SCENE_JS, SCENE_SOURCE_HASH } from '../showroom/sceneBundle.generated.ts';
import { sceneSourceHash } from '../../../scripts/build-showroom.mjs';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';

const part = (id, extra = {}) => ({ productId: id, slug: `p-${id}`, name: `Part ${id}`, image: '', needsOption: false, ...extra });

test('every slot is in a group, has a unique key, and only excludes real slots', () => {
  const keys = car.slots.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const s of car.slots) {
    assert.ok(SLOT_GROUPS.some((g) => g.key === s.group));
    assert.match(s.key, /^[a-z0-9-]+$/);
    for (const x of s.excludes) {
      assert.ok(findSlot(car, x), `${s.key} excludes unknown slot ${x}`);
      // Exclusion must be mutual, or the result would depend on tap order.
      assert.ok(findSlot(car, x).excludes.includes(s.key), `${x} must exclude ${s.key} back`);
    }
  }
  assert.equal(SLOT_GROUPS.flatMap((g) => slotsInGroup(car, g.key)).length, car.slots.length);
});

test('every slot has a 3D part in the scene, and the scene has no orphan parts', () => {
  const src = readFileSync(new URL('../showroom/scene.src.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('const PART_BUILDERS = {'), src.indexOf('/** Not a bolt-on'));
  const inScene = [...block.matchAll(/^  '?([a-z-]+)'?: \(\) =>/gm)].map((m) => m[1]);
  const expected = car.slots.map((s) => s.key).filter((k) => k !== 'lift-kit');
  assert.deepEqual([...inScene].sort(), [...expected].sort());
  assert.match(src, /const LIFT_KEY = 'lift-kit'/);
});

test('the committed 3D bundle matches its source (run `npm run build:showroom` if this fails)', () => {
  assert.equal(SCENE_SOURCE_HASH, sceneSourceHash());
  assert.ok(SCENE_JS.length > 100_000);
  assert.ok(!/<\/script/i.test(SCENE_JS), 'bundle must not be able to close its own <script> tag');
});

test('cars are found by slug or by garage make/model, case-insensitively', () => {
  assert.equal(showroomCarBySlug('toyota-hilux'), car);
  assert.equal(showroomCarBySlug('nope'), null);
  assert.equal(showroomCarBySlug(undefined), null);
  assert.equal(showroomCarFor(' toyota ', 'HILUX'), car);
  assert.equal(showroomCarFor('Toyota', 'Fortuner'), null);
  assert.equal(showroomCarFor('Toyota', undefined), null);
});

test('fitting replaces the part in the same slot', () => {
  let b = fitPart(car, emptyBuild(car), 'bumper', part('a'));
  b = fitPart(car, b, 'bumper', part('b'));
  assert.equal(partCount(b), 1);
  assert.equal(b.parts.bumper.productId, 'b');
});

test('a canopy pushes out the roll bar and roller shutter, and the other way round', () => {
  let b = emptyBuild(car);
  b = fitPart(car, b, 'roll-bar', part('r'));
  b = fitPart(car, b, 'roller-shutter', part('s'));
  b = fitPart(car, b, 'snorkel', part('n'));
  assert.deepEqual(displacedBy(car, b, 'canopy').sort(), ['roll-bar', 'roller-shutter']);
  b = fitPart(car, b, 'canopy', part('c'));
  assert.deepEqual(fittedSlotKeys(car, b).sort(), ['canopy', 'snorkel']);
  b = fitPart(car, b, 'roll-bar', part('r'));
  assert.deepEqual(fittedSlotKeys(car, b).sort(), ['roll-bar', 'snorkel']);
});

test('unknown slots and empty products change nothing; builds are never mutated', () => {
  const b0 = fitPart(car, emptyBuild(car), 'bumper', part('a'));
  const frozen = JSON.stringify(b0);
  assert.equal(fitPart(car, b0, 'spoiler-of-doom', part('x')), b0);
  assert.equal(fitPart(car, b0, 'snorkel', part('')), b0);
  assert.equal(removePart(b0, 'snorkel'), b0);
  fitPart(car, b0, 'snorkel', part('n'));
  removePart(b0, 'bumper');
  assert.equal(JSON.stringify(b0), frozen);
});

test('paint only accepts the car\'s own colours', () => {
  const b = emptyBuild(car);
  assert.equal(setPaint(car, b, 'black').paint, 'black');
  assert.equal(setPaint(car, b, 'chartreuse'), b);
  assert.equal(paintHex(car, { ...b, paint: 'gone' }), car.paints[0].hex);
});

test('a saved build round-trips', () => {
  let b = setPaint(car, emptyBuild(car), 'black');
  b = fitPart(car, b, 'bumper', part('a', { needsOption: true }));
  b = fitPart(car, b, 'winch', part('w'));
  assert.deepEqual(parseBuild(car, serializeBuild(b)), b);
});

test('a corrupt or hostile saved build is dropped piece by piece, never thrown', () => {
  const empty = emptyBuild(car);
  for (const raw of [null, undefined, '', 'not json', '42', 'null', '[]', '{"parts":7}', '{"parts":{"bumper":"x"}}']) {
    assert.deepEqual(parseBuild(car, raw), empty, String(raw));
  }
  const b = parseBuild(car, JSON.stringify({
    paint: '</script><script>alert(1)</script>',
    parts: {
      bumper: { productId: 'a', slug: 'a', name: 5, image: null, needsOption: 'yes' },
      'old-slot': { productId: 'z', slug: 'z' },
      snorkel: { productId: '', slug: 's' },
      // Saved together by an older version: only the first survives.
      'roll-bar': { productId: 'r', slug: 'r' },
      canopy: { productId: 'c', slug: 'c' },
    },
  }));
  assert.equal(b.paint, empty.paint);
  assert.deepEqual(fittedSlotKeys(car, b).sort(), ['bumper', 'roll-bar']);
  assert.deepEqual(b.parts.bumper, { productId: 'a', slug: 'a', name: '', image: '', needsOption: false });
});

test('a build stores no price', () => {
  const b = fitPart(car, emptyBuild(car), 'bumper', { ...part('a'), price: 999 });
  assert.ok(!/price/i.test(serializeBuild(parseBuild(car, serializeBuild(b)))));
});

test('add to cart: skips what is already in the cart and holds back parts that need an option', () => {
  let b = emptyBuild(car);
  b = fitPart(car, b, 'bumper', part('a'));
  b = fitPart(car, b, 'snorkel', part('b'));
  b = fitPart(car, b, 'roll-bar', part('c', { needsOption: true }));
  const first = planCart(car, b, []);
  assert.deepEqual(first.add.map((p) => p.productId).sort(), ['a', 'b']);
  assert.deepEqual(first.needOption.map((p) => p.productId), ['c']);

  // Same tap twice / retry after "a" went through: "a" is not added again.
  const retry = planCart(car, b, ['a']);
  assert.deepEqual(retry.add.map((p) => p.productId), ['b']);
  assert.deepEqual(retry.alreadyInCart.map((p) => p.productId), ['a']);

  // Once the customer chose an option on the product page, it is simply in the cart.
  const done = planCart(car, b, ['a', 'b', 'c']);
  assert.deepEqual([done.add.length, done.needOption.length, done.alreadyInCart.length], [0, 0, 3]);
  assert.deepEqual(planCart(car, emptyBuild(car), ['a']), { add: [], alreadyInCart: [], needOption: [] });
});

test('nothing from a build can become markup or script in the 3D page', () => {
  const evil = '</script><script>alert(1)</script>';
  const cfg = showroomConfig({ parts: ['bumper', evil, 'UPPER', '../x'], paint: evil, accent: 'red', still: 'yes', insetTop: evil, insetBottom: 7 });
  assert.deepEqual([cfg.insetTop, cfg.insetBottom], [0, 0.8]);
  assert.deepEqual(cfg.parts, ['bumper']);
  assert.match(cfg.paint, /^#[0-9a-f]{6}$/i);
  assert.match(cfg.accent, /^#[0-9a-f]{6}$/i);
  assert.equal(cfg.still, false);

  const html = showroomHtml({ parts: [evil, 'snorkel'], paint: evil, accent: evil, still: false });
  assert.ok(!html.includes('alert(1)'));
  assert.equal(html.match(/<script>/g).length, 2);
  assert.ok(!/src=|href=|https?:\/\/(?!www\.w3\.org)/.test(html.replace(/<script>[\s\S]*$/, '')), 'the page loads nothing from the network');

  assert.equal(setPartsScript(['bumper', evil]), 'window.showroom&&window.showroom.setParts(["bumper"]);true;');
  assert.equal(setPaintScript(evil), 'true;');
  assert.equal(setInsetsScript(evil, 0.4126), 'window.showroom&&window.showroom.setInsets(0,0.413);true;');
  assert.equal(setPaintScript('#a3151c'), 'window.showroom&&window.showroom.setPaint("#a3151c");true;');
});

test('the car model is handed to the page in order, and only ever as plain base64', () => {
  const b64 = Buffer.from('glTF-bytes-'.repeat(50)).toString('base64');
  const scripts = modelChunkScripts(b64, 64);
  assert.equal(scripts.length, Math.ceil(b64.length / 64));
  // Every piece says its place and the total, and together they rebuild the file exactly.
  const pieces = scripts.map((js, i) => {
    const m = js.match(/^window\.showroom&&window\.showroom\.modelChunk\((\d+),(\d+),'([A-Za-z0-9+/=]*)'\);true;$/);
    assert.ok(m, js);
    assert.equal(Number(m[1]), i);
    assert.equal(Number(m[2]), scripts.length);
    return m[3];
  });
  assert.equal(pieces.join(''), b64);
  // Anything that is not base64 could break out of the string: nothing is sent.
  assert.deepEqual(modelChunkScripts("QUJD');alert(1);//"), []);
  assert.deepEqual(modelChunkScripts(''), []);
  assert.equal(MODEL_FAILED_SCRIPT, 'window.showroom&&window.showroom.modelFailed();true;');
});

test('the page config only takes a real car slug and a strict yes for the model', () => {
  const ok = showroomConfig({ car: 'toyota-hilux', model: true, parts: [], paint: '#a3151c', accent: '#0a5c33', still: false });
  assert.equal(ok.car, 'toyota-hilux');
  assert.equal(ok.model, true);
  const bad = showroomConfig({ car: '</script><script>x', model: 'yes', parts: [], paint: '#a3151c', accent: '#0a5c33', still: false });
  assert.equal(bad.car, '');
  assert.equal(bad.model, false);
  assert.equal(showroomConfig({ parts: [], paint: '#a3151c', accent: '#0a5c33', still: false }).car, '');
});

test('the bundled Hilux model has what the scene relies on (paint, glass, four wheels) and a credit', () => {
  const glb = readFileSync(new URL('../../../assets/models/toyota-hilux.glb', import.meta.url));
  assert.equal(glb.toString('ascii', 0, 4), 'glTF');
  const json = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
  const materials = json.materials.map((m) => m.name);
  // Names the scene's MODELS['toyota-hilux'] uses; a re-exported model that renames them loses colour change silently.
  for (const name of ['primary', 'hilux_mb01.7', 'glass', 'glass.001']) assert.ok(materials.includes(name), `missing material ${name}`);
  // Same pattern as the scene's `wheels`: pieces grouped into exactly four wheels.
  const wheels = new Set(json.nodes.map((n) => (n.name ?? '').match(/^(wheel_rf(?:\.?\d{3})?)_wheel_rf\.?\d/)?.[1]).filter(Boolean));
  assert.equal(wheels.size, 4);
  // Phones must be able to read it: only extensions three.js decodes offline.
  for (const ext of json.extensionsRequired ?? []) assert.ok(['EXT_meshopt_compression', 'EXT_texture_webp', 'KHR_mesh_quantization', 'KHR_texture_transform'].includes(ext), ext);
  assert.ok(glb.length < 8 * 1024 * 1024, 'keep the model small enough for a phone');
  // CC BY 4.0: the credit must stay with the file and on screen.
  assert.match(readFileSync(new URL('../../../assets/models/CREDITS.md', import.meta.url), 'utf8'), /BHP3D[\s\S]*CC BY 4\.0/);
  const scene = readFileSync(new URL('../showroom/scene.src.js', import.meta.url), 'utf8');
  assert.ok(scene.includes(String.raw`wheels: /^(wheel_rf(?:\.?\d{3})?)_wheel_rf\.?\d/,`), 'scene and test use the same wheel pattern');
  assert.match(scene, /'toyota-hilux':\s*\{\s*paint: \['primary', 'hilux_mb01\.7'\]/);
  assert.match(readFileSync(new URL('../showroom/models.ts', import.meta.url), 'utf8'), /BHP3D, CC BY 4\.0/);
});
