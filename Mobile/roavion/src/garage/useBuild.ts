/**
 * The customer's build for one showroom car, remembered ON THIS PHONE.
 *
 * Local and cheap, like the saved-products heart: it never touches the cart or
 * a price. Putting the build in the cart is a separate, explicit step.
 */
import { useCallback, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { emptyBuild, fitPart, parseBuild, removePart, serializeBuild, setPaint, type Build, type BuildPart } from './build';
import type { ShowroomCar } from './slots';

const keyFor = (car: ShowroomCar) => `roavion.build.${car.slug}`;

export function useBuild(car: ShowroomCar) {
  const [build, setBuild] = useState<Build>(() => emptyBuild(car));
  /** The car whose saved build is in `build`. Nothing is written before it matches. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loaded = loadedFor === car.slug;

  useEffect(() => {
    let live = true;
    SecureStore.getItemAsync(keyFor(car))
      .catch(() => null)
      .then((raw) => {
        if (!live) return;
        setBuild(parseBuild(car, raw));
        setLoadedFor(car.slug);
      });
    return () => {
      live = false;
    };
  }, [car]);

  useEffect(() => {
    // Never overwrite a saved build with the empty one shown while loading.
    if (!loaded) return;
    SecureStore.setItemAsync(keyFor(car), serializeBuild(build)).catch(() => {
      /* storage full/unavailable: the build still works for this visit */
    });
  }, [build, loaded, car]);

  const fit = useCallback((slotKey: string, part: BuildPart) => setBuild((b) => fitPart(car, b, slotKey, part)), [car]);
  const remove = useCallback((slotKey: string) => setBuild((b) => removePart(b, slotKey)), []);
  const paint = useCallback((paintKey: string) => setBuild((b) => setPaint(car, b, paintKey)), [car]);
  const clear = useCallback(() => setBuild((b) => ({ ...emptyBuild(car), paint: b.paint })), [car]);

  return { build, loaded, fit, remove, paint, clear };
}
