/**
 * Wraps app.json. One build-time switch:
 *
 *   TEAM_ALLOW_HTTP=1  lets the app call a plain http:// server, for a test APK
 *                      that talks to a backend on the office Wi-Fi (eas.json
 *                      profile "lan"). Android blocks http in release builds,
 *                      so without this the app could not reach it. Never set it
 *                      for a build staff use: real builds talk to https only.
 */
module.exports = ({ config }) => {
  if (process.env.TEAM_ALLOW_HTTP !== '1') return config;
  return {
    ...config,
    plugins: [...(config.plugins ?? []), ['expo-build-properties', { android: { usesCleartextTraffic: true } }]],
  };
};
