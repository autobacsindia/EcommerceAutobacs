'use client';

import { Suspense, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Html, ContactShadows, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import Link from 'next/link';
import type { ResolvedCarHotspot } from '@/lib/carHotspots';
import MarkerDot from './Marker';

const MODEL_URL = '/models/toyota-hilux/hilux.glb';
const DRACO_PATH = '/draco/gltf/'; // self-hosted decoder (CSP blocks the CDN default)

useGLTF.preload(MODEL_URL, DRACO_PATH);

/** Model + anchored markers, recentred by a KNOWN offset so anchor3d stays aligned. */
function CarModel({
  hotspots,
  onSelect,
  activeId,
  onHover,
  onReady,
}: {
  hotspots: ResolvedCarHotspot[];
  onSelect: (id: string) => void;
  activeId: string | null;
  onHover?: (id: string | null) => void;
  onReady?: () => void;
}) {
  const { scene } = useGLTF(MODEL_URL, DRACO_PATH);
  const groupRef = useRef<THREE.Group>(null);
  const [offset, setOffset] = useState<[number, number, number]>([0, 0, 0]);

  // Clone so repeated mounts don't mutate the cached scene.
  const model = useMemo(() => scene.clone(true), [scene]);

  useLayoutEffect(() => {
    const box = new THREE.Box3().setFromObject(model);
    const c = box.getCenter(new THREE.Vector3());
    // Recentre on X/Z, sit the car on the ground (min Y -> 0).
    setOffset([-c.x, -box.min.y, -c.z]);
    // The model is parsed and placed — the stage can swap the still render out.
    onReady?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  // Number the points in the same order as the still view and the side panel.
  const numberOf = new Map(hotspots.filter((h) => !h.chip).map((h, i) => [h.id, i + 1]));

  return (
    <group ref={groupRef} position={offset}>
      <primitive object={model} />
      {hotspots.map((h) =>
        h.anchor3d ? (
          <Html
            key={h.id}
            position={[h.anchor3d.x, h.anchor3d.y, h.anchor3d.z]}
            center
            distanceFactor={8}
            zIndexRange={[20, 0]}
            className="pointer-events-auto"
          >
            <Link
              href={h.href}
              aria-label={`${h.label} — view products`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onSelect(h.id)}
              onMouseEnter={() => onHover?.(h.id)}
              onMouseLeave={() => onHover?.(null)}
              onFocus={() => onHover?.(h.id)}
              onBlur={() => onHover?.(null)}
              className="group/mk relative flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            >
              <MarkerDot n={numberOf.get(h.id) ?? 0} label={h.label} active={activeId === h.id} />
            </Link>
          </Html>
        ) : null,
      )}
    </group>
  );
}

export default function Car3D({
  hotspots,
  onSelect,
  autoRotate = true,
  activeId = null,
  onHover,
  onReady,
}: {
  hotspots: ResolvedCarHotspot[];
  onSelect: (id: string) => void;
  autoRotate?: boolean;
  activeId?: string | null;
  onHover?: (id: string | null) => void;
  onReady?: () => void;
}) {
  return (
    <Canvas
      dpr={[1, 2]}
      shadows
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ position: [6.5, 2.8, -7], fov: 42 }}
    >
      {/* Manual lighting — drei <Environment> presets load an HDR from a CDN,
          which the site CSP blocks, so we light it by hand. */}
      <ambientLight intensity={0.6} />
      <hemisphereLight intensity={0.5} groundColor={new THREE.Color('#0a0a0a')} />
      <directionalLight position={[5, 8, 5]} intensity={1.1} castShadow />
      <directionalLight position={[-6, 4, -4]} intensity={0.4} />

      <Suspense fallback={null}>
        <CarModel hotspots={hotspots} onSelect={onSelect} activeId={activeId} onHover={onHover} onReady={onReady} />
        <ContactShadows position={[0, 0, 0]} opacity={0.5} scale={14} blur={2.4} far={5} />
      </Suspense>

      <OrbitControls
        makeDefault
        enablePan={false}
        enableZoom={false}
        autoRotate={autoRotate && !activeId}
        autoRotateSpeed={0.7}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.05}
      />
    </Canvas>
  );
}
