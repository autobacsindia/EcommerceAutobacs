/**
 * Wraps app.json. One build-time switch:
 *
 *   TEAM_ALLOW_HTTP=1  lets the app call a plain http:// server, for a test APK
 *                      that talks to a backend on the office Wi-Fi (eas.json
 *                      profile "lan"). Android blocks http in release builds,
 *                      so without this the app could not reach it. Never set it
 *                      for a build staff use: real builds talk to https only.
 *
 * The `production` profile (the APK staff install from WhatsApp) refuses to
 * build with http allowed or with a non-https API URL, so a test setting can
 * never leak into the real app. The app checks the same at start-up
 * (src/api/client.ts).
 */
module.exports = ({ config }) => {
  const allowHttp = process.env.TEAM_ALLOW_HTTP === '1';
  const profile = process.env.EAS_BUILD_PROFILE || '';
  const apiUrl = process.env.EXPO_PUBLIC_API_URL || config.extra?.apiUrl || '';

  if (profile === 'production') {
    if (allowHttp) throw new Error('production build: TEAM_ALLOW_HTTP must not be set (https only)');
    if (!/^https:\/\//.test(apiUrl)) throw new Error(`production build: API URL must be https, got "${apiUrl}"`);
  }

  const out = { ...config, extra: { ...config.extra, allowHttp } };
  if (!allowHttp) return out;
  return {
    ...out,
    plugins: [...(config.plugins ?? []), ['expo-build-properties', { android: { usesCleartextTraffic: true } }]],
  };
};
