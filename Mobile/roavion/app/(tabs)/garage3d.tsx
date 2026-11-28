/**
 * The Garage tab. Tapping it opens the full-screen 3D garage (/showroom), which
 * has no tab bar; this screen only exists so the tab has a route, and sends
 * anyone who lands on it directly (a deep link) to the same place.
 */
import { Redirect } from 'expo-router';

export default function GarageTab() {
  return <Redirect href="/showroom" />;
}
