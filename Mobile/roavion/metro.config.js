// Metro bundles .glb 3D models (the showroom car) as assets, like images.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('glb');

module.exports = config;
