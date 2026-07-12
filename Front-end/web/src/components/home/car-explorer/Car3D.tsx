'use client';

import { Suspense, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Html, ContactShadows, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import Link from 'next/link';
import type { ResolvedCarHotspot } from '@/lib/carHotspots';

const MODEL_URL = '/models/toyota-hilux/hilux.glb';
const DRACO_PATH = '/draco/gltf/'; // self-hosted decoder (CSP blocks the CDN default)

useGLTF.preload(MODEL_URL, DRACO_PATH);

/** Model + anchored markers, recentred by a KNOWN offset so anchor3d stays aligned. */
function CarModel({
  hotspots,
  onSelect,
}: {
  hotspots: ResolvedCarHotspot[];
  onSelect: (id: string) => void;
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
  }, [model]);

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
              className="group/mk relative flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            >
              <span className="relative flex h-4 w-4 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-60 group-hover/mk:opacity-90" />
                <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-white bg-gold shadow" />
              </span>
              <span className="pointer-events-none absolute left-1/2 top-5 -translate-x-1/2 whitespace-nowrap rounded-md bg-obsidian-deep px-2 py-1 text-xs font-medium text-ink opacity-0 shadow-lg transition-opacity group-hover/mk:opacity-100">
                {h.label}
              </span>
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
}: {
  hotspots: ResolvedCarHotspot[];
  onSelect: (id: string) => void;
  autoRotate?: boolean;
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
        <CarModel hotspots={hotspots} onSelect={onSelect} />
        <ContactShadows position={[0, 0, 0]} opacity={0.5} scale={14} blur={2.4} far={5} />
      </Suspense>

      <OrbitControls
        makeDefault
        enablePan={false}
        enableZoom={false}
        autoRotate={autoRotate}
        autoRotateSpeed={0.7}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.05}
      />
    </Canvas>
  );
}
